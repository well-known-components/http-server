import { createConfigComponent } from "@well-known-components/env-config-provider"
import { createLogComponent } from "@well-known-components/logger"
import { createRunner } from "@well-known-components/test-helpers"
import nodeFetch, { RequestInit } from "node-fetch"
import { createServerComponent, createStatusCheckComponent, IFetchComponent, IWebSocketComponent } from "../src"
import { createMockedLifecycleComponent } from "./mockedLifecycleComponent"
import { TestComponents, TestComponentsWithStatus } from "./test-helpers"
import wsLib, { WebSocketServer } from "ws"

let currentPort = 19000

const e2eRunner = createRunner<TestComponents>({
  async main(program) {
    await program.startComponents()
  },
  initComponents: createInitComponents({ disableExpress: false }),
})

const describeE2EWithoutExpress = createRunner<TestComponents>({
  async main(program) {
    await program.startComponents()
  },
  initComponents: createInitComponents({ disableExpress: true }),
})

// creates a "mocha-like" describe function to run tests using the test components
export const describeE2E: typeof e2eRunner = (name, fn) => {
  e2eRunner("(express) " + name, fn)
  describeE2EWithoutExpress("(http) " + name, fn)
}

export const describeE2EWithStatusChecks = createRunner<TestComponentsWithStatus>({
  async main(program) {
    await program.startComponents()
  },
  initComponents: initComponentsWithStatus,
})

function createInitComponents(options: { disableExpress: boolean }) {
  return async function initComponents<C extends object>(): Promise<TestComponents> {
    const logs = await createLogComponent({})

    const config = createConfigComponent({
      HTTP_SERVER_PORT: (currentPort += 1).toString(),
      HTTP_SERVER_HOST: "0.0.0.0",
    })

    const protocolHostAndProtocol = `http://${await config.requireString(
      "HTTP_SERVER_HOST"
    )}:${await config.requireNumber("HTTP_SERVER_PORT")}`

    const wss = new WebSocketServer({ noServer: true })

    const server = await createServerComponent<C>({ logs, config, ws: wss }, { disableExpress: options.disableExpress })

    const fetch: IFetchComponent = {
      async fetch(url: any, initRequest?: any) {
        if (typeof url == "string" && url.startsWith("/")) {
          return nodeFetch(protocolHostAndProtocol + url, { ...initRequest })
        } else {
          return nodeFetch(url, { ...initRequest })
        }
      },
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

async function initComponentsWithStatus<C extends object>(): Promise<TestComponentsWithStatus> {
  const components = await createInitComponents({ disableExpress: false })<C>()

  const status = await createStatusCheckComponent({ server: components.server, config: components.config })

  return {
    ...components,
    status,
    database: createMockedLifecycleComponent(),
    kafka: createMockedLifecycleComponent(),
  }
}
