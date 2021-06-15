import { createTestServerComponent } from "../src"
import { Layer } from "../src/layer"
import { Router } from "../src/router"
import expect from "expect"

describe("Layer", function () {
  it("composes multiple callbacks/middlware", async function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    router.get("/:category/:title", async function (ctx, next) {
      return { status: 500, ...(await next()) }
    })
    app.use(async function (ctx, next) {
      return { status: 204 }
    })
    const res = await app.fetch("/programming/how-to-node")
    expect(res.status).toEqual(204)
  })

  describe("Layer#match()", function () {
    it("captures URL path parameters", async function () {
      const app = createTestServerComponent()
      const router = new Router()
      app.use(router.middleware())
      router.get("/:category/:title", async function (ctx) {
        expect(ctx).toHaveProperty("params")
        expect(ctx.params).toHaveProperty("category", "match")
        expect(ctx.params).toHaveProperty("title", "this")
        return { status: 204 }
      })
      const res = await app.fetch("/match/this")
      expect(res.status).toEqual(204)
    })

    it("return original path parameters when decodeURIComponent throw error", async function () {
      const app = createTestServerComponent()
      const router = new Router()
      app.use(router.middleware())
      router.get("/:category/:title", async function (ctx) {
        expect(ctx).toHaveProperty("params")
        expect(ctx.params).toHaveProperty("category", "100%")
        expect(ctx.params).toHaveProperty("title", "101%")
        return { status: 204 }
      })
      const res = await app.fetch("/100%/101%")
      expect(res.status).toEqual(204)
    })

    it("should throw friendly error message when handle not exists", function () {
      const app = createTestServerComponent()
      const router = new Router()
      app.use(router.middleware())
      const notexistHandle: any = undefined
      expect(function () {
        router.get("/foo", notexistHandle)
      }).toThrow("GET `/foo`: `middleware` must be a function, not `undefined`")
    })
  })

  describe("Layer#param()", function () {
    it("composes middleware for param fn", async function () {
      const app = createTestServerComponent()
      const router = new Router()
      const route = new Layer(
        "/users/:user",
        ["GET"],
        [
          async function (ctx) {
            return { body: ctx.params }
          },
        ]
      )
      router.stack.push(route)
      app.use(router.middleware())

      const res = await app.fetch("/users/3")
      expect(res.status).toEqual(200)
      expect(await res.json()).toHaveProperty("user", "3")
    })

    it("param with paramNames positive check", function () {
      const route = new Layer(
        "/:category/:title",
        ["GET"],
        [
          async function (_, next) {
            return next()
          },
        ],
        { name: "books" }
      )
      route.paramNames = [
        {
          name: "category",
        } as any,
      ]
      const paramSet = route.params(["programming", "ydkjs"], { title: "how-to-code" })
      expect(paramSet).toHaveProperty("title", "how-to-code")
      expect(paramSet).toHaveProperty("category", "programming")
    })
  })

  describe("Layer#url()", function () {
    it("setPrefix method checks Layer for path", function () {
      const route = new Layer(
        "/category",
        ["GET"],
        [
          async function (_, next) {
            return next()
          },
        ],
        { name: "books" }
      )
      route.path = "/hunter2"
      const prefix = route.setPrefix("TEST")
      expect(prefix.path).toEqual("TEST/hunter2")
    })
  })

  describe("Layer#prefix", () => {
    it("setPrefix method passes check Layer for path", function () {
      const route = new Layer(
        "/category",
        ["GET"],
        [
          async function (_, next) {
            return next()
          },
        ],
        { name: "books" }
      )
      route.path = "/hunter2"
      const prefix = route.setPrefix("/TEST")
      expect(prefix.path).toEqual("/TEST/hunter2")
    })

    it("setPrefix method fails check Layer for path", function () {
      const route = new Layer(
        false as any,
        ["GET"],
        [
          async function (_, next) {
            return next()
          },
        ],
        { name: "books" }
      )
      ;(route as any).path = false
      const prefix = route.setPrefix("/TEST")
      expect(prefix.path).toEqual(false)
    })
  })
})
