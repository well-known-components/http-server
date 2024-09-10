import { createRunner } from '@well-known-components/test-helpers'
import { initTestServerComponents, TestServerComponents, wireTestServerComponents } from '../src/test-server'

export const testWithServer = createRunner<TestServerComponents<any>>({
  async main(program) {
    await wireTestServerComponents({ components: program.components })
    await program.startComponents()
  },
  async initComponents() {
    return initTestServerComponents()
  }
})
