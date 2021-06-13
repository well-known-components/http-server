import { createConfigComponent } from "@well-known-components/env-config-provider"
import { createLogComponent } from "@well-known-components/logger"
import { createRunner } from "@well-known-components/test-helpers"
import nodeFetch, { RequestInit } from "node-fetch"
import { createServerComponent, createStatusCheckComponent, IFetchComponent } from "../src"
import { createMockedLifecycleComponent } from "./mockedLifecycleComponent"
import { TestComponents, TestComponentsWithStatus } from "./test-helpers"

let currentPort = 19000

// creates a "mocha-like" describe function to run tests using the test components
export const describeE2E = createRunner<TestComponents>({
  async main(program) {
    await program.startComponents()
  },
  initComponents,
})

export const describeE2EWithStatusChecks = createRunner<TestComponentsWithStatus>({
  async main(program) {
    await program.startComponents()
  },
  initComponents: initComponentsWithStatus,
})

async function initComponents<C extends object>(): Promise<TestComponents> {
  const logs = createLogComponent()

  const config = createConfigComponent({
    HTTP_SERVER_PORT: currentPort + 1,
    HTTP_SERVER_HOST: "0.0.0.0",
  })

  const protocolHostAndProtocol = `http://${await config.requireString(
    "HTTP_SERVER_HOST"
  )}:${await config.requireNumber("HTTP_SERVER_PORT")}`

  const server = await createServerComponent<C>({ logs, config }, {})

  const fetch: IFetchComponent = {
    async fetch(url: any, initRequest?: any) {
      if (typeof url == "string" && url.startsWith("/")) {
        return nodeFetch(protocolHostAndProtocol + url, { ...initRequest })
      } else {
        return nodeFetch(url, { ...initRequest })
      }
    },
  }

  return { logs, config, server, fetch }
}

async function initComponentsWithStatus<C extends object>(): Promise<TestComponentsWithStatus> {
  const components = await initComponents<C>()

  const status = await createStatusCheckComponent({ server: components.server, config: components.config })

  return {
    ...components,
    status,
    database: createMockedLifecycleComponent(),
    kafka: createMockedLifecycleComponent(),
  }
}
