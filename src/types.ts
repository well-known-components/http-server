import type { IConfigComponent, ILoggerComponent } from "@well-known-components/interfaces"
import type { CompressionOptions } from "compression"
import type { CorsOptions } from "cors"
import type * as http from "http"
import type * as https from "https"
import type { Socket } from "net"

interface WebSocketServer {
  handleUpgrade(
    request: http.IncomingMessage,
    socket: Socket,
    upgradeHead: Buffer,
    callback: (client: any, request: http.IncomingMessage) => void,
  ): void;

  emit(event: 'connection', socket: any, request: http.IncomingMessage): void
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
  cors: CorsOptions
  compression: CompressionOptions
} & ({ https: https.ServerOptions } | { http: http.ServerOptions })
