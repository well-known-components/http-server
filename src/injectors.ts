import type { IServerComponent } from "@well-known-components/interfaces"
import type * as http from "http"
import type * as https from "https"

const underlyingServerKey = Symbol("real-server")
const underlyingExpressKey = Symbol("real-express")

export async function getUnderlyingServer(server: IServerComponent): Promise<http.Server | https.Server> {
  const getListener: () => Promise<http.Server | https.Server> = (server as any)[underlyingServerKey]
  if (!getListener)
    throw new Error("The provided server does not have an underlying http or https server implementation")
  return getListener()
}

// @internal
export function setUnderlyingServer(server: IServerComponent, getter: () => Promise<http.Server | https.Server>) {
  ;(server as any)[underlyingServerKey] = getter
}

export async function getUnderlyingExpress<T>(server: IServerComponent): Promise<T> {
  const getListener: () => Promise<T> = (server as any)[underlyingExpressKey]
  if (!getListener)
    throw new Error("The provided server does not have an underlying http or https server implementation")
  return getListener()
}

// @internal
export function setUnderlyingExpress<T>(server: IServerComponent, getter: () => Promise<T>) {
  ;(server as any)[underlyingExpressKey] = getter
}
