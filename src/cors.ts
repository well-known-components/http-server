// Temporary fix to enable local develoment until this CORS module is merged into http-server

import { Headers, Request, Response } from 'node-fetch'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'ETag',
  'Access-Control-Allow-Headers':
    'Accept, Accept-Encoding, Access-Control-Allow-Credentials, Access-Control-Allow-Headers, Access-Control-Allow-Methods, Access-Control-Allow-Origin, ' +
    'Access-Control-Max-Age, Age, Allow,Authentication-Info, Authorization, CONNECT, Cache-Control, Connection, Content-Base, Content-Length, Content-Location, ' +
    'Content-MD5, Content-Type, Content-Version, Cookie, DELETE, Destination, Expires, ETag, From, GET, HEAD, Host, Keep-Alive, Location, MIME-Version, OPTION, OPTIONS, ' +
    'Optional, Origin, POST, PUT, Protocol, Proxy-Authenticate, Proxy-Authentication-Info, Proxy-Authorization, Proxy-Features, Public, Referer, Refresh, Resolver-Location, ' +
    'Sec-Websocket-Extensions, Sec-Websocket-Key, Sec-Websocket-Origin, Sec-Websocket-Protocol, Sec-Websocket-Version, Security-Scheme, Server, Set-Cookie, et-Cookie2, SetProfile, ' +
    'Status, Timeout, Title, URI, User-Agent, Version, WWW-Authenticate, X-Content-Duration, X-Content-Security-Policy, X-Content-Type-Options, X-CustomHeader, X-DNSPrefetch-Control, ' +
    'X-Forwarded-For, X-Forwarded-Port, X-Forwarded-Proto, X-Frame-Options, X-Modified, X-OTHER, X-PING, X-Requested-With'
}

export function handleOptions() {
  return new Response(undefined, {
    headers: corsHeaders
  })
}

type CustomOrigin = (requestOrigin: string | undefined) => boolean

export interface CorsOptions {
  /**
   * @default '*''
   */
  origin?: boolean | string | (string | RegExp)[] | CustomOrigin
  /**
   * @default 'GET,HEAD,PUT,PATCH,POST,DELETE'
   */
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  credentials?: boolean
  maxAge?: number
  /**
   * @default false
   */
  preflightContinue?: boolean
  /**
   * @default 204
   */
  optionsSuccessStatus?: number
}

function isString(s: any): s is string {
  return typeof s === 'string' || s instanceof String
}

function isOriginAllowed(
  origin: string,
  allowedOrigin: (string | RegExp)[] | RegExp | string | boolean | CustomOrigin
) {
  if (Array.isArray(allowedOrigin)) {
    for (let i = 0; i < allowedOrigin.length; ++i) {
      if (isOriginAllowed(origin, allowedOrigin[i])) {
        return true
      }
    }
    return false
  } else if (isString(allowedOrigin)) {
    return origin === allowedOrigin
  } else if (allowedOrigin instanceof RegExp) {
    return allowedOrigin.test(origin)
  } else if (allowedOrigin instanceof Function) {
    return allowedOrigin(origin)
  } else {
    return !!allowedOrigin
  }
}

function configureOrigin(options: CorsOptions, req: Request, headers: Headers) {
  const requestOrigin = req.headers.get('origin')
  let isAllowed: boolean = false

  if (!options.origin || options.origin === '*') {
    // allow any origin
    headers.set('Access-Control-Allow-Origin', '*')
  } else if (isString(options.origin)) {
    // fixed origin
    headers.set('Access-Control-Allow-Origin', options.origin)
    headers.set('Vary', 'Origin')
  } else if (requestOrigin && options.origin) {
    isAllowed = isOriginAllowed(requestOrigin, options.origin)
    // reflect origin
    headers.set('Access-Control-Allow-Origin', isAllowed ? requestOrigin : 'false')
    headers.set('Vary', 'Origin')
  }
}

function configureMethods(options: CorsOptions, req: Request, headers: Headers) {
  if (options.methods && options.methods.length) {
    headers.set('Access-Control-Allow-Methods', options.methods.join(','))
  }
}

function configureCredentials(options: CorsOptions, req: Request, headers: Headers) {
  if (options.credentials === true) {
    headers.set('Access-Control-Allow-Credentials', 'true')
  }
}

function configureAllowedHeaders(options: CorsOptions, req: Request, headers: Headers) {
  let allowedHeaders: string[] | string | null = options.allowedHeaders || null

  if (!allowedHeaders) {
    allowedHeaders = req.headers.get('access-control-request-headers')! // .headers wasn't specified, so reflect the request headers
    headers.set('Vary', 'Access-Control-Request-Headers')
  }
  if (allowedHeaders && !isString(allowedHeaders)) {
    allowedHeaders = allowedHeaders.join(',') // .headers is an array, so turn it into a string
  }
  if (allowedHeaders && allowedHeaders.length) {
    headers.set('Access-Control-Allow-Headers', allowedHeaders)
  }
}

function configureExposedHeaders(options: CorsOptions, req: Request, headers: Headers) {
  const exposedHeaders = options.exposedHeaders
  if (exposedHeaders && exposedHeaders.length) {
    headers.set('Access-Control-Expose-Headers', exposedHeaders.join(','))
  }
}

function configureMaxAge(options: CorsOptions, req: Request, headers: Headers) {
  if (options.maxAge !== undefined) {
    headers.set('Access-Control-Max-Age', options.maxAge.toString())
  }
}

export function createCorsMiddleware<Context>(options: CorsOptions): IHttpServerComponent.IRequestHandler<Context> {
  return async function handleCors(event, next): Promise<IHttpServerComponent.IResponse> {
    const request = event.request

    const method = request.method && request.method.toUpperCase && request.method.toUpperCase()

    if (method === 'OPTIONS') {
      if (options.preflightContinue) {
        return await next()
      } else {
        const headers = new Headers()

        // preflight
        configureOrigin(options, request, headers)
        configureCredentials(options, request, headers)
        configureMethods(options, request, headers)
        configureAllowedHeaders(options, request, headers)
        configureMaxAge(options, request, headers)
        configureExposedHeaders(options, request, headers)

        headers.set('Content-Length', '0')
        return { status: options.optionsSuccessStatus || 204, headers }
      }
    } else {
      const r = await next()

      const headers = new Headers(r.headers)

      if (event.request.headers.has('origin')) {
        // actual response
        configureOrigin(options, request, headers)
        configureCredentials(options, request, headers)
        configureExposedHeaders(options, request, headers)
      }

      return { ...r, headers }
    }
  }
}
