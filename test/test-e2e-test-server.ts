import { createConfigComponent } from "@well-known-components/env-config-provider"
import { createLogComponent } from "@well-known-components/logger"
import { createRunner } from "@well-known-components/test-helpers"
import { createStatusCheckComponent, createTestServerComponent, IFetchComponent } from "../src"
import { TestComponents } from "./test-helpers"

// creates a "mocha-like" describe function to run tests using the test components
export const describeTestE2E = createRunner<TestComponents>({
  async main(program) {
    await program.startComponents()
  },
  initComponents,
})

async function initComponents<C extends object>(): Promise<TestComponents> {
  const logs = createLogComponent()

  const config = createConfigComponent({})

  const server = createTestServerComponent<C>()

  const fetch: IFetchComponent = server

  return { logs, config, server, fetch }
}
