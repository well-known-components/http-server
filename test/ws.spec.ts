import future from "fp-future"
import { getUnderlyingServer } from "../src"
import { Router } from "../src/router"
import { createTestServerComponent } from "../src/test-component"
import { upgradeWebSocketResponse } from "../src/ws"
import { describeE2E, describeE2Euws } from "./test-e2e-harness"
import { TemplatedApp } from "uWebSockets.js"
import { timeout } from "./test-helpers"

describe("upgrade requests with router", () => {
  it("responds 201 to endpoint without Upgrade header and .get", async () => {
    const server = createTestServerComponent()

    const router = new Router()

    router.get("/ws", async (ctx) => {
      if (ctx.request.headers.get("upgrade") == "websocket") {
        return upgradeWebSocketResponse((sock) => {
          sock.send("hola vite")
          sock.close()
        })
      }
      return { status: 201 }
    })

    server.use(router.middleware())
    server.use(router.allowedMethods())

    {
      const res = await server.fetch(`/ws`)
      expect(res.status).toEqual(201)
    }

    {
      const res = await server.fetch(`/ws`, { headers: { Upgrade: "websocket" } })
      expect(res.status).toEqual(101)
    }
  })
})

describeE2E("with real websockets (ws)", ({ components }) => {
  it("awaits for WebSocketResult", async () => {
    const { server, ws } = components

    const didReturnWebSocket = future<any>()
    const didCloseServerWebSocket = future<any>()
    const didReceiveMessageFromServer = future<any>()

    const router = new Router()

    router.get("/ws", async (ctx) => {
      if (ctx.request.headers.get("upgrade") == "websocket") {
        return upgradeWebSocketResponse((sock) => {
          sock.onclose = didCloseServerWebSocket.resolve
          console.log("Got server socket in state: " + sock.readyState)
          sock.send("hello")
        })
      }
      return { status: 201 }
    })

    server.resetMiddlewares()
    server.use(router.middleware())
    server.use(router.allowedMethods())

    const sock = ws.createWebSocket("/ws")
    sock.onopen = (x) => {
      console.log("client socket open")
      didReturnWebSocket.resolve(sock)
    }
    sock.onmessage = (x) => {
      console.log("received message", x.data)
      didReceiveMessageFromServer.resolve(x.data)
    }
    sock.onerror = (x) => {
      console.error(x)
      didReturnWebSocket.reject(x.error || x)
    }

    await Promise.race([didReturnWebSocket, timeout(1500)])

    expect(await didReceiveMessageFromServer).toEqual("hello")

    // close from client
    sock.close()

    // await signal closed from server
    await didCloseServerWebSocket
  })

  it("rejects using middleware", async () => {
    const { server, ws } = components

    const didReturnWebSocket = future<any>()

    const router = new Router()

    router.get("/ws", async (ctx) => {
      return { status: 401, statusText: "Unauthorized" }
    })

    server.resetMiddlewares()
    server.use(router.middleware())
    server.use(router.allowedMethods())

    const sock = ws.createWebSocket("/ws")
    sock.onerror = (x) => didReturnWebSocket.reject(x.error)

    await expect(didReturnWebSocket).rejects.toThrow("Unexpected server response: 401")
  })

  it("rejects using middleware, close connection directly", async () => {
    const { server, ws } = components

    const didReturnWebSocket = future<any>()

    const router = new Router()

    router.get("/ws", async (ctx) => {
      throw new Error("asd")
    })

    server.resetMiddlewares()
    server.use(router.middleware())
    server.use(router.allowedMethods())

    const sock = ws.createWebSocket("/ws")
    sock.onerror = (x) => didReturnWebSocket.reject(x.error)

    await expect(didReturnWebSocket).rejects.toThrow()
  })
})

describeE2Euws("uws: sanity", (args) => {
  it("underlying server is app", async () => {
    const underlying = await getUnderlyingServer<TemplatedApp>(args.components.server)
    expect(underlying).toHaveProperty("publish")
  })
})
