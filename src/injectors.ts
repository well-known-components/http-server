import type { IHttpServerComponent } from "@well-known-components/interfaces"
import type * as http from "http"
import type * as https from "https"

const underlyingServerKey = Symbol("real-server")

/**
 * @public
 */
export async function getUnderlyingServer(server: IHttpServerComponent<any>): Promise<http.Server | https.Server> {
  const getListener: () => Promise<http.Server | https.Server> = (server as any)[underlyingServerKey]
  if (!getListener)
    throw new Error("The provided server does not have an underlying http or https server implementation")
  return getListener()
}

/**
 * @internal
 */
export function _setUnderlyingServer(
  server: IHttpServerComponent<any>,
  getter: () => Promise<http.Server | https.Server>
) {
  ;(server as any)[underlyingServerKey] = getter
}