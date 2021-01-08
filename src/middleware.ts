/*
function gen(n) {
  return new Array(n + 1).fill(null).map((_, i) => i)
}
function generateSignature(n) {
  return gen(n).map(i => {
    const ctx = gen(i).map($ => 'Ctx' + ($+1)).join(', ')
    const sigs = gen(i).map($ => `middleware${$}: Middleware<Ctx${$}, ReturnType, Ctx${$ + 1}>`).join(', ')
    return `export function compose<Ctx0, ReturnType, ${ctx}>(${sigs}): ComposedMiddleware<Ctx${i+1}, ReturnType>`
  }).join('\n')
}
console.log(generateSignature(10))

*/

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

  return function (context: Ctx, next?: Middleware<Ctx>) {
    // last called middleware #
    let index = -1
    return dispatch(0)
    function dispatch(i: number): Promise<http.IResponse> {
      if (i <= index) return Promise.reject(new Error("next() called multiple times"))
      index = i
      let fn: Middleware<Ctx> | undefined = middlewares[i]

      if (i === middlewares.length) fn = next

      if (!fn) return Promise.resolve({} as http.IResponse)

      try {
        return Promise.resolve(fn(context, dispatch.bind(null, i + 1)))
      } catch (err) {
        return Promise.reject(err)
      }
    }
  }
}

