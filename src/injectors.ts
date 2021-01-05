import type { IHttpServerComponent } from "@well-known-components/interfaces"
import type * as http from "http"
import type * as https from "https"

const underlyingServerKey = Symbol("real-server")
const underlyingExpressKey = Symbol("real-express")

/**
 * @public
 */
export async function getUnderlyingServer(server: IHttpServerComponent): Promise<http.Server | https.Server> {
  const getListener: () => Promise<http.Server | https.Server> = (server as any)[underlyingServerKey]
  if (!getListener)
    throw new Error("The provided server does not have an underlying http or https server implementation")
  return getListener()
}

/**
 * @internal
 */
export function _setUnderlyingServer(server: IHttpServerComponent, getter: () => Promise<http.Server | https.Server>) {
  ;(server as any)[underlyingServerKey] = getter
}

/**
 * @public
 */
export async function getUnderlyingExpress<T>(server: IHttpServerComponent): Promise<T> {
  const getListener: () => Promise<T> = (server as any)[underlyingExpressKey]
  if (!getListener)
    throw new Error("The provided server does not have an underlying http or https server implementation")
  return getListener()
}

/**
 * @internal
 */
export function _setUnderlyingExpress<T>(server: IHttpServerComponent, getter: () => Promise<T>) {
  ;(server as any)[underlyingExpressKey] = getter
}
