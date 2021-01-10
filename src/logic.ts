import * as fetch from "node-fetch"
import { Stream } from "stream"
import * as http from "http"
import * as https from "https"
import type * as ExpressModule from "express"
import type { IHttpServerComponent } from "@well-known-components/interfaces"
import type { IHttpServerOptions } from "./types"
import { parse as parseUrl } from "url"
import { HttpError } from "http-errors"
import { Middleware } from "./middleware"

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

const NAME = Symbol.toStringTag
/**
 * Check if `object` is a W3C `Blob` object (which `File` inherits from)
 *
 * @internal
 */
export const isBlob = (object): object is Blob => {
  return (
    typeof object === "object" &&
    typeof object.arrayBuffer === "function" &&
    typeof object.type === "string" &&
    typeof object.stream === "function" &&
    typeof object.constructor === "function" &&
    /^(Blob|File)$/.test(object[NAME])
  )
}

/**
 * @internal
 */
export function success(data: fetch.Response, res: ExpressModule.Response) {
  if (data.statusText) res.statusMessage = data.statusText
  if (data.status) res.status(data.status)

  if (data.headers) {
    const headers = new fetch.Headers(data.headers as any)
    headers.forEach((value, key) => {
      res.setHeader(key, value)
    })
  }

  const body: Buffer | Stream | Blob = data.body

  if (Buffer.isBuffer(body)) {
    res.send(body)
  } else if (isBlob(body)) {
    const blob = body as Blob
    ;(blob.stream() as any).pipe(res)
  } else if (body.pipe) {
    body.pipe(res)
  } else {
    console.dir(body)
    throw new Error("Unknown body")
  }
}

// @internal
export function getDefaultMiddlewares(): Middleware<any>[] {
  return [coerceErrorsMiddleware]
}

export const getRequestFromNodeMessage = <T extends http.IncomingMessage>(
  request: T
): IHttpServerComponent.IRequest => {
  const headers = new fetch.Headers()

  for (let key in request.headers) {
    if (request.headers.hasOwnProperty(key)) {
      const h = request.headers[key]
      if (typeof h == "string") {
        headers.append(key, h)
      } else if (Array.isArray(h)) {
        h.forEach(($) => headers.append(key, $))
      }
    }
  }

  const requestInit: fetch.RequestInit = {
    headers: headers,
    method: request.method.toUpperCase(),
  }

  if (requestInit.method != "GET" && requestInit.method != "HEAD") {
    requestInit.body = request
  }

  const ret = new fetch.Request(request.url, requestInit)

  ret.hostname = headers.get("host") || ""

  return ret
}

export const coerceErrorsMiddleware: Middleware<any> = async (_, next) => {
  try {
    return await next()
  } catch (e) {
    if (
      e instanceof HttpError ||
      (("status" in e || "statusCode" in e) && (typeof e.status == "number" || typeof e.statusCode == "number"))
    ) {
      return {
        status: e.status || e.statusCode,
        body: e.body || e.message,
        headers: e.headers,
      }
    }
    throw e
  }
}

function respondBuffer(
  buffer: Buffer,
  response: IHttpServerComponent.IResponse,
  mutableHeaders: fetch.Headers
): fetch.Response {
  // TODO: test
  mutableHeaders.set("content-length", buffer.byteLength.toFixed())
  return new fetch.Response(buffer, {
    ...(response as fetch.ResponseInit),
    headers: mutableHeaders,
  })
}

function respondJson(
  json: any,
  response: IHttpServerComponent.IResponse,
  mutableHeaders: fetch.Headers
): fetch.Response {
  // TODO: test
  if (!mutableHeaders.has("content-type")) {
    mutableHeaders.set("content-type", "application/json")
  }
  const newBody = Buffer.from(JSON.stringify(json))
  mutableHeaders.set("content-length", newBody.byteLength.toFixed())
  return new fetch.Response(newBody, {
    ...(response as fetch.ResponseInit),
    headers: mutableHeaders,
  })
}

function respondString(
  txt: string,
  response: IHttpServerComponent.IResponse,
  mutableHeaders: fetch.Headers
): fetch.Response {
  // TODO: test
  // TODO: accept encoding
  const returnEncoding = "utf-8"
  const r = respondBuffer(Buffer.from(txt, returnEncoding), response, mutableHeaders)

  if (!r.headers.has("content-type")) {
    r.headers.set("content-type", `text/plain; charset=${returnEncoding}`)
  }

  return r
}

const initialResponse: IHttpServerComponent.IResponse = {
  status: 404,
  body: "Not found",
}

/**
 * Default middleware
 * @public
 */
export async function defaultHandler(): Promise<IHttpServerComponent.IResponse> {
  return initialResponse
}

// @internal
export function normalizeResponseBody(
  request: IHttpServerComponent.IRequest,
  response: IHttpServerComponent.IResponse
): fetch.Response {
  if (!response) {
    console.error("Warning, response received in normalizeResponseBody is nullish")
    return new fetch.Response()
  }

  const is1xx = response.status && response.status >= 100 && response.status < 200
  const is204 = response.status == 204
  const is304 = response.status == 304
  const isHEAD = request.method == "HEAD"

  // https://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html#sec4.4
  // the following responses must not contain any content nor content-length
  if (is1xx || is204 || is304 || isHEAD) {
    // TODO: TEST
    return new fetch.Response(undefined, { ...response, body: undefined } as any)
  }

  const mutableHeaders = new fetch.Headers(response.headers as fetch.HeaderInit)

  if (Buffer.isBuffer(response.body)) {
    return respondBuffer(response.body, response, mutableHeaders)
  } else if (response.body instanceof Uint8Array || response.body instanceof ArrayBuffer) {
    return respondBuffer(Buffer.from(response.body), response, mutableHeaders)
  } else if (typeof response.body == "string") {
    return respondString(response.body, response, mutableHeaders)
  } else if (response.body instanceof Stream) {
    // TODO: test
    return new fetch.Response(response.body, response as fetch.ResponseInit)
  } else if (response.body != undefined) {
    // TODO: test
    return respondJson(response.body, response, mutableHeaders)
  }

  // Applications SHOULD use this field to indicate the transfer-length of the
  // message-body, unless this is prohibited by the rules in section 4.4.
  // (https://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html#sec4.4)
  if (!mutableHeaders.has("content-length")) {
    mutableHeaders.set("content-length", "0")
  }

  return new fetch.Response(undefined, { ...(response as fetch.ResponseInit), headers: mutableHeaders })
}

/**
 * @internal
 */
export function contextFromRequest<Ctx extends object>(baseCtx: Ctx, request: IHttpServerComponent.IRequest) {
  const newContext: IHttpServerComponent.DefaultContext<Ctx> = Object.create(baseCtx)

  // hidrate context with the request
  newContext.request = request
  newContext.url = parseUrl(request.url, true)

  return newContext
}
