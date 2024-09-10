import { Readable } from 'stream'
import Undici from 'undici'
import NodeFetch from 'node-fetch'
import { gzipSync } from 'zlib'
import { testWithServer } from './test-server-runner'

testWithServer('fetch suite', ({ components, stubComponents }) => {
  const content = Buffer.from('holacaracola', 'utf-8')

  let infiniteRedirectCount = 0

  it('prepares the endpoints', () => {
    components.router.get(`/working`, async () => {
      return {
        body: content.toString()
      }
    })
    components.router.get(`/working-redirected-302`, async () => {
      return {
        status: 302,
        headers: {
          location: '/working'
        }
      }
    })
    components.router.get(`/working-redirected-301`, async () => {
      return {
        status: 301,
        headers: {
          location: '/working'
        }
      }
    })
    components.router.get(`/forever-redirecting-301`, async () => {
      infiniteRedirectCount++
      return {
        status: 301,
        headers: {
          location: '/forever-redirecting-301'
        }
      }
    })

    components.router.get(`/fails`, async (ctx) => {
      let chunk = 0

      function* streamContent() {
        // sleep to fool the nagle algorithm
        chunk++
        yield 'a'
        if (chunk == 100) {
          console.log('Closing stream')
          throw new Error('Closing stream')
        }
      }

      const headers: Record<string, string> = ctx.url.searchParams.has('connection')
        ? {
            connection: ctx.url.searchParams.get('connection')!
          }
        : {}

      return {
        headers: {
          ...headers,
          'content-length': '100000'
        },
        body: Readable.from(streamContent(), { encoding: 'utf-8' })
      }
    })
  })

  test('undici', Undici.fetch)
  test('node-fetch', NodeFetch)

  function test(name: string, fetch: typeof Undici.fetch | typeof NodeFetch) {
    describe(name, () => {
      it('/wroking', async () => {
        const res = await fetch(await components.getUrl('/working'))
        expect(await res.text()).toEqual('holacaracola')
        expect(res.status).toEqual(200)
      })

      it('/working-redirected-301', async () => {
        const res = await fetch(await components.getUrl('/working-redirected-301'))
        expect(await res.text()).toEqual('holacaracola')
        expect(res.status).toEqual(200)
      })

      it('/working-redirected-302', async () => {
        const res = await fetch(await components.getUrl('/working-redirected-302'))
        expect(await res.text()).toEqual('holacaracola')
        expect(res.status).toEqual(200)
      })

      it('/forever-redirecting-301', async () => {
        infiniteRedirectCount = 0
        await expect(fetch(await components.getUrl('/forever-redirecting-301'))).rejects.toThrow()
        expect(infiniteRedirectCount).toBeGreaterThan(1)
      })

      ;(name == 'node-fetch' ? it : xit)('/fails?connection=keep-alive', async () => {
        const res = await fetch(await components.getUrl('/fails?connection=keep-alive'), { timeout: 1000 })
        expect(res.status).toEqual(200)
        await expect(res.arrayBuffer()).rejects.toThrowError()
      })

      it('/fails?connection=close', async () => {
        const res = await fetch(await components.getUrl('/fails?connection=close'), { timeout: 1000 })
        expect(res.status).toEqual(200)
        await expect(res.arrayBuffer()).rejects.toThrowError()
      })
    })
  }
})
