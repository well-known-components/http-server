import cors from "cors"
import * as fetch from "node-fetch"
import compression from "compression"
import express, { Request, Response } from "express"
import future from "fp-future"
import { IConfigComponent, ILoggerComponent, IServerComponent } from "@well-known-components/interfaces"
import { Stream } from "stream"
import * as http from "http"
import * as https from "https"

import { setUnderlyingExpress, setUnderlyingServer } from "./injectors"
export * from "./injectors"

type ServerComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
}

/**
 * Creates a http-server component
 * @public
 */
export async function createServerComponent(components: ServerComponents): Promise<IServerComponent> {
  const { config, logs } = components
  const logger = logs.getLogger("http-server")

  // config
  const port = await config.requireNumber("HTTP_SERVER_PORT")
  const host = await config.requireString("HTTP_SERVER_HOST")

  // server
  const app = express()

  // configure cors and compression
  // TODO: set HTTP_SERVER_CORS_[ENABLE,ORIGIN,METHOD,...] to enable and configure
  app.use(cors())
  // TODO: set HTTP_SERVER_COMPRESSION_[ENABLE,...] to enable and configure
  app.use(compression())

  // methods
  function buildRequest(req: Request): IServerComponent.ExtendedRequestInfo {
    const headers = new fetch.Headers()

    for (let key in req.headers) {
      if (req.headers.hasOwnProperty(key)) {
        headers.set(key, req.header(key)!)
      }
    }

    const requestInit: fetch.RequestInit = {
      headers: headers,
      method: req.method,
    }

    if (requestInit.method != "GET" && requestInit.method != "HEAD") {
      requestInit.body = req
    }

    return Object.assign(new fetch.Request(req.url, requestInit), {
      query: {},
      params: {},
    })
  }

  function success<T>(res: Response) {
    return (data: IServerComponent.IResponse<T>) => {
      if (data.statusText) res.statusMessage = data.statusText
      if (data.status) res.status(data.status)

      if (data.headers) {
        const headers = new fetch.Headers(data.headers as any)
        headers.forEach((value, key) => {
          res.setHeader(key, value)
        })
      }

      if (data.body instanceof Stream) {
        data.body.pipe(res)
      } else if (data.body instanceof Uint8Array) {
        res.send(data.body)
      } else if (data.body != undefined) {
        // TODO: move this to an interceptor, this is very custom to our servers
        res.json(data.body)
      } else {
        res.end()
      }
    }
  }

  function failure(res: Response) {
    return (error: Error) => {
      res
        .status(500)
        // TODO: move this to an interceptor, this is very custom to our servers
        .send({ ok: false, error })
    }
  }

  function transformToExpressHandler<T>(handler: IServerComponent.IRequestHandler<T>) {
    return (req: Request, res: Response) => {
      const request = buildRequest(req)
      handler(request).then(success(res)).catch(failure(res))
    }
  }

  const server: http.Server | https.Server = http.createServer(app)
  let listen: Promise<typeof server> | undefined

  async function start() {
    if (listen) {
      return listen
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

    return await listen
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

  const ret: IServerComponent = {
    start,
    stop,
    get: (path, handler) => app.get(path, transformToExpressHandler(handler)),
    post: (path, handler) => app.post(path, transformToExpressHandler(handler)),
    put: (path, handler) => app.put(path, transformToExpressHandler(handler)),
    delete: (path, handler) => app.delete(path, transformToExpressHandler(handler)),
  }

  setUnderlyingServer(ret, async () => {
    if (!server) throw new Error("The server is stopped")
    return (await listen) || server!
  })

  setUnderlyingExpress(ret, async () => {
    return app
  })

  return ret
}
