import { createConfigComponent } from "@well-known-components/env-config-provider"
import { createLogComponent } from "@well-known-components/logger"
import { createTestServerComponent, IFetchComponent } from "../src"
import { createE2ERunner, TestComponents } from "./test-helpers"

let currentPort = 19000

// creates a "mocha-like" describe function to run tests using the test components
export const describeTestE2E = createE2ERunner({
  async main(components) {},
  initComponents,
})

async function initComponents<C extends object>(): Promise<TestComponents<C>> {
  const logs = createLogComponent()

  const config = createConfigComponent({})

  const server = createTestServerComponent<C>()

  const fetch: IFetchComponent = server

  return { logs, config, server, fetch }
}
