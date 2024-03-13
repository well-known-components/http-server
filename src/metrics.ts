import { IConfigComponent, IHttpServerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { Router } from './router'

const httpLabels = ['method', 'handler', 'code'] as const

const metrics = {
  http_request_duration_seconds: {
    type: IMetricsComponent.HistogramType,
    help: 'Request duration in seconds.',
    labelNames: httpLabels
  },
  http_requests_total: {
    type: IMetricsComponent.CounterType,
    help: 'Total number of HTTP requests',
    labelNames: httpLabels
  },
  http_request_size_bytes: {
    type: IMetricsComponent.HistogramType,
    help: 'Duration of HTTP requests size in bytes',
    labelNames: httpLabels
  }
}

/**
 * @public
 */
export type HttpMetrics = keyof typeof metrics

/**
 * @public
 */
export function getDefaultHttpMetrics(): IMetricsComponent.MetricsRecordDefinition<HttpMetrics> {
  return metrics
}

const noopStartTimer = { end() {} }

/**
 * Metrics configuration prefix.
 * @public
 */
const CONFIG_PREFIX = 'WKC_METRICS' as const

/**
 * @internal
 */
function _configKey(key: Uppercase<string>): string {
  return `${CONFIG_PREFIX}_${key.toUpperCase().replace(/^(_*)/, '')}`
}

/**
 * @public
 */
export async function instrumentHttpServerWithPromClientRegistry<K extends string>(options: {
  server: IHttpServerComponent<IHttpServerComponent.DefaultContext<any>>
  config: IConfigComponent
  metrics: IMetricsComponent<K | HttpMetrics>
  registry: IMetricsComponent.Registry
}) {
  const { config, registry } = options

  const metricsPath = (await config.getString(_configKey('PUBLIC_PATH'))) || '/metrics'
  const bearerToken = await config.getString(_configKey('BEARER_TOKEN'))
  const resetEveryNight = (await config.getString(_configKey('RESET_AT_NIGHT'))) == 'true'

  const router = new Router<{}>()

  function calculateNextReset() {
    return new Date(new Date(new Date().toDateString()).getTime() + 86400000).getTime()
  }

  let nextReset: number = calculateNextReset()

  // TODO: optional basic auth for /metrics
  router.get(metricsPath, async (ctx) => {
    if (bearerToken) {
      const header = ctx.request.headers.get('authorization')
      if (!header) return { status: 401 }
      const [_, value] = header.split(' ')
      if (value != bearerToken) {
        return { status: 401 }
      }
    }

    const body = await registry.metrics()

    // heavy-metric servers that run for long hours tend to generate precision problems
    // and memory degradation for histograms if not cleared enough. this method
    // resets the metrics once per day at 00.00UTC
    if (resetEveryNight && Date.now() > nextReset) {
      nextReset = calculateNextReset()
      options.metrics.resetAll()
    }

    return {
      status: 200,
      body,
      headers: {
        'content-type': registry.contentType
      }
    }
  })

  options.server.use(async (ctx, next) => {
    let labels = {
      method: ctx.request.method,
      handler: '',
      code: 200
    }
    const startTimerResult = options.metrics.startTimer('http_request_duration_seconds', labels)
    const end = startTimerResult?.end || noopStartTimer.end
    let res: IHttpServerComponent.IResponse | undefined

    try {
      return (res = await next())
    } finally {
      labels.code = (res && res.status) || labels.code

      if ((ctx as any).routerPath) {
        labels.handler = (ctx as any).routerPath
      }

      options.metrics.observe('http_request_size_bytes', labels, ctx.request.size)
      options.metrics.increment('http_requests_total', labels)
      end(labels)
    }
  })

  options.server.use(router.middleware())
}
