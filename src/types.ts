import type { IConfigComponent, ILoggerComponent } from "@well-known-components/interfaces"
import type { CompressionOptions } from "compression"
import type { CorsOptions } from "cors"
import type * as http from "http"
import type * as https from "https"

/**
 * @public
 */
export type ServerComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
}

/**
 * @public
 */
export type IHttpServerOptions = {
  cors: CorsOptions
  compression: CompressionOptions
} & ({ https: https.ServerOptions } | { http: http.ServerOptions })
