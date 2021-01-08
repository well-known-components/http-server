import { createTestServerComponent } from "../src"
import { Layer } from "../src/layer"
import { Router } from "../src/router"
import expect from "expect"

describe("Layer", function () {
  it("composes multiple callbacks/middlware", async function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.routes())
    router.get("/:category/:title", async function (ctx, next) {
      ctx.status = 500
      return next()
    })
    app.get(async function (ctx, next) {
      ctx.status = 204
      return next()
    })
    const res = await app.dispatchRequest("/programming/how-to-node")
    expect(res.status).toEqual(204)
  })

  describe("Layer#match()", function () {
    it("captures URL path parameters", async function () {
      const app = createTestServerComponent()
      const router = new Router()
      app.use(router.routes())
      router.get("/:category/:title", async function (ctx) {
        expect(ctx).toHaveProperty("params")
        expect(ctx.params).toHaveProperty("category", "match")
        expect(ctx.params).toHaveProperty("title", "this")
        return { status: 204 }
      })
      const res = await app.dispatchRequest("/match/this")
      expect(res.status).toEqual(204)
    })

    it("return original path parameters when decodeURIComponent throw error", async function () {
      const app = createTestServerComponent()
      const router = new Router()
      app.use(router.routes())
      router.get("/:category/:title", async function (ctx) {
        expect(ctx).toHaveProperty("params")
        expect(ctx.params).toHaveProperty("category", "100%")
        expect(ctx.params).toHaveProperty("title", "101%")
        return { status: 204 }
      })
      const res = await app.dispatchRequest("/100%/101%")
      expect(res.status).toEqual(204)
    })

    it("populates ctx.captures with regexp captures", async function () {
      const app = createTestServerComponent()
      const router = new Router()
      app.use(router.routes())
      router.get(/^\/api\/([^\/]+)\/?/i, function (ctx, next) {
        expect(ctx).toHaveProperty("captures")
        ctx.captures.should.be.instanceOf(Array)
        expect(ctx.captures).toHaveProperty(0, "1")
        return next()
      })
      router.get(/^\/api\/([^\/]+)\/?/i, function (ctx) {
        expect(ctx).toHaveProperty("captures")
        ctx.captures.should.be.instanceOf(Array)
        expect(ctx.captures).toHaveProperty(0, "1")
        ctx.status = 204
      })
      const res = await app.dispatchRequest("/api/1")
      expect(res.status).toEqual(204)
    })

    it("return original ctx.captures when decodeURIComponent throw error", async function () {
      const app = createTestServerComponent()
      const router = new Router()
      app.use(router.routes())
      router.get(/^\/api\/([^\/]+)\/?/i, function (ctx, next) {
        expect(ctx).toHaveProperty("captures")
        ctx.captures.should.be.type("object")
        expect(ctx.captures).toHaveProperty(0, "101%")
        return next()
      })
      router.get(/^\/api\/([^\/]+)\/?/i, function (ctx, next) {
        expect(ctx).toHaveProperty("captures")
        ctx.captures.should.be.type("object")
        expect(ctx.captures).toHaveProperty(0, "101%")
        ctx.status = 204
      })
      const res = await app.dispatchRequest("/api/101%")
      expect(res.status).toEqual(204)
    })

    it("populates ctx.captures with regexp captures include undefiend", async function () {
      const app = createTestServerComponent()
      const router = new Router()
      app.use(router.routes())
      router.get(/^\/api(\/.+)?/i, function (ctx, next) {
        expect(ctx).toHaveProperty("captures")
        ctx.captures.should.be.type("object")
        expect(ctx.captures).toHaveProperty(0, undefined)
        return next()
      })
      router.get(/^\/api(\/.+)?/i, function (ctx) {
        expect(ctx).toHaveProperty("captures")
        ctx.captures.should.be.type("object")
        expect(ctx.captures).toHaveProperty(0, undefined)
        ctx.status = 204
      })
      const res = await app.dispatchRequest("/api")
      expect(res.status).toEqual(204)
    })

    it("should throw friendly error message when handle not exists", function () {
      const app = createTestServerComponent()
      const router = new Router()
      app.use(router.routes())
      const notexistHandle = undefined
      ;(function () {
        router.get("/foo", notexistHandle)
      }.should.throw("get `/foo`: `middleware` must be a function, not `undefined`"))
      ;(function () {
        router.get("foo router", "/foo", notexistHandle)
      }.should.throw("get `foo router`: `middleware` must be a function, not `undefined`"))
      ;(function () {
        router.post("/foo", function () {}, notexistHandle)
      }.should.throw("post `/foo`: `middleware` must be a function, not `undefined`"))
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
          function (ctx) {
            return (ctx.body = ctx.user)
          },
        ]
      )
      router.stack.push(route)
      app.use(router.middleware())

      const res = await app.dispatchRequest("/users/3")
      expect(res.status).toEqual(200)
      expect(res).toHaveProperty("body")
      expect(res.body).toHaveProperty("name", "alex")
    })

    it("param with paramNames positive check", function () {
      const route = new Layer("/:category/:title", ["get"], [function () {}], { name: "books" })
      route.paramNames = [
        {
          name: "category",
        },
      ]
      const paramSet = route.params("/:category/:title", ["programming", "ydkjs"], { title: "how-to-code" })
      expect(paramSet).toHaveProperty("title", "how-to-code")
      expect(paramSet).toHaveProperty("category", "programming")
    })
  })

  describe("Layer#url()", function () {
    it("generates route URL", function () {
      const route = new Layer("/:category/:title", ["get"], [function () {}], { name: "books" })
      let url = route.url({ category: "programming", title: "how-to-node" })
      expect(url).toEqual("/programming/how-to-node")
      url = route.url("programming", "how-to-node")
      expect(url).toEqual("/programming/how-to-node")
    })

    it("escapes using encodeURIComponent()", function () {
      const route = new Layer("/:category/:title", ["get"], [function () {}], { name: "books" })
      const url = route.url({ category: "programming", title: "how to node" }, { encode: encodeURIComponent })
      expect(url).toEqual("/programming/how%20to%20node")
    })

    it("setPrefix method checks Layer for path", function () {
      const route = new Layer("/category", ["get"], [function () {}], { name: "books" })
      route.path = "/hunter2"
      const prefix = route.setPrefix("TEST")
      expect(prefix.path).toEqual("TEST/hunter2")
    })
  })

  describe("Layer#prefix", () => {
    it("setPrefix method passes check Layer for path", function () {
      const route = new Layer("/category", ["get"], [function () {}], { name: "books" })
      route.path = "/hunter2"
      const prefix = route.setPrefix("/TEST")
      expect(prefix.path).toEqual("/TEST/hunter2")
    })

    it("setPrefix method fails check Layer for path", function () {
      const route = new Layer(false, ["get"], [function () {}], { name: "books" })
      route.path = false
      const prefix = route.setPrefix("/TEST")
      expect(prefix.path).toEqual(false)
    })
  })
})
