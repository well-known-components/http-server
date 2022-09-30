// this server shuts down after 10100 requests.

import { IConfigComponent, IHttpServerComponent, ILoggerComponent, Lifecycle } from "@well-known-components/interfaces"
import { createConfigComponent } from "@well-known-components/env-config-provider"
import { createServerComponent } from "./index"
import { createLogComponent } from "@well-known-components/logger"
import { readFileSync } from "fs"
import { createUwsHttpServer } from "./uws"

// Record of components
type Components = {
  config: IConfigComponent
  logs: ILoggerComponent
  server: IHttpServerComponent<AppContext>
}

// Context passed to all handlers, we always include the components
// here
type AppContext = {
  components: Components
}

// Lifecycle.run manages the lifecycle of the application and components
// it is particularly useful for servers with many components with state
// like database connectors, servers, or batch jobs.
// It also handles POSIX signals like SIGTERM to gracefully stop the
// components
Lifecycle.run<Components>({ initComponents, main })

// main entry point of the application, it's role is to wire components
// together (controllers, handlers) and ultimately start the components
// by calling startComponents
async function main({ components, startComponents, stop }: Lifecycle.EntryPointParameters<Components>) {
  const globalContext: AppContext = { components }

  // wire the server
  components.server.setContext(globalContext)

  components.server.use(async function logger(ctx, next) {
    // Log the response time of all the requests handled by this server
    return await next()
  })

  let counter = 0

  const staticBuffer = Buffer.from(new Array(10000).fill(0).map(() => Math.floor(Math.random() * 256)))
  const staticArrayBuffer = new Uint8Array(staticBuffer)
  const packageJsonString = readFileSync("package.json").toString()
  const packageJson = JSON.parse(packageJsonString)

  const TOTAL_REQUESTS = 10100
  const TOTAL_STAGES = 5

  components.server.use(async function handler(ctx) {
    counter++
    if (counter >= TOTAL_REQUESTS) {
      setTimeout(() => stop().catch(console.log), 0)
    }

    const stage = Math.floor((counter / TOTAL_REQUESTS) * TOTAL_STAGES)

    switch (stage) {
      case 1:
        return {
          status: 200,
          body: staticBuffer,
        }
      case 2:
        return {
          status: 200,
          body: staticArrayBuffer,
        }
      case 3:
        return {
          status: 200,
          body: packageJsonString,
        }
      case 4:
        return {
          status: 200,
          body: packageJson,
        }
    }

    // Respond hello world
    return {
      status: 200,
      body: {
        json: true,
        text: "Hello world",
      },
    }
  })

  // start server and other components
  await startComponents()
}

// initComponents role is to create BUT NOT START the components,
// this function is only called once by the Lifecycle manager
async function initComponents(): Promise<Components> {
  const logs = await createLogComponent({})

  const config = createConfigComponent({
    HTTP_SERVER_PORT: "5000",
    HTTP_SERVER_HOST: "0.0.0.0",
  })

  const server = process.env.UWS
    ? await createUwsHttpServer<AppContext>({ logs, config }, {})
    : await createServerComponent<AppContext>(
        { logs, config },
        { disableExpress: process.env.DISABLE_EXPRESS == "true" }
      )

  return /*components*/ {
    logs,
    config,
    server,
  }
}
