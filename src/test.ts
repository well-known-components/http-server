import type { IHttpServerComponent, IHttpServerComponent as http } from "@well-known-components/interfaces"
import { contextFromRequest } from "./logic"
import { compose, Middleware } from "./middleware"

export type ITestHttpServerComponent<Context extends object> = IHttpServerComponent<Context> & {
  dispatchRequest(req: http.IRequest): Promise<http.IResponse>
}

/**
 * Creates a http-server component for tests
 * @public
 */
export async function createTestServerComponent<Context extends object = {}>(): Promise<
  ITestHttpServerComponent<Context>
> {
  let currentContext: Context = {} as any
  const listeners: (http.IRequestHandler<any> | Middleware<any>)[] = []

  return {
    dispatchRequest(request) {
      const dispatch = compose(...listeners)

      const ctx = contextFromRequest(currentContext, request)

      return dispatch(ctx)
    },
    use(handler) {
      listeners.push(handler)
    },
    setContext(ctx) {
      currentContext = Object.create(ctx)
    },
  }
}
