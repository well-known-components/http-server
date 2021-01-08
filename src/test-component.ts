import type { IHttpServerComponent, IHttpServerComponent as http } from "@well-known-components/interfaces"
import { contextFromRequest } from "./logic"
import { compose, Middleware } from "./middleware"
import * as fetch from "node-fetch"

/** @public */
export type ITestHttpServerComponent<Context extends object> = IHttpServerComponent<Context> & {
  dispatchRequest(url: fetch.Request): Promise<http.IResponse>
  dispatchRequest(url: fetch.RequestInfo, init?: fetch.RequestInit): Promise<http.IResponse>
}

/**
 * Creates a http-server component for tests
 * @public
 */
export function createTestServerComponent<Context extends object = {}>(): ITestHttpServerComponent<Context> {
  let currentContext: Context = {} as any
  const listeners: (http.IRequestHandler<any> | Middleware<any>)[] = []

  const ret: ITestHttpServerComponent<Context> = {
    dispatchRequest(url, initRequest?) {
      const dispatch = compose(...listeners)

      const req = url instanceof fetch.Request ? url : new fetch.Request(url, initRequest)
      const ctx = contextFromRequest(currentContext, req)

      return dispatch(ctx, async () => ({}))
    },
    use(handler) {
      listeners.push(handler)
    },
    setContext(ctx) {
      currentContext = Object.create(ctx)
    },
  }
  return ret
}
