import { IHttpServerComponent } from "@well-known-components/interfaces"
import { Resource } from "../src"
import { describeE2E } from './test-e2e-harness'




test('basic functions', () => {
  @Resource.Prefix('/a')
  @Resource.WithMiddleware((next: any) => next())
  @Resource.WithMiddleware((next: any) => next())
  class MyResource extends Resource {
    @Resource.Handler('GET', '/hello')
    async hello() {
      return { status: 200 }
    }

    @Resource.Handler('POST', '/hello/:id')
    @Resource.WithMiddleware((next) => next())
    async createHello(@Resource.UrlParam('id') id: string) {
      return { body: id }
    }

    async emptyFn() {

    }
  }

  // first we create an instance to assess the decorators are not
  // being added to the functions multiple times in a global
  // fashion
  new MyResource()

  const res = new MyResource()

  const ret = MyResource.getApiDefinition(res)

  expect(ret).toEqual({
    middlewares: [expect.any(Function), expect.any(Function)],
    prefix: '/a',
    instance: res,
    metadata: [
      ["resource:middlewares", [expect.any(Function), expect.any(Function)]],
      ["resource:prefix", "/a"],
    ],
    resources: [
      {
        httpMethod: 'GET',
        httpRoute: '/hello',
        middlewares: [],
        delegate: expect.any(Function),
        handlerName: 'hello',
        metadata: [
          ["resource:argumentextractors", []],
          ["resource:method", "GET"],
          ["resource:middlewares", []],
          ["resource:route", "/hello"],
        ]
      },
      {
        httpMethod: 'POST',
        httpRoute: '/hello/:id',
        middlewares: [expect.any(Function)],
        delegate: expect.any(Function),
        handlerName: 'createHello',
        metadata: [
          ["resource:argumentextractors", [expect.any(Function)]],
          ["resource:method", "POST"],
          ["resource:middlewares", [expect.any(Function)]],
          ["resource:route", "/hello/:id"],
        ]
      }
    ]
  })
})

test('fails registering an invalid prefix', () => {
  expect(() => {
    @Resource.Prefix('prefix-wo-slash')
    class MyResource extends Resource { }
  }).toThrow('must start with /')

  expect(() => {
    class MyResource extends Resource {
      @Resource.Handler('POST', 'path-wo-slash')
      async createHello() {
        return {}
      }
    }

    new MyResource()
  }).toThrow('must start with /')
})


describeE2E('resource integration suite', function({ components }) {
  test('resource works', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    @Resource.Prefix('/a')
    class MyResource extends Resource {
      @Resource.Handler('GET', '/hello')
      async hello() {
        return { status: 200 }
      }

      @Resource.Handler('GET', '/hello/ctx')
      async helloWithContext(
        @Resource.RequestContext ctx: IHttpServerComponent.DefaultContext
      ) {
        return { status: 200, body: { url: ctx.url.pathname.toString() } }
      }

      @Resource.Handler('GET', '/hello/:id/:name')
      async helloById(
        @Resource.UrlParam('id') id: string,
        @Resource.UrlParam('id') idRepeated: string,
        @Resource.UrlParam('name') name: string
      ) {
        return { status: 200, body: { id, idRepeated, name } }
      }

      @Resource.Handler('POST', '/hello')
      async createHello() {
        return { status: 201 }
      }
    }

    const resource = new MyResource()
    server.use(resource.createRouter().router.middleware())

    {
      const res = await fetch.fetch(`/a/hello`)
      expect(res.status).toEqual(200)
    }
    {
      const res = await fetch.fetch(`/a/hello`, { method: 'POST' })
      expect(res.status).toEqual(201)
    }
    {
      const res = await fetch.fetch(`/a/hello/asd/test`)
      expect(await res.json()).toEqual({ id: "asd", idRepeated: "asd", name: "test" })
    }
    {
      const res = await fetch.fetch(`/a/hello/ctx`)
      expect(await res.json()).toEqual({ "url": "/a/hello/ctx" })
    }
  })

  test('middlewares also work', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    let calls: string[] = []

    @Resource.Prefix('/a')
    @Resource.WithMiddleware((_ctx, next) => { calls.push('outer1'); return next() })
    @Resource.WithMiddleware((_ctx, next) => { calls.push('outer2'); return next() })
    class MyResource extends Resource {
      @Resource.Handler('GET', '/hello')
      @Resource.WithMiddleware((_ctx, next) => { calls.push('inner1'); return next() })
      async hello() {
        calls.push('hello')
        return { status: 200 }
      }

      @Resource.Handler('GET', '/hello/ctx')
      @Resource.WithMiddleware((_ctx, next) => { calls.push('inner1'); return next() })
      @Resource.WithMiddleware((_ctx, next) => { calls.push('inner2'); return next() })
      async helloWithContext(
        @Resource.RequestContext ctx: IHttpServerComponent.DefaultContext
      ) {
        calls.push('helloWithContext')
        return { status: 200, body: { url: ctx.url.pathname.toString() } }
      }

      @Resource.Handler('GET', '/hello/mut')
      @Resource.WithMiddleware((_ctx, next) => { calls.push('mut-inner1'); return next() })
      @Resource.WithMiddleware(async () => { calls.push('mut-inner2'); return { status: 301 } })
      async helloWithMiddleware(): Promise<any> {
        throw new Error('unreachable')
      }
    }

    const resource = new MyResource()
    server.use(resource.createRouter().router.middleware())

    {
      const res = await fetch.fetch(`/a/hello`)
      expect(res.status).toEqual(200)
      expect(calls).toEqual([
        "outer1",
        "outer2",
        "inner1",
        "hello",
      ])
      calls.length = 0
    }
    {
      const res = await fetch.fetch(`/a/hello/ctx`)
      expect(res.status).toEqual(200)
      expect(calls).toEqual([
        "outer1",
        "outer2",
        "inner1",
        "inner2",
        "helloWithContext",
      ])
      calls.length = 0
    }
    {
      const res = await fetch.fetch(`/a/hello/mut`)
      expect(res.status).toEqual(301)
      expect(calls).toEqual([
        "outer1",
        "outer2",
        "mut-inner1",
        "mut-inner2",
      ])
      calls.length = 0
    }
  })
})
