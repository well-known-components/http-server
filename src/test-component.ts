import type { IHttpServerComponent } from "@well-known-components/interfaces"
import * as fetch from "node-fetch"
import { createServerHandler } from "./server-handler"
import { PassThrough, pipeline, Stream } from "stream"
import { IFetchComponent } from "@well-known-components/interfaces"

/** @alpha */
export type IWebSocketComponent<W = WebSocket> = {
  createWebSocket(url: string, protocols?: string | string[]): W
}

/** @public */
export type ITestHttpServerComponent<Context extends object> = IHttpServerComponent<Context> &
  IFetchComponent & {
    resetMiddlewares(): void
  }

/**
 * @alpha
 */
export type TestServerWithWs = {
  ws(path: string, protocols: string | string[]): WebSocket
}

/**
 * Creates a http-server component for tests
 * @public
 */
export function createTestServerComponent<Context extends object = {}>(): ITestHttpServerComponent<Context> {
  let currentContext: Context = {} as any

  const serverHandler = createServerHandler<Context>()

  const ret: ITestHttpServerComponent<Context> = {
    async fetch(url: any, initRequest?: any) {
      let req: fetch.Request

      if (url instanceof fetch.Request) {
        req = url
      } else {
        const tempHeaders = new fetch.Headers(initRequest?.headers)
        const hostname = tempHeaders.get("X-Forwarded-Host") || tempHeaders.get("host") || "0.0.0.0"
        const protocol = tempHeaders.get("X-Forwarded-Proto") == "https" ? "https" : "http"
        let newUrl = new URL(protocol + "://" + hostname + url)
        try {
          newUrl = new URL(url, protocol + "://" + hostname)
        } catch {}
        req = new fetch.Request(newUrl.toString(), initRequest)
      }

      try {
        const res = await serverHandler.processRequest(currentContext, req)
        if (res.body instanceof Stream) {
          // since we have no server and actual socket pipes, what we receive here
          // is a readable stream that needs to be decoupled from it's original
          // stream to ensure a consistent behavior with real servers
          return new Promise<fetch.Response>((resolve, reject) => {
            resolve(new fetch.Response(pipeline(res.body!, new PassThrough(), reject), res))
          })
        }

        return res
      } catch (error: any) {
        console.error(error)
        return new fetch.Response("DEV-SERVER-ERROR: " + (error.stack || error.toString()), { status: 500 })
      }
    },
    use: serverHandler.use,
    setContext(ctx) {
      currentContext = Object.create(ctx)
    },
    resetMiddlewares: serverHandler.resetMiddlewares,
  }
  return ret
}
