import type { IConfigComponent, ILoggerComponent } from "@well-known-components/interfaces"
import type * as http from "http"
import type * as https from "https"
import type { Socket } from "net"

/**
 * @alpha
 * @deprecated Not the final release
 */
export interface WebSocketServer {
  handleUpgrade(
    request: http.IncomingMessage,
    socket: Socket,
    upgradeHead: Buffer,
    callback: (client: any, request: http.IncomingMessage) => void
  ): void
}

/**
 * @public
 */
export type ServerComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  ws?: WebSocketServer
}

/**
 * @public
 */
export type IHttpServerOptions = ({ https: https.ServerOptions } | { http: http.ServerOptions })

/**
 * @public
 */
export type IUwsHttpServerOptions = {
  compression: boolean
}
