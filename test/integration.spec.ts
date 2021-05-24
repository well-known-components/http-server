import expect from "expect"
import { Stream } from "stream"
import { Router } from "../src"
import { describeE2E } from "./test-e2e-express-server"
import { describeTestE2E } from "./test-e2e-test-server"
import { TestComponents } from "./test-helpers"
import FormData = require("form-data")
import busboy from "busboy"

describeE2E("integration sanity tests using express server backend", integrationSuite)
describeTestE2E("integration sanity tests using test server", integrationSuite)

function integrationSuite({ components }: { components: TestComponents }) {
  it("returns a stream", async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    function* generator() {
      yield "One line\n"
      yield "Another line\n"
    }

    routes.get("/", async (ctx) => ({
      status: 201,
      body: Stream.Readable.from(generator(), { encoding: "utf-8" }),
    }))

    server.use(routes.middleware())

    {
      const res = await fetch.fetch(`/`)
      expect(res.status).toEqual(201)
      expect(await res.text()).toEqual("One line\nAnother line\n")
    }
  })

  it("send and read form data using busboy", async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    routes.post("/", async (ctx) => {
      const formDataParser = new busboy({
        headers: {
          "content-type": ctx.request.headers.get("content-type"),
        },
      })

      const fields: Record<string, any> = {}

      const finished = new Promise((ok, err) => {
        formDataParser.on("error", err)
        formDataParser.on("finish", ok)
      })

      formDataParser.on("field", function (fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) {
        fields[fieldname] = val
      })

      ctx.request.body.pipe(formDataParser)

      await finished

      return {
        status: 201,
        body: {
          fields,
        },
      }
    })

    server.use(routes.middleware())

    {
      const data = new FormData()
      data.append("username", "menduz")
      data.append("username2", "cazala")
      const res = await fetch.fetch(`/`, { body: data, method: "POST" })
      expect(res.status).toEqual(201)
      expect(await res.json()).toEqual({
        fields: {
          username: "menduz",
          username2: "cazala",
        },
      })
    }
  })

  it("unknown route should yield 404", async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const res = await fetch.fetch(`/test-${Math.random()}`)

    expect(res.status).toEqual(404)
    expect(await res.text()).toEqual("Not found")
  })

  it("GET / json response", async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    routes.get("/", async () => ({
      status: 200,
      body: { hi: true },
    }))

    server.use(routes.middleware())

    {
      const res = await fetch.fetch(`/`)
      expect(res.status).toEqual(200)
      expect(await res.json()).toEqual({ hi: true })
    }
    {
      const res = await fetch.fetch(`/inexistent-endpoint`)
      expect(res.status).toEqual(404)
    }
  })

  it("custom headers reach the handlers", async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    routes.get("/users/:user", async (ctx) => ({
      body: ctx.request.headers.get("x-a"),
    }))

    server.use(routes.middleware())

    {
      const val = Math.random().toString()
      const res = await fetch.fetch(`/users/test`, { headers: { "X-A": val } })
      expect(await res.text()).toEqual(val)
    }
  })

  it("custom headers in the response", async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    routes.get("/users/:user", async (ctx) => ({
      headers: { "X-b": "asd" },
    }))

    server.use(routes.middleware())

    {
      const res = await fetch.fetch(`/users/test`)
      expect(res.headers.get("X-b")).toEqual("asd")
      expect(res.status).toEqual(200)
    }
  })

  it("params are parsed (smoke)", async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    routes.get("/users/:user", async (ctx) => ({
      status: 200,
      body: ctx.params,
    }))

    server.use(routes.middleware())

    {
      const res = await fetch.fetch(`/users/test`)
      expect(res.status).toEqual(200)
      expect(await res.json()).toEqual({ user: "test" })
    }
  })

  it("params are parsed with query string (smoke)", async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    routes.get("/users/:user", async (ctx) => ({
      status: 200,
      body: ctx.params,
    }))

    server.use(routes.middleware())

    {
      const res = await fetch.fetch(`/users/xyz?query1=2`)
      expect(res.status).toEqual(200)
      expect(await res.json()).toEqual({ user: "xyz" })
    }
  })
}
