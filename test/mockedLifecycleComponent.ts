import future from 'fp-future'
import { MockedLifecycleComponent } from './test-helpers'

export function createMockedLifecycleComponent(): MockedLifecycleComponent {
  const startupProbe = future<boolean>()
  const readynessProbe = future<boolean>()
  let didStart = false
  let didStop = false

  return {
    get didStart() {
      return didStart
    },
    get didStop() {
      return didStart
    },
    async start() {
      didStart = true
    },
    async stop() {
      didStop = true
    },
    async readynessProbe() {
      if (readynessProbe.isPending) return false
      return readynessProbe
    },
    async startupProbe() {
      if (startupProbe.isPending) return false
      return startupProbe
    },
    setReadynessProbe(p) {
      p.then(readynessProbe.resolve)
    },
    setStartupProbe(p) {
      p.then(startupProbe.resolve)
    }
  }
}
