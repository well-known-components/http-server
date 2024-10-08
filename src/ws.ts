import { IHttpServerComponent } from '@well-known-components/interfaces'

const wsSymbol = Symbol('WebSocketResponse')

export type WebSocketCallback = (ws: WebSocket) => Promise<void> | void

/**
 * @alpha
 * @deprecated Not stable
 */
export function upgradeWebSocketResponse(cb: WebSocketCallback): IHttpServerComponent.IResponse {
  return withWebSocketCallback(
    {
      status: 101
    },
    cb
  )
}

/**
 * @internal
 * @deprecated Not stable
 */
export function withWebSocketCallback<T extends object>(obj: T, cb: WebSocketCallback): T {
  ;(obj as any)[wsSymbol] = cb
  return obj
}

/**
 * @internal
 * @deprecated Not stable
 */
export function getWebSocketCallback<T extends object>(obj: T): WebSocketCallback | null {
  return (obj as any)[wsSymbol] || null
}
