import { IConfigComponent, IHttpServerComponent, ILoggerComponent, Lifecycle } from "@well-known-components/interfaces"
import { IFetchComponent } from "../src"

export type TestComponents = {
  server: IHttpServerComponent<{}> & { resetMiddlewares(): void }
  logs: ILoggerComponent
  config: IConfigComponent
  fetch: IFetchComponent
}
