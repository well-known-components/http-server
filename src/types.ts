import type { IConfigComponent, ILoggerComponent } from "@well-known-components/interfaces"
import type * as http from "http"
import type * as https from "https"
import type { Socket } from "net"
import { CorsOptions } from "./cors"

/**
 * @alpha
 * @deprecated Not the final release
 */
export interface WebSocketServer {
  handleUpgrade(
    request: http.IncomingMessage,
    socket: Socket,
    upgradeHead: Buffer,
    callback: (client: any, request: http.IncomingMessage) => void,
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
export type IHttpServerOptions = {
  cors?: CorsOptions
  proxyHandler?: (request: http.IncomingMessage, response: http.ServerResponse, next: () => void) => Promise<void>
} & ({ https: https.ServerOptions } | { http: http.ServerOptions })
