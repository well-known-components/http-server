import * as fetch from 'node-fetch'
import { Stream } from 'stream'
import * as http from 'http'
import * as https from 'https'
import destroy from 'destroy'
import onFinished from 'on-finished'
import type { IHttpServerComponent } from '@well-known-components/interfaces'
import type { IHttpServerOptions } from './types'
import { HttpError } from 'http-errors'
import { Middleware } from './middleware'
import { getWebSocketCallback, upgradeWebSocketResponse, withWebSocketCallback } from './ws'

/**
 * @internal
 */
export function getServer(
  options: Partial<IHttpServerOptions>,
  listener: http.RequestListener
): http.Server | https.Server {
  if ('https' in options && options.https) return https.createServer(options.https, listener)
  if ('http' in options && options.http) return http.createServer(options.http, listener)
  return http.createServer(listener)
}

const NAME = Symbol.toStringTag
/**
 * Check if `object` is a W3C `Blob` object (which `File` inherits from)
 *
 * @internal
 */
export const isBlob = (object: any): object is Blob => {
  return (
    object !== null &&
    typeof object === 'object' &&
    typeof object.arrayBuffer === 'function' &&
    typeof object.type === 'string' &&
    typeof object.stream === 'function' &&
    typeof object.constructor === 'function' &&
    /^(Blob|File)$/.test(object[NAME])
  )
}

/**
 * @internal
 */
export function success(data: fetch.Response, res: http.ServerResponse) {
  if (data.statusText) res.statusMessage = data.statusText
  if (data.status) res.statusCode = data.status

  if (data.headers) {
    const headers = new fetch.Headers(data.headers as any)
    headers.forEach((value, key) => {
      if (value !== undefined) {
        res.setHeader(key, value)
      }
    })
  }

  const body = data.body

  if (Buffer.isBuffer(body)) {
    res.end(body)
  } else if (isBlob(body)) {
    // const blob = body as Blob
    // const stream = blob.stream()
    // if (stream.pipeTo) {
    //   stream.pipeTo(res as any)
    // } else {
    //   ;(blob.stream() as any).pipe(res)
    // }
    throw new Error('Unknown response body (Blob)')
  } else if (body && body.pipe) {
    body.pipe(res)

    // Note: for context about why this is necessary, check https://github.com/nodejs/node/issues/1180
    onFinished(res, () => destroy(body))
  } else if (body !== undefined && body !== null) {
    throw new Error('Unknown response body')
  } else {
    res.end()
  }
}

// @internal
export function getDefaultMiddlewares(): Middleware<any>[] {
  return [coerceErrorsMiddleware]
}

export const getRequestFromNodeMessage = <T extends http.IncomingMessage & { originalUrl?: string }>(
  request: T,
  host: string
): IHttpServerComponent.IRequest => {
  const headers = new fetch.Headers()

  for (let key in request.headers) {
    if (request.headers.hasOwnProperty(key)) {
      const h = request.headers[key]
      if (typeof h == 'string') {
        headers.append(key, h)
      } else if (Array.isArray(h)) {
        h.forEach(($) => headers.append(key, $))
      }
    }
  }

  const requestInit: fetch.RequestInit = {
    headers: headers,
    method: request.method!.toUpperCase()
  }

  if (requestInit.method != 'GET' && requestInit.method != 'HEAD') {
    requestInit.body = request
  }

  const protocol = headers.get('X-Forwarded-Proto') == 'https' ? 'https' : 'http'
  const baseUrl = protocol + '://' + (headers.get('X-Forwarded-Host') || headers.get('host') || host || '0.0.0.0')

  // Note: Express.js overwrite `req.url` freely for internal routing
  // purposes and retains the original value on `req.originalUrl`
  // @see https://expressjs.com/en/api.html#req.originalUrl
  const originalUrl = request.originalUrl ?? request.url!
  let url = new URL(baseUrl + originalUrl)
  try {
    url = new URL(originalUrl, baseUrl)
  } catch {}
  const ret = new fetch.Request(url.toString(), requestInit)

  return ret
}

export const coerceErrorsMiddleware: Middleware<any> = async (_, next) => {
  try {
    return await next()
  } catch (e: any) {
    if (
      e instanceof HttpError ||
      (('status' in e || 'statusCode' in e) && (typeof e.status == 'number' || typeof e.statusCode == 'number'))
    ) {
      return {
        status: e.status || e.statusCode,
        body: e.body || e.message,
        headers: e.headers
      }
    }
    throw e
  }
}

function respondBuffer(
  buffer: ArrayBuffer,
  response: IHttpServerComponent.IResponse,
  mutableHeaders: fetch.Headers
): fetch.Response {
  // TODO: test
  mutableHeaders.set('Content-Length', buffer.byteLength.toFixed())
  return new fetch.Response(buffer, {
    ...(response as fetch.ResponseInit),
    headers: mutableHeaders
  })
}

function respondJson(
  json: any,
  response: IHttpServerComponent.IResponse,
  mutableHeaders: fetch.Headers
): fetch.Response {
  // TODO: test
  if (!mutableHeaders.has('content-type')) {
    mutableHeaders.set('content-type', 'application/json')
  }
  return respondString(JSON.stringify(json), response, mutableHeaders)
}

function respondString(
  txt: string,
  response: IHttpServerComponent.IResponse,
  mutableHeaders: fetch.Headers
): fetch.Response {
  // TODO: test
  // TODO: accept encoding
  const returnEncoding = 'utf-8'
  const retBuffer = Buffer.from(txt, returnEncoding)

  if (!mutableHeaders.has('content-type')) {
    mutableHeaders.set('content-type', `text/plain; charset=${returnEncoding}`)
  }

  return respondBuffer(retBuffer, response, mutableHeaders)
}

const initialResponse: IHttpServerComponent.IResponse = {
  status: 404,
  body: 'Not found'
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
    // Not Implemented
    return new fetch.Response(undefined, { status: 501, statusText: 'Server did not produce a valid response' })
  }

  if (response.status == 101) {
    const cb = getWebSocketCallback(response)
    return withWebSocketCallback(new fetch.Response(void 0, { ...response, body: undefined } as any), cb!)
  }

  if (response instanceof fetch.Response) {
    return new fetch.Response(response.body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    })
  }

  const is1xx = response.status && response.status >= 100 && response.status < 200
  const is204 = response.status == 204
  const is304 = response.status == 304
  const isHEAD = request.method == 'HEAD'

  const mutableHeaders = new fetch.Headers(response.headers as fetch.HeadersInit)

  if (is204 || is304) {
    // TODO: TEST this code path
    mutableHeaders.delete('Content-Type')
    mutableHeaders.delete('Content-Length')
    mutableHeaders.delete('Transfer-Encoding')
  }

  // https://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html#sec4.4
  // the following responses must not contain any content nor content-length
  if (is1xx || is204 || is304 || isHEAD) {
    // TODO: TEST this code path
    return new fetch.Response(undefined, { ...response, headers: mutableHeaders, body: undefined } as any)
  }

  if (Buffer.isBuffer(response.body)) {
    return respondBuffer(response.body, response, mutableHeaders)
  } else if (response.body instanceof ArrayBuffer || response.body instanceof Uint8Array) {
    return respondBuffer(response.body, response, mutableHeaders)
  } else if (typeof response.body == 'string') {
    return respondString(response.body, response, mutableHeaders)
  } else if (response.body instanceof Stream) {
    return new fetch.Response(response.body, response as fetch.ResponseInit)
  } else if (response.body != undefined) {
    // TODO: test
    return respondJson(response.body, response, mutableHeaders)
  }

  // Applications SHOULD use this field to indicate the transfer-length of the
  // message-body, unless this is prohibited by the rules in section 4.4.
  // (https://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html#sec4.4)
  if (!mutableHeaders.has('content-length')) {
    mutableHeaders.set('content-length', '0')
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
  newContext.url = new URL(request.url)

  return newContext
}
