import cors from "cors"
import compression from "compression"
import express from "express"
import future from "fp-future"
import type * as ExpressModule from "express"
import type {
  IBaseComponent,
  IHttpServerComponent,
  IStatusCheckCapableComponent,
} from "@well-known-components/interfaces"
import { _setUnderlyingServer } from "./injectors"
import { getServer, success, getRequestFromNodeMessage } from "./logic"
import type { ServerComponents, IHttpServerOptions } from "./types"
import { IncomingMessage } from "http"
import { createServerHandler } from "./server-handler"
import * as https from "https"

/**
 * @public
 */
export type FullHttpServerComponent<Context extends object> = IHttpServerComponent<Context> &
  IBaseComponent &
  IStatusCheckCapableComponent & {
    /**
     * WARNING! this is a very destructive function, it resets all the .use middlewares
     * you must reconfigure your handlers entirely after calling this function
     */
    resetMiddlewares(): void
  }

/**
 * Creates a http-server component
 * @public
 */
export async function createServerComponent<Context extends object>(
  components: ServerComponents,
  options: Partial<IHttpServerOptions>
): Promise<FullHttpServerComponent<Context>> {
  const { config, logs } = components
  const logger = logs.getLogger("http-server")

  // config
  const port = await config.requireNumber("HTTP_SERVER_PORT")
  const host = await config.requireString("HTTP_SERVER_HOST")

  // server
  const app = express()

  // configure cors and compression
  // TODO: set HTTP_SERVER_CORS_[ENABLE,ORIGIN,METHOD,...] to enable and configure
  if (options.cors) {
    app.use(cors(options.cors))
  }

  // TODO: set HTTP_SERVER_COMPRESSION_[ENABLE,...] to enable and configure
  if (options.compression) {
    app.use(compression(options.compression))
  }

  const server = getServer(options, app)
  app.disable("x-powered-by")

  let listen: Promise<typeof server> | undefined

  async function start(): Promise<void> {
    if (listen) {
      await listen
      return
    }

    listen = new Promise((resolve, reject) => {
      const errorHandler = (err: Error) => {
        logger.error(err)
        reject(err)
      }

      server
        .listen(port, host, () => {
          logger.log(`Listening ${host}:${port}`)
          resolve(server)
          server!.off("error", errorHandler)
        })
        .once("error", errorHandler)
    })

    await listen
  }

  async function stop() {
    if (listen) {
      logger.log(`Closing server`)
      if (server && server.listening) {
        const awaitable = future()
        server.close((err) => {
          if (err) {
            awaitable.reject(err)
          } else {
            awaitable.resolve(null)
          }
          listen = undefined
        })
        return awaitable
      }
    }
  }

  let configuredContext: Context = Object.create({})

  const serverHandler = createServerHandler<Context>()

  const ret: FullHttpServerComponent<Context> = {
    // IBaseComponent
    start,
    stop,
    // IStatusCheckCapableComponent
    async startupProbe() {
      return true
    },
    async readynessProbe() {
      return server.listening
    },
    // IHttpServerComponent
    use: serverHandler.use,
    setContext(context) {
      configuredContext = Object.create(context)
    },

    // extra
    resetMiddlewares: serverHandler.resetMiddlewares,
  }

  async function asyncHandle(req: IncomingMessage, res: ExpressModule.Response) {
    const request = getRequestFromNodeMessage(req, host, server instanceof https.Server ? "https" : "http")
    const response = await serverHandler.processRequest(configuredContext, request)
    success(response, res)
  }

  app.use((req, res) => {
    asyncHandle(req, res).catch((error) => {
      logger.error("Unhandled error in http-server middlewares: " + error.message, {
        url: req.url,
        ip: req.ip,
        method: req.method,
        stack: error.stack || error.toString(),
      })
      res.status(500)
      res.end()
    })
  })

  _setUnderlyingServer(ret, async () => {
    if (!server) throw new Error("The server is stopped")
    return (await listen) || server!
  })

  return ret
}
