import {
  IBaseComponent,
  IConfigComponent,
  IHttpServerComponent,
  IStatusCheckCapableComponent,
} from "@well-known-components/interfaces"
import { Router } from "./router"

/**
 * @beta
 */
export type StandardStatusResponse = {
  status: "pass" | "fail" | "warn"
  version?: string
  releaseId?: string
  notes?: string[]
  output?: string
  serviceId?: string
  description?: string
  details: Record<string, StandardStatusResponseDetail>
}

/**
 * @beta
 */
export type StandardStatusResponseDetail = {
  status: "pass" | "fail" | "warn"
  componentType?: string
  componentId?: string
}

/**
 * Binds status checks to the server
 *  - GET /health/ready - readyness probe
 *  - GET /health/startup - startup probe
 *  - GET /health/live - liveness probe
 * @public
 */
export async function createStatusCheckComponent<Context extends object = {}>(components: {
  server: IHttpServerComponent<Context>
  config: IConfigComponent
}): Promise<IBaseComponent> {
  const { server } = components

  let mutStartOptions: IBaseComponent.ComponentStartOptions | undefined

  const routes = new Router()

  const SUCCESSFUL_STATUS = 200
  const FAILED_STATUS = 503
  const MIME = "application/health+json; charset=utf-8"

  async function getDetails(startup: boolean): Promise<StandardStatusResponse | null> {
    if (!mutStartOptions) {
      return null
    }
    const components: Record<string, IStatusCheckCapableComponent> = mutStartOptions.getComponents()

    const probes: { name: string; promise: Promise<boolean> }[] = []

    let functionName: "startupProbe" | "readynessProbe" = startup ? "startupProbe" : "readynessProbe"

    for (let c in components) {
      if (typeof components[c][functionName] == "function") {
        probes.push({
          name: c,
          promise: new Promise((ok) => {
            components[c][functionName]!()
              .then(ok)
              .catch(() => ok(false))
          }),
        })
      }
    }

    const results = await Promise.all(probes.map(($) => $.promise))

    const content: StandardStatusResponse = {
      details: {},
      status: results.some(($) => $ == false) ? "fail" : "pass",
    }

    for (let it of probes) {
      content.details[it.name] = {
        status: (await it.promise) ? "pass" : "fail",
      }
    }

    return content
  }

  /**
   * Readiness probes indicate whether your application is ready to
   * handle requests. It could be that your application is alive, but
   * that it just can't handle HTTP traffic. In that case, Kubernetes
   * won't kill the container, but it will stop sending it requests.
   * In practical terms, that means the pod is removed from an
   * associated service's "pool" of pods that are handling requests,
   * by marking the pod as "Unready".
   */
  routes.get("/health/ready", async () => {
    if (!mutStartOptions) {
      return {
        body: { status: "initializing" },
        status: FAILED_STATUS,
        headers: {
          "content-type": MIME,
        },
      }
    }
    if (mutStartOptions.started()) {
      const content: StandardStatusResponse = (await getDetails(false))!

      return {
        status: content.status == "pass" ? SUCCESSFUL_STATUS : FAILED_STATUS,
        body: content,
        headers: {
          "content-type": MIME,
        },
      }
    } else if (mutStartOptions.live()) {
      return {
        body: "unready",
        status: FAILED_STATUS,
        headers: {
          "content-type": MIME,
        },
      }
    }
    return {
      body: "waiting",
      status: FAILED_STATUS,
      headers: {
        "content-type": MIME,
      },
    }
  })

  /**
   * The first probe to run is the Startup probe.
   * When your app starts up, it might need to do a lot of work.
   * It might need to fetch data from remote services, load dlls
   * from plugins, who knows what else. During that process, your
   * app should either not respond to requests, or if it does, it
   * should return a status code of 400 or higher. Once the startup
   * process has finished, you can switch to returning a success
   * res (200) for the startup probe.
   */
  routes.get("/health/startup", async () => {
    if (!mutStartOptions) {
      return {
        body: {
          status: "bootstrapping",
        },
        headers: {
          "content-type": MIME,
        },
        status: FAILED_STATUS,
      }
    } else if (!mutStartOptions.started()) {
      return {
        body: {
          status: "starting",
        },
        headers: {
          "content-type": MIME,
        },
        status: FAILED_STATUS,
      }
    }

    const content: StandardStatusResponse = (await getDetails(true))!

    return {
      status: content.status == "pass" ? SUCCESSFUL_STATUS : FAILED_STATUS,
      body: content,
      headers: {
        "content-type": MIME,
      },
    }
  })

  /**
   * The liveness probe is what you might expect-it indicates whether
   * the container is alive or not. If a container fails its liveness
   * probe, Kubernetes will kill the pod and restart another.
   */
  routes.get("/health/live", async () => {
    return { status: SUCCESSFUL_STATUS, body: "alive" }
  })

  const middleware = routes.middleware()
  server.use(middleware)

  return {
    async start(opt) {
      process.stderr.write("START CALLED")
      mutStartOptions = opt
    },
  }
}
