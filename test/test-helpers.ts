import {
  IBaseComponent,
  IConfigComponent,
  IFetchComponent,
  IHttpServerComponent,
  ILoggerComponent,
  IStatusCheckCapableComponent
} from '@well-known-components/interfaces'
import { IWebSocketComponent } from '../src'
import wsLib from 'ws'

export type TestComponents = {
  server: IHttpServerComponent<{}> & { resetMiddlewares(): void }
  logs: ILoggerComponent
  config: IConfigComponent
  fetch: IFetchComponent & { isUndici: boolean }
  ws: IWebSocketComponent<wsLib.WebSocket>
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

export function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(reject, ms).unref())
}
