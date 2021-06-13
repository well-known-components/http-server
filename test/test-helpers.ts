import {
  IBaseComponent,
  IConfigComponent,
  IHttpServerComponent,
  ILoggerComponent,
  IStatusCheckCapableComponent,
} from "@well-known-components/interfaces"
import { IFetchComponent } from "../src"

export type TestComponents = {
  server: IHttpServerComponent<{}> & { resetMiddlewares(): void }
  logs: ILoggerComponent
  config: IConfigComponent
  fetch: IFetchComponent
}

export type TestComponentsWithStatus = TestComponents & {
  status: IBaseComponent
  kafka: MockedLifecycleComponent
  database: MockedLifecycleComponent
}

// used to test the status checks
export type MockedLifecycleComponent = IBaseComponent &
  IStatusCheckCapableComponent & {
    readonly didStart: boolean
    readonly didStop: boolean
    setStartupProbe(result: Promise<boolean>): void
    setReadynessProbe(result: Promise<boolean>): void
  }
