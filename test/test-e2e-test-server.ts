import { createConfigComponent } from "@well-known-components/env-config-provider"
import { createLogComponent } from "@well-known-components/logger"
import { createRunner } from "@well-known-components/test-helpers"
import { createTestServerComponent, IFetchComponent, IWebSocketComponent } from "../src"
import { TestComponents } from "./test-helpers"
import wsLib from "ws"

// creates a "mocha-like" describe function to run tests using the test components
export const describeTestE2E = createRunner<TestComponents>({
  async main(program) {
    await program.startComponents()
  },
  initComponents,
})

async function initComponents<C extends object>(): Promise<TestComponents> {
  const logs = await createLogComponent({})

  const config = createConfigComponent({})

  const server = createTestServerComponent<C>()

  const fetch: IFetchComponent = server

  const ws: IWebSocketComponent<wsLib.WebSocket> = {
    createWebSocket(url: string, protocols?: string | string[]) {
      throw new Error("Not implemented")
    },
  }

  return { logs, config, server, fetch, ws }
}
