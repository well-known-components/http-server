import { IBaseComponent, IHttpServerComponent, IStatusCheckCapableComponent } from "@well-known-components/interfaces"

/**
 * Binds status checks to the server
 *   GET /health/ready - readyness probe
 *   GET /health/startup - startup probe
 *   GET /health/live - liveness probe
 */
export async function createStatusCheckComponent(components: {
  server: IHttpServerComponent
}): Promise<IBaseComponent> {
  const { server } = components
  const context = { components }

  let mutStartOptions: IBaseComponent.ComponentStartOptions | undefined

  /**
   * Readiness probes indicate whether your application is ready to
   * handle requests. It could be that your application is alive, but
   * that it just can't handle HTTP traffic. In that case, Kubernetes
   * won't kill the container, but it will stop sending it requests.
   * In practical terms, that means the pod is removed from an
   * associated service's "pool" of pods that are handling requests,
   * by marking the pod as "Unready".
   */
  server.registerRoute(context, "GET", "/health/ready", async (ctx, req) => {
    if (!mutStartOptions) {
      return new Response("initializing", { status: 400 })
    }
    if (mutStartOptions.started()) {
      return new Response("ready", { status: 200 })
    } else if (mutStartOptions.live()) {
      return new Response("unready", { status: 400 })
    }
    return new Response("waiting", { status: 400 })
  })

  /**
   * The first probe to run is the Startup probe.
   * When your app starts up, it might need to do a lot of work.
   * It might need to fetch data from remote services, load dlls
   * from plugins, who knows what else. During that process, your
   * app should either not respond to requests, or if it does, it
   * should return a status code of 400 or higher. Once the startup
   * process has finished, you can switch to returning a success
   * result (200) for the startup probe.
   */
  server.registerRoute(context, "GET", "/health/startup", async (ctx, req) => {
    if (!mutStartOptions || !mutStartOptions.started()) {
      return new Response("starting", { status: 400 })
    }

    const components: Record<string, IStatusCheckCapableComponent> = mutStartOptions.getComponents()

    const probes: { name: string; promise: Promise<boolean> }[] = []

    for (let c in components) {
      if (typeof components[c].startupProbe == "function") {
        probes.push({
          name: c,
          promise: new Promise((ok) => {
            components[c].startupProbe!()
              .then(ok)
              .catch(() => ok(false))
          }),
        })
      }
    }

    const results = await Promise.all(probes.map(($) => $.promise))

    const content = probes.map((content, index) => "[component]" + content.name + results[index]).join("\n")

    return new Response(content, { status: results.some(($) => $ == false) ? 400 : 200 })
  })

  /**
   * The liveness probe is what you might expect-it indicates whether
   * the container is alive or not. If a container fails its liveness
   * probe, Kubernetes will kill the pod and restart another.
   */
  server.registerRoute(context, "GET", "/health/live", async (ctx, req) => {
    return new Response("alive", { status: 200 })
  })

  return {
    async start(opt) {
      mutStartOptions = opt
    },
  }
}
