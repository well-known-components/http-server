import { createConfigComponent } from "@well-known-components/env-config-provider"
import { createLogComponent } from "@well-known-components/logger"
import { createRunner } from "@well-known-components/test-helpers"
import nodeFetch, { RequestInit } from "node-fetch"
import { createServerComponent, createStatusCheckComponent, IFetchComponent, IWebSocketComponent } from "../src"
import { createUwsHttpServer } from "../src/uws"
import { createMockedLifecycleComponent } from "./mockedLifecycleComponent"
import { TestComponents, TestComponentsWithStatus } from "./test-helpers"
import wsLib, { WebSocketServer } from "ws"
import * as undici from "undici"

let currentPort = 19000



export const testE2EExpress = createRunner<TestComponents>({
  async main(program) {
    await program.startComponents()
  },
  initComponents: createInitComponents({ disableExpress: false, undici: false, uws: false }),
})

const describeE2EWithoutExpress = createRunner<TestComponents>({
  async main(program) {
    await program.startComponents()
  },
  initComponents: createInitComponents({ disableExpress: true, undici: false, uws: false }),
})

const describeE2Euws = createRunner<TestComponents>({
  async main(program) {
    await program.startComponents()
  },
  initComponents: createInitComponents({ disableExpress: true, undici: false, uws: true }),
})

// creates a "mocha-like" describe function to run tests using the test components
export const describeE2E: typeof testE2EExpress = (name, fn) => {
  testE2EExpress("(express) " + name, fn)
  describeE2EWithoutExpress("(http) " + name, fn)
  describeE2EWithStatusChecks("(http status) " + name, fn)
  describeE2EWithStatusChecksAndUndici("(http undici) " + name, fn)
  describeE2Euws("(uws) " + name, fn)
}

export const describeE2EWithStatusChecks = createRunner<TestComponentsWithStatus>({
  async main(program) {
    await program.startComponents()
  },
  async initComponents() {
    return initComponentsWithStatus(false, false)
  },
})

export const describeE2EWithStatusChecksAndUndici = createRunner<TestComponentsWithStatus>({
  async main(program) {
    await program.startComponents()
  },
  async initComponents() {
    return initComponentsWithStatus(true, false)
  },
})

function createInitComponents(options: { disableExpress: boolean; undici: boolean; uws: boolean }) {
  return async function initComponents<C extends object>(): Promise<TestComponents> {
    const logs = await createLogComponent({})

    const config = createConfigComponent({
      HTTP_SERVER_PORT: (currentPort += 1).toString(),
      HTTP_SERVER_HOST: "0.0.0.0",
      UNDICI: options.undici ? "true" : "",
    })

    const protocolHostAndProtocol = `http://${await config.requireString(
      "HTTP_SERVER_HOST"
    )}:${await config.requireNumber("HTTP_SERVER_PORT")}`

    const server = options.uws
      ? await createUwsHttpServer<C>({ logs, config }, {})
      : await createServerComponent<C>({ logs, config, ws: new WebSocketServer({ noServer: true }) }, { disableExpress: options.disableExpress })

    const fetch: IFetchComponent & {isUndici: boolean} = {
      async fetch(url: any, initRequest?: any) {
        if (typeof url == "string" && url.startsWith("/")) {
          return (options.undici ? undici.fetch : nodeFetch)(protocolHostAndProtocol + url, { ...initRequest }) as any
        } else {
          return (options.undici ? undici.fetch : nodeFetch)(url, { ...initRequest }) as any
        }
      },
      isUndici: !!options.undici
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

async function initComponentsWithStatus<C extends object>(
  undici: boolean,
  uws: boolean
): Promise<TestComponentsWithStatus> {
  const components = await createInitComponents({ disableExpress: false, undici, uws })<C>()

  const status = await createStatusCheckComponent({ server: components.server, config: components.config })

  return {
    ...components,
    status,
    database: createMockedLifecycleComponent(),
    kafka: createMockedLifecycleComponent(),
  }
}
