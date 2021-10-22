/**
 * Router tests
 */
import HttpError from "http-errors"
import fs from "fs"
import path from "path"
import { createTestServerComponent, Router } from "../src"
import { Layer } from "../src/layer"
import { methodsList } from "../src/methods"
import { IHttpServerComponent } from "@well-known-components/interfaces"
const methods: Lowercase<IHttpServerComponent.HTTPMethod>[] = methodsList.map(($) => $.toLowerCase()) as any

describe("Router", function () {
  it("shares context between routers (gh-205)", async function () {
    const app = createTestServerComponent()
    const router1 = new Router<{ foo?: any }>()
    const router2 = new Router<{ baz?: any; foo?: any }>()
    router1.get("/", async function (ctx, next) {
      ctx.foo = "bar"
      return next()
    })
    router2.get("/", async function (ctx, next) {
      ctx.baz = "qux"
      return { body: { foo: ctx.foo } }
    })
    app.use(router1.middleware())
    app.use(router2.middleware())
    const res = await app.fetch("/")
    expect(res.status).toEqual(200)
    expect(await res.json()).toHaveProperty("foo", "bar")
  })

  it("nested routes", async function () {
    const app = createTestServerComponent()
    const parentRouter = new Router<{ n?: number }>()
    const nestedRouter = new Router<{ n?: number }>()

    parentRouter.use("/a", async function (ctx, next) {
      ctx.n = ctx.n ? ctx.n + 1 : 1
      return next()
    })

    nestedRouter.get("/b", async function (ctx, next) {
      return { body: { n: ctx.n }, status: 300 }
    })

    parentRouter.use("/a", nestedRouter.middleware())

    app.use(parentRouter.middleware())

    const res = await app.fetch("/a/b")
    expect(res.status).toEqual(300)

    expect(await res.json()).toHaveProperty("n", 1)
  })

  it("does not register middleware more than once (gh-184)", async function () {
    const app = createTestServerComponent()
    const parentRouter = new Router<{ n?: number }>()
    const nestedRouter = new Router<{ n?: number }>()

    nestedRouter.get("/first-nested-route", async function (ctx, next) {
      return { body: { n: ctx.n } }
    })
    nestedRouter.get("/second-nested-route", async function (ctx, next) {
      return next()
    })
    nestedRouter.get("/third-nested-route", async function (ctx, next) {
      return next()
    })

    parentRouter.use("/parent-route", async function (ctx, next) {
      ctx.n = ctx.n ? ctx.n + 1 : 1
      return next()
    })

    parentRouter.use("/parent-route", nestedRouter.middleware())

    app.use(parentRouter.middleware())

    const res = await app.fetch("/parent-route/first-nested-route")
    expect(res.status).toEqual(200)

    expect(await res.json()).toHaveProperty("n", 1)
  })

  function sleep(n: number) {
    return new Promise((resolve) => setTimeout(resolve, n))
  }

  it("registers multiple middleware for one route", async function () {
    const app = createTestServerComponent()
    const router = new Router()

    router.get("/double", async function (ctx, next) {
      await sleep(1)
      const n = await next()
      return { ...n, body: { message: "Hello" + (n.body as any).message } }
    })
    router.get("/double", async function (ctx, next) {
      await sleep(1)
      const n = await next()
      return { ...n, body: { message: " World" + (n.body as any).message } }
    })
    router.get("/double", async function (ctx, next) {
      return { body: { message: "!" } }
    })

    app.use(router.middleware())

    const res = await app.fetch("/double")
    expect(res.status).toEqual(200)

    expect(((await res.json()) as any).message).toEqual("Hello World!")
  })

  it("supports promises for async/await", async function () {
    const app = createTestServerComponent()
    const router = new Router()
    router.get("/async", async function (_, next) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          resolve({
            body: {
              msg: "promises!",
            },
          })
        }, 1)
      })
    })

    app.use(router.middleware())
    app.use(router.allowedMethods())
    const res = await app.fetch("/async")
    expect(res.status).toEqual(200)
    expect(await res.json()).toHaveProperty("msg", "promises!")
  })

  // it("matches middleware only if route was matched (gh-182)", async function () {
  //   const app = createTestServerComponent()
  //   const router = new Router<{bar: string}>()
  //   const otherRouter = new Router<{bar: string}>()

  //   router.use(async function (ctx, next) {
  //     (ctx.body = { bar: "baz" })
  //     return next()
  //   })

  //   otherRouter.get("/bar", async function (ctx) {
  //     return (ctx.body = ctx.body || { foo: "bar" })
  //   })

  //   app.use(router.routes())
  //   app.use(otherRouter.routes())

  //   const res = await app.dispatchRequest("/bar")
  //   expect(res.status).toEqual(200)

  //   expect(await res.json()).toHaveProperty("foo", "bar")
  //   expect(res.body['bar']).toBeFalsy()
  // })

  it("matches first to last", async function () {
    const app = createTestServerComponent()
    const router = new Router()

    router.get("/user/(.*).jsx", async function (ctx) {
      return { body: { order: 1 } }
    })
    router.all("/app/(.*).jsx", async function (ctx) {
      return { body: { order: 2 } }
    })
    router.all("(.*).jsx", async function (ctx) {
      return { body: { order: 3 } }
    })
    app.use(router.middleware())

    const res = await app.fetch("/user/account.jsx")
    expect(res.status).toEqual(200)

    expect(await res.json()).toHaveProperty("order", 1)
  })

  it("does not run subsequent middleware without calling next", async function () {
    const app = createTestServerComponent()
    const router = new Router()

    router.get("/user/(.*).jsx", async function (ctx) {
      // no next()
      return { status: 404 }
    })
    router.get("/user/(.*).jsx", async function (ctx) {
      return { body: { order: 1 } }
    })

    app.use(router.middleware())
    const res = await app.fetch("/user/account.jsx")
    expect(res.status).toEqual(404)
  })

  it("nests routers with prefixes at root", async function () {
    const app = createTestServerComponent()
    const forums = new Router({
      prefix: "/forums",
    })
    const posts = new Router({
      prefix: "/:fid/posts",
    })

    posts.get("/", async function (ctx, next) {
      return { status: 204 }
    })
    posts.get("/:pid", async function (ctx, next) {
      return { body: ctx.params, status: 301 }
    })

    forums.use(posts.middleware())
    app.use(forums.middleware())
    {
      const res = await app.fetch("/forums/1/posts")
      expect(res.status).toEqual(204)
    }
    {
      const res = await app.fetch("/forums/1")
      expect(res.status).toEqual(404)
    }
    {
      const res = await app.fetch("/forums/1/posts/2")
      expect(res.status).toEqual(301)
      const json = await res.json()
      expect(json).toEqual({ fid: "1", pid: "2" })
    }
  })

  it("nests routers with prefixes at path", async function () {
    const app = createTestServerComponent()
    const forums = new Router({
      prefix: "/api",
    })
    const posts = new Router({
      prefix: "/posts",
    })

    posts.get("/", async function (ctx, next) {
      return { ...(await next()), status: 204 }
    })
    posts.get("/:pid", async function (ctx, next) {
      return { body: ctx.params, status: 301 }
    })

    forums.use("/forums/:fid", posts.middleware())
    app.use(forums.middleware())

    {
      const res = await app.fetch("/api/forums/1/posts")
      expect(res.status).toEqual(204)
    }
    {
      const res = await app.fetch("/api/forums/1")
      expect(res.status).toEqual(404)
    }
    {
      const res = await app.fetch("/api/forums/1/posts/2")
      expect(res.status).toEqual(301)
      const json = await res.json()
      expect(json).toEqual({ fid: "1", pid: "2" })
    }
  })

  it("runs subrouter middleware after parent", async function () {
    const app = createTestServerComponent()
    const subrouter = new Router<{ msg?: any }>()
    subrouter
      .use(function (ctx, next) {
        ctx.msg = "subrouter"
        return next()
      })
      .get("/", async function (ctx) {
        return { body: { msg: ctx.msg } }
      })

    const router = new Router<{ msg?: any }>()
    router
      .use(function (ctx, next) {
        ctx.msg = "router"
        return next()
      })
      .use(subrouter.middleware())

    app.use(router.middleware())
    const res = await app.fetch("/")

    expect(res.status).toEqual(200)

    expect(await res.json()).toHaveProperty("msg", "subrouter")
  })

  it("runs parent middleware for subrouter routes", async function () {
    const app = createTestServerComponent()
    const subrouter = new Router<{ msg?: any }>()
    subrouter.get("/sub", async function (ctx) {
      return { body: { msg: ctx.msg } }
    })
    const router = new Router<{ msg?: any }>()
    router
      .use(function (ctx, next) {
        ctx.msg = "router"
        return next()
      })
      .use("/parent", subrouter.middleware())
    app.use(router.middleware())
    const res = await app.fetch("/parent/sub")
    expect(res.status).toEqual(200)

    expect(await res.json()).toHaveProperty("msg", "router")
  })

  it("matches corresponding requests", async function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    router.get("/:category/:title", async function (ctx) {
      expect(ctx).toHaveProperty("params")
      expect(ctx.params).toHaveProperty("category", "programming")
      expect(ctx.params).toHaveProperty("title", "how-to-node")
      return { status: 204 }
    })
    router.post("/:category", async function (ctx) {
      expect(ctx).toHaveProperty("params")
      expect(ctx.params).toHaveProperty("category", "programming")
      return { status: 204 }
    })
    router.put("/:category/not-a-title", async function (ctx) {
      expect(ctx).toHaveProperty("params")
      expect(ctx.params).toHaveProperty("category", "programming")
      // ctx.params.should.not.have.property("title")
      return { status: 204 }
    })
    {
      const res = await app.fetch("/programming/how-to-node")
      expect(res.status).toEqual(204)
    }
    {
      const res = await app.fetch("/programming", { method: "post" })
      expect(res.status).toEqual(204)
    }
    {
      const res = await app.fetch("/programming/not-a-title", { method: "put" })
      expect(res.status).toEqual(204)
    }
  })

  it("matches corresponding requests with optional route parameter", async function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    router.get("/resources", async function (ctx) {
      expect(ctx).toHaveProperty("params")
      expect(ctx.params).toEqual({})
      return { status: 204 }
    })
    const id = "10"
    const ext = ".json"
    router.get("/resources/:id{.:ext}?", async function (ctx) {
      expect(ctx).toHaveProperty("params")
      expect(ctx.params).toHaveProperty("id", id)
      // if (ctx.params.ext) ctx.params.ext.should.be.equal(ext.substring(1))
      return { status: 204 }
    })
    {
      const res = await app.fetch("/resources")
      expect(res.status).toEqual(204)
    }
    {
      const res = await app.fetch("/resources/" + id)
      expect(res.status).toEqual(204)
    }
    {
      const res = await app.fetch("/resources/" + id + ext)
      expect(res.status).toEqual(204)
    }
  })

  it("executes route middleware using `app.context`", async function () {
    const app = createTestServerComponent()
    const router = new Router<{ bar?: any; foo?: any }>()
    app.use(router.middleware())
    router.use(function (ctx, next) {
      ctx.bar = "baz"
      return next()
    })
    router.get("/:category/:title", function (ctx, next) {
      ctx.foo = "bar"
      return next()
    })
    router.get("/:category/:title", async function (ctx) {
      expect(ctx).toHaveProperty("bar", "baz")
      expect(ctx).toHaveProperty("foo", "bar")
      expect(ctx).toHaveProperty("app", true)
      return { status: 204 }
    })
    app.setContext({
      app: true,
    })
    const res = await app.fetch("/match/this")
    expect(res.status).toEqual(204)
  })
})

it("does not match after ctx.throw()", async function () {
  const app = createTestServerComponent()
  let counter = 0
  const router = new Router()
  app.use(router.middleware())
  router.get("/", async function (ctx) {
    counter++
    throw new HttpError[403]()
  })
  router.get("/", async function (_, n) {
    counter++
    return n()
  })

  const res = await app.fetch("/")
  expect(counter).toEqual(1)
  expect(res.status).toEqual(403)
})

it("supports promises for route middleware", async function () {
  const app = createTestServerComponent()
  const router = new Router()
  app.use(router.middleware())
  const readVersion = function () {
    return new Promise(function (resolve, reject) {
      // const packagePath = path.join(import.meta.url, "..", "..", "package.json").replace(/^file:/, '')
      const packagePath = path.join(__dirname, "..", "package.json").replace(/^file:/, "")
      fs.readFile(packagePath, "utf8", function (err, data) {
        if (err) return reject(err)
        resolve(JSON.parse(data).version)
      })
    })
  }
  router.get("/", function (ctx, next) {
    return next()
  })
  router.get("/", async function (ctx) {
    await readVersion()
    return { status: 204 }
  })
  const res = await app.fetch("/")
  expect(res.status).toEqual(204)
})

it("routes registered after middleware creation must work", async function () {
  const app = createTestServerComponent()
  const router = new Router()
  app.use(router.middleware())
  router.get("/", async function (ctx, next) {
    return { status: 201 }
  })
  const res = await app.fetch("/")
  expect(res.status).toEqual(201)
})
it("routes registered before middleware creation must work", async function () {
  const app = createTestServerComponent()
  const router = new Router()
  router.get("/", async function (ctx, next) {
    return { status: 201 }
  })
  app.use(router.middleware())
  const res = await app.fetch("/")
  expect(res.status).toEqual(201)
})
it("returning json should include the content-length", async function () {
  const app = createTestServerComponent()
  const router = new Router()
  router.get("/", async function (ctx, next) {
    return { status: 201, body: {} }
  })
  app.use(router.middleware())
  const res = await app.fetch("/")
  expect(res.headers.get("content-length")).toEqual("2")
})

describe("Router#allowedMethods()", function () {
  it("responds to OPTIONS requests", async function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    app.use(router.allowedMethods())
    router.get("/users", async function (ctx, next) {
      return next()
    })
    router.put("/users", async function (ctx, next) {
      return next()
    })
    const res = await app.fetch("/users", { method: "options" })
    expect(res.status).toEqual(200)
    expect(res.headers.get("content-length")).toEqual("0")
    expect(res.headers.get("allow")).toEqual("HEAD, GET, PUT")
  })

  it("responds with 405 Method Not Allowed", async function () {
    const app = createTestServerComponent()
    const router = new Router()
    router.get("/users", function (_, next) {
      return next()
    })
    router.put("/users", function (_, next) {
      return next()
    })
    router.post("/events", function (_, next) {
      return next()
    })
    app.use(router.middleware())
    app.use(router.allowedMethods())
    const res = await app.fetch("/users", { method: "post" })
    expect(res.status).toEqual(405)

    expect(res.headers.get("allow")).toEqual("HEAD, GET, PUT")
  })

  it('responds with 405 Method Not Allowed using the "throw" option', async function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    app.use(async function (ctx, next) {
      try {
        return await next()
      } catch (err: any) {
        // assert that the correct HTTPError was thrown
        expect(err.name).toEqual("MethodNotAllowedError")
        expect(err.status).toEqual(405)
        return { body: err.name, status: err.status }
      }
    })
    app.use(router.allowedMethods({ throw: true }))
    router.get("/users", function (_, next) {
      return next()
    })
    router.put("/users", function (_, next) {
      return next()
    })
    router.post("/events", function (_, next) {
      return next()
    })
    const res = await app.fetch("/users", { method: "post" })
    expect(res.status).toEqual(405)

    // the 'Allow' header is not set when throwing
    expect(res.headers.get("allow")).toBeNull()
    expect(res.headers.get("Allow")).toBeNull()
  })

  it('responds with user-provided throwable using the "throw" and "methodNotAllowed" options', async function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    app.use(async function (ctx, next) {
      try {
        return await next()
      } catch (err: any) {
        // assert that the correct HTTPError was thrown
        expect(err.message).toEqual("Custom Not Allowed Error")
        expect(err.status).toEqual(405)
        return { body: err.body, status: err.status }
      }
    })
    app.use(
      router.allowedMethods({
        throw: true,
        methodNotAllowed: function () {
          const notAllowedErr: any = new Error("Custom Not Allowed Error")
          notAllowedErr.type = "custom"
          notAllowedErr.status = 405
          notAllowedErr.body = {
            error: "Custom Not Allowed Error",
            status: 405,
            otherStuff: true,
          }
          return notAllowedErr
        } as any,
      })
    )
    router.get("/users", function (_, next) {
      return next()
    })
    router.put("/users", function (_, next) {
      return next()
    })
    router.post("/events", function (_, next) {
      return next()
    })
    const res = await app.fetch("/users", { method: "post" })
    expect(res.status).toEqual(405)

    // the 'Allow' header is not set when throwing
    // res.header.should.not.have.property("allow")
    expect(await res.json()).toEqual({ error: "Custom Not Allowed Error", status: 405, otherStuff: true })
  })

  it("responds with 501 Not Implemented", async function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    app.use(router.allowedMethods())
    router.get("/users", function (_, next) {
      return next()
    })
    router.put("/users", function (_, next) {
      return next()
    })
    const res = await app.fetch("/users", { method: "search" })
    expect(res.status).toEqual(501)
  })

  it('responds with 501 Not Implemented using the "throw" option', async function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    app.use(async function (ctx, next) {
      try {
        return next()
      } catch (err: any) {
        // assert that the correct HTTPError was thrown
        expect(err.name).toEqual("NotImplementedError")
        expect(err.status).toEqual(501)
        return { body: err.name, status: err.status }
      }
    })
    app.use(router.allowedMethods({ throw: true }))
    router.get("/users", function (_, next) {
      return next()
    })
    router.put("/users", function (_, next) {
      return next()
    })
    const res = await app.fetch("/users", { method: "search" })
    expect(res.status).toEqual(501)

    // the 'Allow' header is not set when throwing
    // res.header.should.not.have.property("allow")
    expect(res.headers.get("allow")).toBeNull()
    expect(res.headers.get("Allow")).toBeNull()
  })

  it('responds with user-provided throwable using the "throw" and "notImplemented" options', async function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    app.use(async function (ctx, next) {
      try {
        return next()
      } catch (err: any) {
        // assert that our custom error was thrown
        expect(err.message).toEqual("Custom Not Implemented Error")
        expect(err.type).toEqual("custom")
        expect(err.status).toEqual(501)
        return {
          body: err.body,
          status: err.status,
        }
      }
    })
    app.use(
      router.allowedMethods({
        throw: true,
        notImplemented: function () {
          const notImplementedErr: any = new Error("Custom Not Implemented Error")
          notImplementedErr.type = "custom"
          notImplementedErr.status = 501
          notImplementedErr.body = {
            error: "Custom Not Implemented Error",
            status: 501,
            otherStuff: true,
          }
          return notImplementedErr
        } as any,
      })
    )
    router.get("/users", function (_, next) {
      return next()
    })
    router.put("/users", function (_, next) {
      return next()
    })
    const res = await app.fetch("/users", { method: "search" })
    expect(res.status).toEqual(501)

    // the 'Allow' header is not set when throwing
    expect(res.headers.has("allow")).toBeFalsy()
    expect(await res.json()).toEqual({ error: "Custom Not Implemented Error", status: 501, otherStuff: true })
  })

  it("does not send 405 if route matched but status is 404", async function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    app.use(router.allowedMethods())
    router.get("/users", async function (ctx, next) {
      return { status: 404 }
    })
    const res = await app.fetch("/users")
    expect(res.status).toEqual(404)
  })

  it("sets the allowed methods to a single Allow header #273", async function () {
    // https://tools.ietf.org/html/rfc7231#section-7.4.1
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    app.use(router.allowedMethods())

    router.get("/", async function (ctx, next) {
      return next()
    })

    const res = await app.fetch("/", { method: "options" })
    expect(res.status).toEqual(200)

    expect(res.headers.get("allow")).toEqual("HEAD, GET")
  })
})

it("allowedMethods check if flow (allowedArr.length)", async function () {
  const app = createTestServerComponent()
  const router = new Router()
  app.use(router.middleware())
  app.use(router.allowedMethods())

  const res = await app.fetch("/users")
})

it("supports custom routing detect path: ctx.routerPath", async function () {
  const app = createTestServerComponent<{ routerPath: string }>()
  const router = new Router()
  app.use(function (ctx, next) {
    // bind helloworld.example.com/users => example.com/helloworld/users
    const appname = ctx.url.hostname.split(".", 1)[0]
    ctx.routerPath = "/" + appname + ctx.url.pathname
    return next()
  })
  app.use(router.middleware())
  router.get("/helloworld/users", async function (ctx) {
    return { body: ctx.request.method + " " + ctx.url.pathname }
  })

  const res = await app.fetch("/users", { headers: { Host: "helloworld.example.com" } })
  expect(res.status).toEqual(200)
  expect(await res.text()).toEqual("GET /users")
})

it("parameter added to request in ctx", async function () {
  const app = createTestServerComponent()
  const router = new Router()
  router.get("/echo/:saying", async function (ctx) {
    try {
      expect(ctx.params.saying).toEqual("helloWorld")
      return { body: { echo: ctx.params.saying } }
    } catch (err: any) {
      return { status: 500, body: err.message }
    }
  })
  app.use(router.middleware())
  const res = await app.fetch("/echo/helloWorld")
  expect(res.status).toEqual(200)

  expect(await res.json()).toEqual({ echo: "helloWorld" })
})

it("parameter added to request in ctx with sub router", async function () {
  const app = createTestServerComponent()
  const router = new Router<{ foo?: any }>()
  const subrouter = new Router<{ foo?: any }>()

  router.use(function (ctx, next) {
    ctx.foo = "boo"
    return next()
  })

  subrouter.get("/:saying", async function (ctx) {
    try {
      expect(ctx.params.saying).toEqual("helloWorld")
      return { body: { echo: ctx.params.saying } }
    } catch (err: any) {
      return { status: 500, body: err.message }
    }
  })

  router.use("/echo", subrouter.middleware())
  app.use(router.middleware())
  const res = await app.fetch("/echo/helloWorld")
  expect(res.status).toEqual(200)

  expect(await res.json()).toEqual({ echo: "helloWorld" })
})

describe("Router#[verb]()", function () {
  it("registers route specific to HTTP verb", function () {
    const app = createTestServerComponent()
    const router = new Router()
    app.use(router.middleware())
    methods.forEach(function (method) {
      expect(router).toHaveProperty(method)
      expect(typeof router[method]).toEqual("function")
      router[method]("/", function (_, next) {
        return next()
      })
    })
    expect(router.stack.length).toEqual(methods.length)
  })

  it("registers route with a given name", function () {
    const router = new Router()
    methods.forEach(function (method) {
      expect(
        router[method]("/", function (_, next) {
          return next()
        })
      ).toEqual(router)
    })
  })

  it("enables route chaining", function () {
    const router = new Router()
    methods.forEach(function (method) {
      expect(
        router[method]("/", function (_, next) {
          return next()
        })
      ).toEqual(router)
    })
  })

  it("registers array of paths (gh-203)", function () {
    const router = new Router()
    router.get("/one", async function (ctx, next) {
      return next()
    })
    router.get("/two", async function (ctx, next) {
      return next()
    })
    expect(router.stack).toHaveProperty("length", 2)
    expect(router.stack[0]).toHaveProperty("path", "/one")
    expect(router.stack[1]).toHaveProperty("path", "/two")
  })

  it("resolves non-parameterized routes without attached parameters", async function () {
    const app = createTestServerComponent()
    const router = new Router()

    router.get("/notparameter", async function (ctx, next) {
      return {
        body: {
          param: (ctx.params as any).parameter,
        },
      }
    })

    router.get("/:parameter", async function (ctx, next) {
      return {
        body: {
          param: ctx.params.parameter,
        },
      }
    })

    app.use(router.middleware())
    const res = await app.fetch("/notparameter")
    expect(res.status).toEqual(200)
    const b: any = await res.json()
    expect(b.param).toEqual(undefined)
  })
})

describe("Router#use()", function () {
  it("uses router middleware without path", async function () {
    const app = createTestServerComponent()
    const router = new Router<{ foo?: any }>()

    router.use(function (ctx, next) {
      ctx.foo = "baz"
      return next()
    })

    router.use(function (ctx, next) {
      ctx.foo = "foo"
      return next()
    })

    router.get("/foo/bar", async function (ctx) {
      return {
        body: {
          foobar: ctx.foo + "bar",
        },
      }
    })

    app.use(router.middleware())
    const res = await app.fetch("/foo/bar")
    expect(res.status).toEqual(200)

    expect(await res.json()).toHaveProperty("foobar", "foobar")
  })

  it("uses router middleware at given path", async function () {
    const app = createTestServerComponent()
    const router = new Router<{ foo?: any }>()

    router.use("/foo/bar", async function (ctx, next) {
      ctx.foo = "foo"
      return next()
    })

    router.get("/foo/bar", async function (ctx) {
      return {
        body: {
          foobar: ctx.foo + "bar",
        },
      }
    })

    app.use(router.middleware())
    const res = await app.fetch("/foo/bar")
    expect(res.status).toEqual(200)

    expect(await res.json()).toHaveProperty("foobar", "foobar")
  })

  it("runs router middleware before subrouter middleware", async function () {
    const app = createTestServerComponent()
    const router = new Router<{ foo?: any }>()
    const subrouter = new Router<{ foo?: any }>()

    router.use(function (ctx, next) {
      ctx.foo = "boo"
      return next()
    })

    subrouter
      .use(function (ctx, next) {
        ctx.foo = "foo"
        return next()
      })
      .get("/bar", async function (ctx) {
        return {
          body: {
            foobar: ctx.foo + "bar",
          },
        }
      })

    router.use("/foo", subrouter.middleware())
    app.use(router.middleware())
    const res = await app.fetch("/foo/bar")
    expect(res.status).toEqual(200)

    expect(await res.json()).toHaveProperty("foobar", "foobar")
  })

  it("assigns middleware to array of paths", async function () {
    const app = createTestServerComponent()
    const router = new Router<{ foo?: any; bar?: any }>()

    router.use("/foo", async function (ctx, next) {
      ctx.foo = "foo"
      ctx.bar = "bar"
      return next()
    })
    router.use("/bar", async function (ctx, next) {
      ctx.foo = "foo"
      ctx.bar = "bar"
      return next()
    })

    router.get("/foo", async function (ctx, next) {
      return {
        body: {
          foobar: ctx.foo + "bar",
        },
      }
    })

    router.get("/bar", async function (ctx) {
      return {
        body: {
          foobar: "foo" + ctx.bar,
        },
      }
    })

    app.use(router.middleware())

    {
      const res = await app.fetch("/foo")
      expect(res.status).toEqual(200)
      expect(await res.json()).toHaveProperty("foobar", "foobar")
    }

    {
      const res = await app.fetch("/bar")
      expect(res.status).toEqual(200)
      expect(await res.json()).toHaveProperty("foobar", "foobar")
    }
  })

  it("multiple middlewares work .use", async function () {
    const app = createTestServerComponent()
    const router = new Router<{ foo?: any; bar?: any }>()

    router.use(
      "/foo",
      async function (ctx, next) {
        ctx.foo = "foo"
        return next()
      },
      async function (ctx, next) {
        ctx.bar = "bar"
        return next()
      }
    )

    router.get("/foo", async function (ctx, next) {
      return {
        body: {
          foobar: ctx.foo + ctx.bar,
        },
      }
    })

    app.use(router.middleware())

    {
      const res = await app.fetch("/foo")
      expect(res.status).toEqual(200)
      expect(await res.json()).toHaveProperty("foobar", "foobar")
    }
  })
  it("multiple middlewares work .get", async function () {
    const app = createTestServerComponent()
    const router = new Router<{ foo?: any; bar?: any }>()

    router.get(
      "/foo",
      async function (ctx, next) {
        ctx.foo = "foo"
        return next()
      },
      async function (ctx, next) {
        ctx.bar = "bar"
        return next()
      }
    )

    router.get("/foo", async function (ctx, next) {
      return {
        body: {
          foobar: ctx.foo + ctx.bar,
        },
      }
    })

    app.use(router.middleware())

    {
      const res = await app.fetch("/foo")
      expect(res.status).toEqual(200)
      expect(await res.json()).toHaveProperty("foobar", "foobar")
    }
  })
})

it("without path, does not set params.0 to the matched path - gh-247", async function () {
  const app = createTestServerComponent()
  const router = new Router()

  router.use(function (ctx, next) {
    return next()
  })

  router.get("/foo/:id", async function (ctx) {
    return { body: ctx.params }
  })

  app.use(router.middleware())
  const res = await app.fetch("/foo/815")
  expect(res.status).toEqual(200)

  expect(await res.json()).toEqual({ id: "815" })
  // expect(res.body).toNotHaveProperty("0")
})

it("does not add an erroneous (.*) to unprefiexed nested routers - gh-369 gh-410", async function () {
  const app = createTestServerComponent()
  const router = new Router()
  const nested = new Router()
  let called = 0

  nested.get("/", async (ctx, next) => {
    called += 1
    return { body: "root", ...(await next()) }
  })
  nested.get("/test", async (ctx, next) => {
    called += 1
    return { body: { hello: "test" } }
  })

  router.use(nested.middleware())
  app.use(router.middleware())

  const res = await app.fetch("/test", { method: "get" })
  expect(res.status).toEqual(200)
  expect(await res.json()).toEqual({ hello: "test" })
  expect(called).toEqual(1)
})

it("assigns middleware to array of paths with function middleware and router need to nest. - gh-22", async function () {
  const app = createTestServerComponent()
  const base = new Router<{ foo?: any; bar?: any }>({ prefix: "/api" })
  const nested = new Router<{ foo?: any; bar?: any }>({ prefix: "/qux" })
  const pathList = ["/foo", "/bar"]

  nested.get("/baz", async (ctx) => {
    return {
      body: {
        foo: ctx.foo,
        bar: ctx.bar,
        baz: "baz",
      },
    }
  })

  pathList.forEach((path) =>
    base.use(
      path,
      (ctx, next) => {
        ctx.foo = "foo"
        ctx.bar = "bar"

        return next()
      },
      nested.middleware()
    )
  )

  app.use(base.middleware())

  await Promise.all(
    pathList.map(async (pathname) => {
      const res = await app.fetch(`/api${pathname}/qux/baz`)
      expect(res.status).toEqual(200)
      expect(await res.json()).toEqual({ foo: "foo", bar: "bar", baz: "baz" })
    })
  )
})
it("uses a same router middleware at given paths continuously - ZijianHe/koa-router#gh-244 gh-18", async function () {
  const app = createTestServerComponent()
  const base = new Router<{ foo?: any; bar?: any }>({ prefix: "/api" })
  const nested = new Router<{ foo?: any; bar?: any }>({ prefix: "/qux" })

  nested.get("/baz", async (ctx) => {
    return {
      body: {
        foo: ctx.foo,
        bar: ctx.bar,
        baz: "baz",
      },
    }
  })

  base
    .use(
      "/foo",
      (ctx, next) => {
        ctx.foo = "foo"
        ctx.bar = "bar"

        return next()
      },
      nested.middleware()
    )
    .use(
      "/bar",
      (ctx, next) => {
        ctx.foo = "foo"
        ctx.bar = "bar"

        return next()
      },
      nested.middleware()
    )

  app.use(base.middleware())

  await Promise.all(
    ["/foo", "/bar"].map(async (pathname) => {
      const res = await app.fetch(`/api${pathname}/qux/baz`)
      expect(res.status).toEqual(200)
      expect(await res.json()).toEqual({ foo: "foo", bar: "bar", baz: "baz" })
    })
  )
})

describe("Router#register()", function () {
  it("registers new routes", async function () {
    const app = createTestServerComponent()
    const router = new Router()
    expect(router).toHaveProperty("register")
    expect(typeof router.register).toEqual("function")
    const route = router.register("/", ["GET", "POST"], function (_, next) {
      return next()
    })
    app.use(router.middleware())
    expect(Array.isArray(router.stack)).toEqual(true)
    expect(router.stack).toHaveProperty("length", 1)
    expect(router.stack[0]).toHaveProperty("path", "/")
  })

  describe("Router#redirect()", function () {
    it("registers redirect routes", async function () {
      const app = createTestServerComponent()
      const router = new Router()
      expect(router).toHaveProperty("redirect")
      expect(typeof router.redirect).toEqual("function")
      router.redirect("/source", "/destination", 302)
      app.use(router.middleware())
      expect(router.stack).toHaveProperty("length", 1)
      expect(router.stack[0]).toBeInstanceOf(Layer)
      expect(router.stack[0]).toHaveProperty("path", "/source")
    })
    it("redirects to external sites", async function () {
      const app = createTestServerComponent()
      const router = new Router()
      app.use(router.middleware())
      router.redirect("/", "https://www.example.com")
      const res = await app.fetch("/", { method: "post" })
      expect(res.status).toEqual(301)

      expect(res.headers.get("location")).toEqual("https://www.example.com")
    })

    it("redirects to any external protocol", async function () {
      const app = createTestServerComponent()
      const router = new Router()
      app.use(router.middleware())
      router.redirect("/", "my-custom-app-protocol://www.example.com/foo")
      const res = await app.fetch("/", { method: "post" })
      expect(res.status).toEqual(301)
      expect(res.headers.get("location")).toEqual("my-custom-app-protocol://www.example.com/foo")
    })

    describe("Router#route()", function () {
      it("inherits routes from nested router", function () {
        const subrouter = new Router()
        subrouter.get("/hello", async function (ctx) {
          return { body: { hello: "world" } }
        })
        const router = new Router().use(subrouter.middleware())
        expect(router.match("/hello", "GET").path).toHaveLength(1)
      })
    })

    describe("Router#opts", function () {
      it("responds with 200", async function () {
        const app = createTestServerComponent()
        const router = new Router({
          strict: true,
        })
        router.get("/info", async function (ctx) {
          return { body: { a: "hello" } }
        })
        app.use(router.middleware())
        const res = await app.fetch("/info")
        expect(res.status).toEqual(200)

        expect(await res.json()).toEqual({ a: "hello" })
      })

      it("should allow setting a prefix", async function () {
        const app = createTestServerComponent()
        const routes = new Router({ prefix: "/things/:thing_id" })

        routes.get("/list", async function (ctx) {
          return { body: ctx.params }
        })

        app.use(routes.middleware())

        const res = await app.fetch("/things/1/list")
        expect(res.status).toEqual(200)

        expect(((await res.json()) as any).thing_id).toEqual("1")
      })

      it("responds with 404 when has a trailing slash", async function () {
        const app = createTestServerComponent()
        const router = new Router({
          strict: true,
        })
        router.get("/info", async function (ctx) {
          return { body: { hello: "hello" } }
        })
        app.use(router.middleware())
        const res = await app.fetch("/info/")
        expect(res.status).toEqual(404)
      })
    })

    describe("use middleware with opts", function () {
      it("responds with 200", async function () {
        const app = createTestServerComponent()
        const router = new Router({
          strict: true,
        })
        router.get("/info", async function (ctx) {
          return { body: { hello: "hello" } }
        })
        app.use(router.middleware())
        const res = await app.fetch("/info")
        expect(res.status).toEqual(200)
        expect(await res.text()).toEqual(JSON.stringify({ hello: "hello" }))
      })

      it("responds with 404 when has a trailing slash", async function () {
        const app = createTestServerComponent()
        const router = new Router({
          strict: true,
        })
        router.get("/info", async function (ctx) {
          return { body: { hello: "hello" } }
        })
        app.use(router.middleware())
        const res = await app.fetch("/info/")
        expect(res.status).toEqual(404)
      })
    })

    describe("router.routes()", function () {
      it("should return composed middleware", async function () {
        const app = createTestServerComponent()
        const router = new Router()
        let middlewareCount = 0

        router.use(
          function middlewareA(ctx, next) {
            middlewareCount++
            return next()
          },
          function middlewareB(ctx, next) {
            middlewareCount++
            return next()
          }
        )
        router.get("/users/:id", async function (ctx) {
          expect(ctx.params).toHaveProperty("id")
          return { body: { hello: "world" } }
        })

        const routerMiddleware = router.middleware()

        expect(typeof routerMiddleware).toEqual("function")
        app.use(routerMiddleware)
        const res = await app.fetch("/users/1", { method: "get" })
        expect(res.status).toEqual(200)

        const json = await res.json()

        expect(json).toHaveProperty("hello", "world")
        expect(middlewareCount).toEqual(2)
      })

      it("places a `_matchedRoute` value on context", async function () {
        const app = createTestServerComponent()
        const router = new Router()

        router.use(async function middleware(ctx, next) {
          await next()
          expect(ctx._matchedRoute).toEqual("/users/:id")
          return {}
        })

        router.get("/users/:id", async function (ctx, next) {
          expect(ctx._matchedRoute).toEqual("/users/:id")
          expect(ctx.params).toHaveProperty("id")
          return { body: { hello: "world" } }
        })

        const routerMiddleware = router.middleware()
        app.use(routerMiddleware)

        const res = await app.fetch("/users/1", { method: "get" })
        expect(res.status).toEqual(200)
      })

      it("places a `routerPath` value on the context for current route", async function () {
        const app = createTestServerComponent()
        const router = new Router()

        router.get("/users/:id", async function (ctx) {
          expect(ctx.routerPath).toEqual("/users/:id")
          return { status: 200 }
        })
        app.use(router.middleware())
        const res = await app.fetch("/users/1")
        expect(res.status).toEqual(200)
      })

      it("places a `_matchedRoute` value on the context for current route", async function () {
        const app = createTestServerComponent()
        const router = new Router()

        router.get("/users/list", async function (ctx) {
          expect(ctx._matchedRoute).toEqual("/users/list")
          return { status: 200 }
        })
        router.get("/users/:id", async function (ctx) {
          expect(ctx._matchedRoute).toEqual("/users/:id")
          return { status: 200 }
        })
        app.use(router.middleware())
        const res = await app.fetch("/users/list")
        expect(res.status).toEqual(200)
      })
    })

    describe("If no HEAD method, default to GET", function () {
      it("should default to GET", async function () {
        const app = createTestServerComponent()
        const router = new Router()
        router.get("/users/:id", async function (ctx) {
          expect(ctx.params).toHaveProperty("id")
          return { body: { hello: true } }
        })
        app.use(router.middleware())
        const res = await app.fetch("/users/1", { method: "head" })
        expect(res.status).toEqual(200)
        expect(await res.text()).toBeFalsy()
        expect(res.headers.get("content-length")).toBeFalsy()
      })

      it("should work with middleware", async function () {
        const app = createTestServerComponent()
        const router = new Router()
        router.get("/users/:id", async function (ctx) {
          expect(ctx.params).toHaveProperty("id")
          return { body: { hello: true } }
        })
        app.use(router.middleware())
        const res = await app.fetch("/users/1", { method: "head" })
        expect(res.status).toEqual(200)
        expect(await res.text()).toBeFalsy()
      })
    })

    describe("Router#prefix", function () {
      it("should set opts.prefix", function () {
        const router = new Router()
        // expect(router.opts).to.not.have.key("prefix")
        router.prefix("/things/:thing_id")
        expect(router.opts.prefix).toEqual("/things/:thing_id")
      })

      it("should prefix existing routes", function () {
        const router = new Router()
        router.get("/users/:id", async function (ctx) {
          return { body: { hello: "test" } }
        })
        router.prefix("/things/:thing_id")
        const route = router.stack[0]
        expect(route.path).toEqual("/things/:thing_id/users/:id")
        expect(route.paramNames).toHaveLength(2)
        expect(route.paramNames[0]).toHaveProperty("name", "thing_id")
        expect(route.paramNames[1]).toHaveProperty("name", "id")
      })

      it("populates ctx.params correctly for router prefix (including use)", async function () {
        var app = createTestServerComponent()
        var router = new Router({ prefix: "/:category" })
        app.use(router.middleware())
        router
          .use((ctx, next) => {
            expect(ctx).toHaveProperty("params")
            expect(typeof ctx.params).toEqual("object")
            expect(ctx.params).toHaveProperty("category", "cats")
            return next()
          })
          .get("/suffixHere", async function (ctx) {
            expect(ctx).toHaveProperty("params")
            expect(typeof ctx.params).toEqual("object")
            expect(ctx.params).toHaveProperty("category", "cats")
            return { status: 204 }
          })
        const res = await app.fetch("/cats/suffixHere")
        expect(res.status).toEqual(204)
      })

      it("populates ctx.params correctly for more complex router prefix (including use)", async function () {
        var app = createTestServerComponent()
        var router = new Router({ prefix: "/:category/:color" })
        app.use(router.middleware())
        router
          .use((ctx, next) => {
            expect(ctx).toHaveProperty("params")
            expect(typeof ctx.params).toEqual("object")
            expect(ctx.params).toHaveProperty("category", "cats")
            expect(ctx.params).toHaveProperty("color", "gray")
            return next()
          })
          .get("/:active/suffixHere", async function (ctx) {
            expect(ctx).toHaveProperty("params")
            expect(ctx.params).toHaveProperty("category", "cats")
            expect(ctx.params).toHaveProperty("color", "gray")
            expect(ctx.params).toHaveProperty("active", "true")
            return { status: 204 }
          })
        const res = await app.fetch("/cats/gray/true/suffixHere")
        expect(res.status).toEqual(204)
      })

      it("populates ctx.params correctly for static prefix", async function () {
        var app = createTestServerComponent()
        var router = new Router({ prefix: "/all" })
        app.use(router.middleware())
        router
          .use((ctx, next) => {
            expect(ctx).toHaveProperty("params")
            expect(typeof ctx.params).toEqual("object")
            expect(ctx.params).toEqual({})
            return next()
          })
          .get("/:active/suffixHere", async function (ctx) {
            expect(ctx).toHaveProperty("params")
            expect(ctx.params).toHaveProperty("active", "true")
            return { status: 204 }
          })
        const res = await app.fetch("/all/true/suffixHere")
        expect(res.status).toEqual(204)
      })

      describe("when used with .use(fn) - gh-247", function () {
        it("does not set params.0 to the matched path", async function () {
          const app = createTestServerComponent()
          const router = new Router()

          router.use(function (ctx, next) {
            return next()
          })

          router.get("/foo/:id", async function (ctx) {
            return { body: ctx.params }
          })

          router.prefix("/things")

          app.use(router.middleware())
          const res = await app.fetch("/things/foo/108")
          expect(res.status).toEqual(200)

          expect(await res.json()).toHaveProperty("id", "108")
        })
      })

      describe("with trailing slash", testPrefix("/admin/"))
      describe("without trailing slash", testPrefix("/admin"))

      function testPrefix(prefix: string) {
        return function () {
          const app = createTestServerComponent()
          let middlewareCount = 0

          beforeAll(function () {
            const router = new Router<{ thing?: any }>()

            router.use(function (ctx, next) {
              middlewareCount++
              ctx.thing = "worked"
              return next()
            })

            router.get("/", async function (ctx) {
              middlewareCount++
              return { body: { name: ctx.thing } }
            })

            router.prefix(prefix)
            app.use(router.middleware())
          })

          beforeEach(function () {
            middlewareCount = 0
          })

          it("should support root level router middleware", async function () {
            const res = await app.fetch(prefix)

            expect(res.status).toEqual(200)

            expect(middlewareCount).toEqual(2)
            const b = await res.json()
            expect(typeof b).toEqual("object")
            expect(b).toHaveProperty("name", "worked")
          })

          it("should support requests with a trailing path slash", async function () {
            const res = await app.fetch("/admin/")
            expect(res.status).toEqual(200)

            expect(middlewareCount).toEqual(2)
            const b = await res.json()
            expect(typeof b).toEqual("object")
            expect(b).toHaveProperty("name", "worked")
          })

          it("should support requests without a trailing path slash", async function () {
            const res = await app.fetch("/admin")
            expect(res.status).toEqual(200)

            expect(middlewareCount).toEqual(2)
            const b = await res.json()
            expect(typeof b).toEqual("object")
            expect(b).toHaveProperty("name", "worked")
          })
        }
      }
    })

    it(`prefix and '/' route behavior`, async function () {
      const app = createTestServerComponent()
      const router = new Router({
        strict: false,
        prefix: "/foo",
      })

      const strictRouter = new Router({
        strict: true,
        prefix: "/bar",
      })

      router.get("/", async function (ctx) {
        return {}
      })

      strictRouter.get("/", async function (ctx) {
        return {}
      })

      app.use(router.middleware())
      app.use(strictRouter.middleware())

      {
        const res = await app.fetch("/foo")
        expect(res.status).toEqual(200)
      }
      {
        const res = await app.fetch("/foo/")
        expect(res.status).toEqual(200)
      }
      {
        const res = await app.fetch("/bar")
        expect(res.status).toEqual(404)
      }
      {
        const res = await app.fetch("/bar/")
        expect(res.status).toEqual(200)
      }
    })
  })
})

it("a", async () => {
  const testServer = createTestServerComponent()

  const router = new Router<{}>()

  router.post("/users/:userIda", async (ctx) => {
    return {
      status: 1,
    }
  })

  testServer.use(router.middleware())

  const response = await testServer.fetch("/users/1", {
    method: "post",
  })

  expect(response.status).toEqual(1)
})

// describe("Static Router#url()", function () {
//   it("generates route URL", function () {
//     const url = Router.url("/:category/:title", { category: "programming", title: "how-to-node" })
// expect(     url).toEqual("/programming/how-to-node")
//   })

//   it("escapes using encodeURIComponent()", function () {
//     const url = Router.url(
//       "/:category/:title",
//       { category: "programming", title: "how to node" },
//       { encode: encodeURIComponent }
//     )
// expect(     url).toEqual("/programming/how%20to%20node")
//   })

//   it("generates route URL with params and query params", async function () {
//     let url = Router.url("/books/:category/:id", "programming", 4, {
//       query: { page: 3, limit: 10 },
//     })
// expect(     url).toEqual("/books/programming/4?page=3&limit=10")
//     url = Router.url("/books/:category/:id", { category: "programming", id: 4 }, { query: { page: 3, limit: 10 } })
// expect(     url).toEqual("/books/programming/4?page=3&limit=10")
//     url = Router.url("/books/:category/:id", { category: "programming", id: 4 }, { query: "page=3&limit=10" })
// expect(     url).toEqual("/books/programming/4?page=3&limit=10")
//   })

//   it("generates router URL without params and with with query params", async function () {
//     const url = Router.url("/category", {
//       query: { page: 3, limit: 10 },
//     })
// expect(     url).toEqual("/category?page=3&limit=10")
//   })
// })
