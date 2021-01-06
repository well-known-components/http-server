import cors from "cors"
import compression from "compression"
import express from "express"
import future from "fp-future"
import type {
  IBaseComponent,
  IHttpServerComponent,
  IStatusCheckCapableComponent,
} from "@well-known-components/interfaces"
import { _setUnderlyingExpress, _setUnderlyingServer } from "./injectors"
import {
  registerExpressRouteMethodHandler,
  getServer,
  transformToExpressHandler,
  registerExpressRouteHandler,
  registerExpressHandler,
} from "./logic"
import type { ServerComponents, IHttpServerOptions } from "./types"

/**
 * Creates a http-server component
 * @public
 */
export async function createServerComponent(
  components: ServerComponents,
  options: Partial<IHttpServerOptions>
): Promise<IHttpServerComponent & IBaseComponent & IStatusCheckCapableComponent> {
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

  function createMethodHandler(method: Lowercase<IHttpServerComponent.HTTPMethod>) {
    return <Context, Path extends string = ''>(context: Context, path: Path, handler: IHttpServerComponent.IRequestHandler<Context, Path>) => {
      const expressHandler = transformToExpressHandler<any, Path>(logger, context as any, handler)
      registerExpressRouteMethodHandler(app, method, path, expressHandler)
    }
  }

  const methodHandlers: IHttpServerComponent.MethodHandlers = {
    get: createMethodHandler("get"),
    put: createMethodHandler("put"),
    delete: createMethodHandler("delete"),
    connect: createMethodHandler("connect"),
    options: createMethodHandler("options"),
    head: createMethodHandler("head"),
    patch: createMethodHandler("patch"),
    post: createMethodHandler("post"),
    trace: createMethodHandler("trace"),
  }

  const ret: IHttpServerComponent & IBaseComponent & IStatusCheckCapableComponent = {
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
    ...methodHandlers,
    route(context, path, handler) {
      const expressHandler = transformToExpressHandler<any, ''>(logger, context, handler)
      registerExpressRouteHandler(app, path, expressHandler)
    },
    use(context, handler) {
      const expressHandler = transformToExpressHandler<any, ''>(logger, context, handler)
      registerExpressHandler(app, expressHandler)
    },
  }

  _setUnderlyingServer(ret, async () => {
    if (!server) throw new Error("The server is stopped")
    return (await listen) || server!
  })

  _setUnderlyingExpress(ret, async () => {
    return app
  })

  return ret
}
