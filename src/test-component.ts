import type { IHttpServerComponent, IHttpServerComponent as http } from "@well-known-components/interfaces"
import {
  coerceErrorsMiddleware,
  contextFromRequest,
  defaultHandler,
  getDefaultMiddlewares,
  normalizeResponseBody,
} from "./logic"
import { compose, Middleware } from "./middleware"
import * as fetch from "node-fetch"
import { createServerHandler } from "./server-handler"
import { PassThrough, pipeline, Stream } from "stream"

/** @public */
export type IFetchComponent = {
  fetch(url: fetch.Request): Promise<fetch.Response>
  fetch(url: fetch.RequestInfo, init?: fetch.RequestInit): Promise<fetch.Response>
}

/** @public */
export type ITestHttpServerComponent<Context extends object> = IHttpServerComponent<Context> &
  IFetchComponent & {
    resetMiddlewares(): void
  }

/**
 * Creates a http-server component for tests
 * @public
 */
export function createTestServerComponent<Context extends object = {}>(): ITestHttpServerComponent<Context> {
  let currentContext: Context = {} as any

  const serverHandler = createServerHandler<Context>()

  const ret: ITestHttpServerComponent<Context> = {
    async fetch(url, initRequest?) {
      const req = url instanceof fetch.Request ? url : new fetch.Request(url, initRequest)
      req.hostname = req.hostname || req.headers.get("host") || ""
      const res = await serverHandler.processRequest(currentContext, req)
      if (res.body instanceof Stream) {
        // since we have no server and actual socket pipes, what we receive here
        // is a readable stream that needs to be decoupled from it's original
        // stream to ensure a consistent behavior with real servers
        return new Promise<fetch.Response>((resolve, reject) => {
          resolve(new fetch.Response(pipeline(res.body, new PassThrough(), reject), res))
        })
      }
      return res
    },
    use: serverHandler.use,
    setContext(ctx) {
      currentContext = Object.create(ctx)
    },
    resetMiddlewares: serverHandler.resetMiddlewares,
  }
  return ret
}
