import { createConfigComponent } from '@well-known-components/env-config-provider'
import { IConfigComponent, IHttpServerComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { createLogComponent } from '@well-known-components/logger'
import { defaultServerConfig } from '@well-known-components/test-helpers'
import { Headers } from 'node-fetch'
import { Readable } from 'stream'
import { createServerComponent, Router } from '.'

export type TestServerAppContext<OtherComponents> = {
  components: TestServerComponents<OtherComponents>
}

export type TestServerComponents<OtherComponents> = {
  logs: ILoggerComponent
  config: IConfigComponent
  server: IHttpServerComponent<TestServerAppContext<OtherComponents>>
  router: Router<TestServerAppContext<OtherComponents>>
  getBaseUrl: () => Promise<string>
  getUrl: (url: string) => Promise<string>
}

/**
 * Wires together the server and router. Also logs every request that is handled in the process.
 */
export async function wireTestServerComponents<T>(context: TestServerAppContext<T>) {
  const { components } = context

  components.server.setContext(context)

  components.server.use(async function logger(ctx, next) {
    const resetFG = '\u001b[0m'
    const greenFG = '\u001b[32m'
    const greyFG = '\u001b[30;0m'
    const whiteFG = '\u001b[37m'
    process.stderr.write('req ❭ ' + greenFG + ctx.request.method + ' ' + greyFG + ctx.url.toString() + resetFG + '\n')
    for (let [header, value] of ctx.request.headers) {
      process.stderr.write('      ' + whiteFG + header + ': ' + greyFG + value + '\n')
    }

    const response = await next()

    process.stderr.write('res ❬ ' + greenFG + 'HTTP ' + whiteFG + (response.status || 200) + '\n')
    if (response.headers) {
      for (let [header, value] of new Headers(response.headers as any)) {
        process.stderr.write('      ' + whiteFG + header + ': ' + greyFG + value + '\n')
      }
    }
    if (response.body) {
      if (Buffer.isBuffer(response.body)) {
        process.stderr.write(response.body.toString() + '\n')
      } else if (response.body instanceof Readable) {
        process.stderr.write('      ' + '<< STREAM >>\n')
      } else if (typeof response.body == 'string') {
        process.stderr.write('      ' + response.body + '\n')
      } else if (response.body instanceof ArrayBuffer) {
        process.stderr.write('      ' + '<< ArrayBuffer >>\n')
      } else if (typeof response.body == 'object') {
        process.stderr.write('      ' + JSON.stringify(response.body) + '\n')
      } else {
        process.stderr.write('      ' + '<<BODY ' + Object.prototype.toString.apply(response.body) + '>>\n')
      }
    }
    process.stderr.write('\n')

    return response
  })

  components.server.use(components.router.middleware())
}

/**
 * Creates a test server and returns all the components and helpers
 */
export async function initTestServerComponents(): Promise<TestServerComponents<any>> {
  const config = createConfigComponent({ ...defaultServerConfig(), LOG_LEVEL: 'INFO' })

  const logs = await createLogComponent({ config })

  const server = await createServerComponent<TestServerAppContext<any>>({ logs, config }, {})

  const router = new Router<TestServerAppContext<any>>()

  const getBaseUrl = async () => {
    return `http://${await config.requireString('HTTP_SERVER_HOST')}:${await config.requireString('HTTP_SERVER_PORT')}`
  }

  const getUrl = async (url: string) => {
    return (await getBaseUrl()) + url
  }

  return {
    logs,
    config,
    getBaseUrl,
    getUrl,
    router,
    server
  }
}
