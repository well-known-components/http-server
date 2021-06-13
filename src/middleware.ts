import { IHttpServerComponent as http, IMiddlewareAdapterHandler } from "@well-known-components/interfaces"

/**
 * @public
 */
export type Middleware<Ctx> = IMiddlewareAdapterHandler<Ctx, http.IResponse>

/**
 * @public
 */
export function compose<Ctx>(...middlewares: Middleware<Ctx>[]): Middleware<Ctx> {
  if (!Array.isArray(middlewares)) throw new TypeError("Middleware stack must be an array!")

  for (const fn of middlewares) {
    if (typeof fn !== "function") throw new TypeError("Middleware must be composed of functions!")
  }

  return function (context: Ctx, next?: Middleware<Ctx>): Promise<http.IResponse> {
    // last called middleware #
    let index = -1
    return dispatch(0)
    async function dispatch(i: number): Promise<http.IResponse> {
      if (i <= index) {
        throw new Error("next() called multiple times")
      }
      index = i
      let fn: Middleware<Ctx> | undefined = middlewares[i]

      if (i === middlewares.length) fn = next

      if (!fn) return {} as http.IResponse

      return await fn(context, dispatch.bind(null, i + 1))
    }
  }
}
