import * as fetch from "node-fetch"
import { Stream } from "stream"
import * as http from "http"
import * as https from "https"
import type * as ExpressModule from "express"
import type { ILoggerComponent, IHttpServerComponent } from "@well-known-components/interfaces"
import type { IHttpServerOptions } from "./types"

/**
 * @internal
 */
export function getServer(
  options: Partial<IHttpServerOptions>,
  listener: http.RequestListener
): http.Server | https.Server {
  if ("https" in options && options.https) return https.createServer(options.https, listener)
  if ("http" in options && options.http) return http.createServer(options.http, listener)
  return http.createServer(listener)
}

/**
 * @internal
 */
export function buildRequest(req: ExpressModule.Request): fetch.Request {
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

  return new fetch.Request(req.url, requestInit)
}

/**
 * @internal
 */
export function success(res: ExpressModule.Response) {
  return (data: IHttpServerComponent.IResponse) => {
    if (data.statusText) res.statusMessage = data.statusText
    if (data.status) res.status(data.status)

    if (data.headers) {
      const headers = new fetch.Headers(data.headers as any)
      headers.forEach((value, key) => {
        res.setHeader(key, value)
      })
    }
    if ("body" in data) {
      if (data.body instanceof Stream) {
        data.body.pipe(res)
      } else if (data.body instanceof Uint8Array) {
        res.send(data.body)
      } else if (typeof data.body == "string") {
        res.send(data.body)
      } else if (data.body != undefined) {
        res.json(data.body)
      }
    } else {
      res.end()
    }
  }
}
// @internal
export function registerExpressRouteHandler(
  expressApp: any,
  method: string,
  path: string,
  handler: ExpressModule.Handler
): void {
  expressApp[method.toLowerCase()](path, handler)
}

/**
 * @internal
 */
export function failure(req: ExpressModule.Request, res: ExpressModule.Response, logger: ILoggerComponent.ILogger) {
  return (error: Error) => {
    logger.debug("error processing request", { url: req.url, method: req.method })
    logger.error(error)
    res.status(500).send({ ok: false })
  }
}

/**
 * @internal
 */
export function transformToExpressHandler<Ctx extends object>(
  logger: ILoggerComponent.ILogger,
  context: IHttpServerComponent.DefaultContext<Ctx>,
  handler: IHttpServerComponent.IRequestHandler<Ctx>
) {
  return (req: ExpressModule.Request, res: ExpressModule.Response) => {
    const request = buildRequest(req)
    const newContext: IHttpServerComponent.DefaultContext<Ctx> = Object.create(context)

    // hidrate context
    newContext.params = req.params
    newContext.request = request
    newContext.query = req.query

    handler(newContext).then(success(res)).catch(failure(req, res, logger))
  }
}
