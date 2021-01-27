import { contextFromRequest, defaultHandler, getDefaultMiddlewares, normalizeResponseBody } from "./logic"
import { Middleware, compose } from "./middleware"
import * as fetch from "node-fetch"
import { IHttpServerComponent as http } from "@well-known-components/interfaces"

// @internal
export function createServerHandler<Context extends object>() {
  let middlewares: Middleware<Context>[]
  let theFinalHandler: Middleware<Context>

  function doMiddlewareComposition() {
    theFinalHandler = compose(...middlewares)
  }

  function resetMiddlewares() {
    middlewares = getDefaultMiddlewares()
    doMiddlewareComposition()
  }

  // initialize default middleware
  resetMiddlewares()

  const use: http<Context>["use"] = async (handler) => {
    middlewares.push(handler)
    doMiddlewareComposition()
  }

  async function processRequest(currentContext: Context, req: http.IRequest): Promise<fetch.Response> {
    const ctx = contextFromRequest(currentContext, req)
    const res = await theFinalHandler(ctx, defaultHandler)
    return normalizeResponseBody(req, res)
  }

  return {
    resetMiddlewares,
    use,
    processRequest,
  }
}
