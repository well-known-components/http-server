import { Stream } from 'stream'
import { createReadStream, readFileSync } from 'fs'
import { getUnderlyingServer, Router } from '../src'
import { describeE2E } from './test-e2e-harness'
import { describeTestE2E } from './test-e2e-test-server'
import { TestComponents } from './test-helpers'
import FormData from 'form-data'
import * as undici from 'undici'
import nodeFetch from 'node-fetch'
import { multipartParserWrapper } from './busboy'

describeE2E('integration sanity tests using http backend', integrationSuite)
describeTestE2E('integration sanity tests using test server', integrationSuite)

describeTestE2E('underlying server', function({ components }: { components: TestComponents }) {
  it('gets the underlying http server', async () => {
    const { server } = components
    const http = getUnderlyingServer(server)
    await expect(http).rejects.toThrow()
  })
})

function integrationSuite({ components }: { components: TestComponents }) {
  it('empty server returns 404', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const res = await fetch.fetch(`/`)
    expect(res.status).toEqual(404)
  })

  it('bypass middleware returns 404', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    server.use((_, next) => next())
    const res = await fetch.fetch(`/unexistent-route`)
    expect(res.status).toEqual(404)
  })

  it('empty return middleware returns 501', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    server.use(async () => {
      return null as any
    })
    const res = await fetch.fetch(`/`)
    expect(res.status).toEqual(501)
  })

  it('url must use X-Forwarded-Host if available', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    server.use(async (ctx) => {
      return { body: ctx.url.toString() }
    })
    const res = await fetch.fetch(`/test?a=true`, {
      headers: { 'X-Forwarded-Host': 'google.com', host: 'arduz.com.ar' }
    })
    const url = await res.text()
    expect(url).toEqual('http://google.com/test?a=true')
  })

  it('url must use host if available', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    server.use(async (ctx) => {
      return {
        body: {
          agent: ctx.request.headers.get('user-agent'),
          url: ctx.url.toString()
        }
      }
    })
    const res = await fetch.fetch(`/test?a=true&tttttt=asd`, { headers: { host: 'localhost' } })
    const { url, agent } = await res.json()

    // undici decided that we cannot set the 'host' header anymore.
    if (agent != 'undici') {
      expect(url).toEqual('http://localhost/test?a=true&tttttt=asd')
    }
  })

  it('calling multiple next fails', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    server.use(async (_, next) => {
      next()
      return next()
    })
    const res = await fetch.fetch(`/`)
    expect(res.status).toEqual(500)
  })

  it('calling multiple next if there is no next returns 404', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    server.use(async (_, next) => {
      return next()
    })
    const res = await fetch.fetch(`/`)
    expect(res.status).toEqual(404)
  })

  it('unmatched routes return 501', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    const routes = new Router()
    server.use(routes.middleware())
    server.use(routes.allowedMethods())
    const res = await fetch.fetch(`/unexistent-route`)
    expect(res.status).toEqual(404)
  })

  it('context is passed to handlers', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    server.setContext({ a: { value: 'test' } })
    server.use(async (ctx) => {
      return { body: { value: (ctx as any).a.value, isStillInjectingHttpContext: !!ctx.url } }
    })
    const res = await fetch.fetch(`/`)
    expect(await res.json()).toEqual({ value: 'test', isStillInjectingHttpContext: true })
  })

  it('return fetch should be legal google.com', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    server.use(async (ctx) => {
      const googlePromise = await nodeFetch('https://google.com', {
        compress: false
      })
      return googlePromise as any
    })

    const res = await fetch.fetch(`/`)
    // console.log("res " + inspect(res, false, 3, true))
    expect(res.ok).toEqual(true)
    expect(res.headers.get('alt-svc')).not.toBeNull()
    const text = await res.text()
    expect(text).toMatch('goog')
  })

  it('return readStream of file can be piped as text', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    // const stream = createReadStream(import.meta.url.replace('file://', ''))
    const stream = createReadStream(__filename)
    server.use(async () => {
      return { body: stream }
    })
    expect(stream.destroyed).toEqual(false)
    const res = await fetch.fetch(`/`)
    expect(res.ok).toEqual(true)
    // TODO: this should be handled by node-fetch, lazy consuming the body of the request,
    // but it doesn't happen, it automatically receives the whole stream and tries to fit
    // it into memory
    // =>    expect(stream.destroyed).toEqual(false)
    // expect(await res.text()).toEqual(readFileSync(import.meta.url.replace('file://', '')).toString())
    expect(await res.text()).toEqual(readFileSync(__filename).toString())
    expect(stream.destroyed).toEqual(true)
  })

  it('return Buffer works', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    server.use(async () => {
      return { body: Buffer.from([33, 22, 33]) }
    })
    const res = await fetch.fetch(`/`)
    expect(res.ok).toEqual(true)
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([33, 22, 33]))
  })

  it('return Uint8Array works', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    server.use(async () => {
      return { body: Uint8Array.from([33, 22, 33]) }
    })
    const res = await fetch.fetch(`/`)
    expect(res.ok).toEqual(true)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(Uint8Array.from([33, 22, 33]))
  })

  it('return ArrayBuffer works', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    const body = new ArrayBuffer(3)
    const view = new Uint8Array(body)
    view[0] = 33
    view[1] = 22
    view[2] = 66
    server.use(async () => {
      return { body: body }
    })
    const res = await fetch.fetch(`/`)
    expect(res.ok).toEqual(true)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(Uint8Array.from([33, 22, 66]))
  })

  it('returns a stream', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    function* generator() {
      yield 'One line\n'
      yield 'Another line\n'
    }

    routes.get('/', async (ctx) => ({
      status: 201,
      body: Stream.Readable.from(generator(), { encoding: 'utf-8' })
    }))

    server.use(routes.middleware())

    {
      const res = await fetch.fetch(`/`)
      expect(res.status).toEqual(201)
      expect(await res.text()).toEqual('One line\nAnother line\n')
    }
  })

  // it("returns an async generator", async () => {
  //   const { fetch, server } = components
  //   server.resetMiddlewares()

  //   const routes = new Router()

  //   routes.get("/", async (ctx) => ({
  //     status: 201,
  //     async *body() {
  //       yield "One line\n"
  //       yield "Another line\n"
  //     },
  //   }))

  //   server.use(routes.middleware())

  //   {
  //     const res = await fetch.fetch(`/`)
  //     expect(res.status).toEqual(201)
  //     expect(await res.text()).toEqual("One line\nAnother line\n")
  //   }
  // })

  it('send and read form data using FormData', async () => {
    const { fetch, server, config } = components
    // TODO: undici doesn't work with FormData yet
    if (fetch.isUndici) return

    server.resetMiddlewares()

    const routes = new Router()

    routes.post(
      '/',
      multipartParserWrapper(async (ctx) => {
        return {
          status: 201,
          body: {
            fields: ctx.formData.fields
          }
        }
      })
    )

    server.use(routes.middleware())

    {
      const data = fetch.isUndici ? new undici.FormData() : new FormData()
      data.append('username', 'menduz')
      data.append('username2', 'cazala')
      const res = await fetch.fetch(`/`, { body: data as any, method: 'POST' })
      expect(res.status).toEqual(201)
      expect(await res.json()).toEqual({
        fields: {
          username: {
            encoding: '7bit',
            fieldname: 'username',
            mimeType: 'text/plain',
            nameTruncated: false,
            value: 'menduz',
            valueTruncated: false
          },
          username2: {
            encoding: '7bit',
            fieldname: 'username2',
            mimeType: 'text/plain',
            nameTruncated: false,
            value: 'cazala',
            valueTruncated: false
          }
        }
      })
    }
  })

  it('unknown route should yield 404', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const res = await fetch.fetch(`/test-${Math.random()}`)

    expect(res.status).toEqual(404)
    expect(await res.text()).toEqual('Not found')
  })

  it('GET / json response', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    routes.get('/', async () => ({
      status: 200,
      body: { hi: true }
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

  it('custom headers reach the handlers', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    routes.get('/users/:user', async (ctx) => ({
      body: ctx.request.headers.get('x-a') as any
    }))

    server.use(routes.middleware())

    {
      const val = Math.random().toString()
      const res = await fetch.fetch(`/users/test`, { headers: { 'X-A': val } })
      expect(await res.text()).toEqual(val)
    }
  })

  it('custom headers in the response', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    routes.get('/users/:user', async (ctx) => ({
      headers: { 'X-b': 'asd' }
    }))

    server.use(routes.middleware())

    {
      const res = await fetch.fetch(`/users/test`)
      expect(res.headers.get('X-b')).toEqual('asd')
      expect(res.status).toEqual(200)
    }
  })

  it('params are parsed (smoke)', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    routes.get('/users/:user', async (ctx) => ({
      status: 200,
      body: ctx.params
    }))

    server.use(routes.middleware())

    {
      const res = await fetch.fetch(`/users/test`)
      expect(res.status).toEqual(200)
      expect(await res.json()).toEqual({ user: 'test' })
    }
  })

  it('params are parsed with query string (smoke)', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    routes.get('/users/:user', async (ctx) => ({
      status: 200,
      body: ctx.params
    }))

    server.use(routes.middleware())

    {
      const res = await fetch.fetch(`/users/xyz?query1=2`)
      expect(res.status).toEqual(200)
      expect(await res.json()).toEqual({ user: 'xyz' })
    }
  })

  it('context always returns a new object', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()
    const results = new Set<{ id: number }>()
    let i = 0
    server.use(async (ctx) => {
      ; (ctx as any).id = i++
      results.add(ctx as any)
      return null as any
    })

    expect((await fetch.fetch(`/`)).status).toEqual(501)
    expect((await fetch.fetch(`/`)).status).toEqual(501)
    expect((await fetch.fetch(`/`)).status).toEqual(501)
    expect((await fetch.fetch(`/`)).status).toEqual(501)

    expect(results.size).toEqual(4)
    const resultsArray = Array.from(results)
      .map((_) => _.id)
      .sort()
    expect(resultsArray).toEqual([0, 1, 2, 3])
  })

  // list of offensive endpoints taken from a real world attack to one of the maintainer's servers
  const offensiveEndpoints: Record<string, number> = {
    '//%5Cinteract.sh': 404,
    '//%01%02%03%04%0a%0d%0a/admin/': 404,
    '//..%25%35%63/admin/': 404,
    '//..%255c/admin/': 404,
    '//%3C%3E//interact.sh': 404,
    '//%3C%3F/admin/': 404,
    '//..%5c/admin/': 404,
    '////interact.sh@/': 404,
    '///%5C/interact.sh/': 404,
    '///interact.sh@/': 404,
    '///%5Ctinteract.sh/': 404,
    '//https:interact.sh': 404
  }

  describe('offensive endpoints', () => {
    Object.entries(offensiveEndpoints).forEach(([endpoint, status]) => {
      it(endpoint, async () => {
        const { fetch, server } = components
        server.resetMiddlewares()
        server.use(async (ctx) => {
          return {
            status: 201,
            body: ctx.url.toJSON()
          }
        })

        const res = await fetch.fetch(endpoint)
        expect(res.status).toEqual(201)
        expect(await res.text()).toContain(endpoint)
      })
    })
  })

  xit('xss sanity', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const routes = new Router()

    server.use(async (ctx) => {
      return {
        status: 200,
        body: ctx.url.toJSON()
      }
    })

    {
      const res = await fetch.fetch(
        `/${encodeURIComponent(`\u001B]8;;https://example.com\"/onmouseover=\"alert(1)\u0007example\u001B]8;;\u0007`)}`
      )
      expect(res.status).toEqual(200)
      expect(await res.text()).toContain(
        '/%1B%5D8%3B%3Bhttps%3A%2F%2Fexample.com%22%2Fonmouseover%3D%22alert(1)%07example%1B%5D8%3B%3B%07'
      )
    }

    {
      const res = await fetch.fetch(
        `/\u001B]8;;https://example.com\"/onmouseover=\"alert(1)\u0007example\u001B]8;;\u0007`
      )
      expect(res.status).toEqual(200)
      expect(await res.text()).toContain('/%1B]8;;https://example.com%22/onmouseover=%22alert(1)%07example%1B]8;;')
    }

    {
      const res = await fetch.fetch(
        `/\\u001B]8;;https://example.com\"/onmouseover=\"alert(1)\\u0007example\\u001B]8;;\\u0007`
      )
      expect(res.status).toEqual(404)
    }
  })

  it('gracefully fail with exceptions (async)', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    server.use(async (ctx) => {
      throw new Error('some exception')
    })

    const res = await fetch.fetch(`/hola`)
    expect(res.status).toEqual(500)
  })

  it('gracefully fail with exceptions (async router)', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const r = new Router()
    r.get('/hola', async () => {
      throw new Error('some exception')
    })

    server.use(r.middleware())

    const res = await fetch.fetch(`/hola`)
    expect(res.status).toEqual(500)
  })

  it('gracefully fail with exceptions (sync router)', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    const r = new Router()
    r.get('/hola', () => {
      throw new Error('some exception')
    })

    server.use(r.middleware())

    const res = await fetch.fetch(`/hola`)
    expect(res.status).toEqual(500)
  })

  it('gracefully fail with exceptions (sync)', async () => {
    const { fetch, server } = components
    server.resetMiddlewares()

    server.use((ctx) => {
      throw new Error('some exception')
    })

    const res = await fetch.fetch(`/hola`)
    expect(res.status).toEqual(500)
  })

  describe('failures inside router', () => {
    it('gracefully fail with exceptions (async)', async () => {
      const { fetch, server } = components
      server.resetMiddlewares()
      const routes = new Router()
      server.use(routes.middleware())
      server.use(routes.allowedMethods())

      routes.get('/hola', async (ctx) => {
        throw new Error('some exception')
      })

      const res = await fetch.fetch(`/hola`)
      expect(res.status).toEqual(500)
    })

    it('gracefully fail with exceptions (sync)', async () => {
      const { fetch, server } = components
      server.resetMiddlewares()

      const routes = new Router()
      server.use(routes.middleware())
      server.use(routes.allowedMethods())

      routes.get('/hola', (ctx) => {
        throw new Error('some exception')
      })

      const res = await fetch.fetch(`/hola`)
      expect(res.status).toEqual(500)
    })
  })
}
