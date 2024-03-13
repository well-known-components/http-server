import { createConfigComponent } from "@well-known-components/env-config-provider"
import { createLogComponent } from "@well-known-components/logger"
import { createRunner } from "@well-known-components/test-helpers"
import nodeFetch from "node-fetch"
import { createServerComponent, createStatusCheckComponent, IWebSocketComponent } from "../src"
import { createMockedLifecycleComponent } from "./mockedLifecycleComponent"
import { TestComponents, TestComponentsWithStatus } from "./test-helpers"
import wsLib, { WebSocketServer } from "ws"
import * as undici from "undici"
import { IFetchComponent } from "@well-known-components/interfaces"

let currentPort = 19000

const describeE2ETest = createRunner<TestComponents>({
  async main(program) {
    await program.startComponents()
  },
  initComponents: createInitComponents({ undici: false }),
})

// creates a "mocha-like" describe function to run tests using the test components
export const describeE2E: typeof describeE2ETest = (name, fn) => {
  describeE2ETest("(http) " + name, fn)
  describeE2EWithStatusChecks("(http status) " + name, fn)
  describeE2EWithStatusChecksAndUndici("(http undici) " + name, fn)
}

export const describeE2EWithStatusChecks = createRunner<TestComponentsWithStatus>({
  async main(program) {
    await program.startComponents()
  },
  async initComponents() {
    return initComponentsWithStatus(false)
  },
})

export const describeE2EWithStatusChecksAndUndici = createRunner<TestComponentsWithStatus>({
  async main(program) {
    await program.startComponents()
  },
  async initComponents() {
    return initComponentsWithStatus(true)
  },
})

function createInitComponents(options: { undici: boolean }) {
  return async function initComponents<C extends object>(): Promise<TestComponents> {
    const logs = await createLogComponent({})

    const config = createConfigComponent({
      HTTP_SERVER_PORT: (currentPort += 1).toString(),
      HTTP_SERVER_HOST: "0.0.0.0",
      UNDICI: options.undici ? "true" : "",
    })

    const protocolHostAndProtocol = `http://${await config.requireString(
      "HTTP_SERVER_HOST",
    )}:${await config.requireNumber("HTTP_SERVER_PORT")}`

    const server = await createServerComponent<C>({ logs, config, ws: new WebSocketServer({ noServer: true }) }, {})

    const fetch: IFetchComponent & { isUndici: boolean } = {
      async fetch(url: any, initRequest?: any) {
        if (typeof url == "string" && url.startsWith("/")) {
          return (options.undici ? undici.fetch : nodeFetch)(protocolHostAndProtocol + url, { ...initRequest }) as any
        } else {
          return (options.undici ? undici.fetch : nodeFetch)(url, { ...initRequest }) as any
        }
      },
      isUndici: !!options.undici,
    }

    const ws: IWebSocketComponent<wsLib.WebSocket> = {
      createWebSocket(url: string, protocols?: string | string[]) {
        if (typeof url == "string" && url.startsWith("/")) {
          return new wsLib.WebSocket(protocolHostAndProtocol.replace(/^http/, "ws") + url, protocols)
        } else {
          return new wsLib.WebSocket(url, protocols)
        }
      },
    }

    return { logs, config, server, fetch, ws }
  }
}

async function initComponentsWithStatus<C extends object>(undici: boolean): Promise<TestComponentsWithStatus> {
  const components = await createInitComponents({ undici })<C>()

  const status = await createStatusCheckComponent({ server: components.server, config: components.config })

  return {
    ...components,
    status,
    database: createMockedLifecycleComponent(),
    kafka: createMockedLifecycleComponent(),
  }
}
