import type { IHttpServerComponent } from "@well-known-components/interfaces"

const underlyingServerKey = Symbol("real-server")

/**
 * @public
 */
export async function getUnderlyingServer<T>(server: IHttpServerComponent<any>): Promise<T> {
  const getListener: () => Promise<T> = (server as any)[underlyingServerKey]
  if (!getListener)
    throw new Error("The provided server does not have an underlying http or https server implementation")
  return getListener()
}

/**
 * @internal
 */
export function _setUnderlyingServer<T>(
  server: IHttpServerComponent<any>,
  getter: () => Promise<T>
) {
  ;(server as any)[underlyingServerKey] = getter
}