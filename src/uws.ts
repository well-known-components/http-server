import { _setUnderlyingServer } from "./injectors"
import type { ServerComponents, IUwsHttpServerOptions } from "./types"
import { createServerHandler } from "./server-handler"
import * as http from "http"
import * as fetch from "node-fetch"
import { getWebSocketCallback, WebSocketCallback } from "./ws"
import * as uwslib from "uWebSockets.js"
import { FullHttpServerComponent } from "./server"
import { Readable } from "stream"
import { IHttpServerComponent } from "@well-known-components/interfaces"
import mitt, { Emitter } from "mitt"

export type WsEvents = {
  open: any
  message: ArrayBuffer
  close: any
  error: Error
}

export type WsUserData = uwslib.WebSocket &
  Emitter<WsEvents> & {
    aborted: boolean
    websocketConnect: WebSocketCallback
    readyState: number
    /** The connection is not yet open. */
    readonly CONNECTING: 0
    /** The connection is open and ready to communicate. */
    readonly OPEN: 1
    /** The connection is in the process of closing. */
    readonly CLOSING: 2
    /** The connection is closed. */
    readonly CLOSED: 3
  }

/**
 * Creates a http-server component
 * @public
 */
export async function createUwsHttpServer<Context extends object>(
  components: ServerComponents,
  options: Partial<IUwsHttpServerOptions>
): Promise<FullHttpServerComponent<Context>> {
  const { config, logs, ws } = components
  const logger = logs.getLogger("http-server")

  // config
  const port = await config.requireNumber("HTTP_SERVER_PORT")
  const host = await config.requireString("HTTP_SERVER_HOST")

  const server: uwslib.TemplatedApp = uwslib
    .App({
    })
    .ws("/*", {
      upgrade: wsHandler,
      open(_ws) {
        const ws = _ws as WsUserData
        ws.websocketConnect(ws as any)
        ws.readyState = ws.OPEN
        ws.emit("open", {})
        if (ws.onopen) {
          ws.onopen()
        }
      },
      message: (_ws, message, isBinary) => {
        _ws.emit("message", message)
        if (_ws.onmessage) {
          _ws.onmessage(message)
        }
      },
      close: (_ws) => {
        const ws = _ws as WsUserData
        _ws.readyState = ws.CLOSED
        _ws.emit("close", {})
        if (_ws.onclose) {
          _ws.onclose()
        }
      },
    })
    .any("/*", handler)

  let listen: Promise<uwslib.us_listen_socket> | undefined

  async function start(): Promise<void> {
    if (listen) {
      logger.error("start() called more than once")
      await listen
      return
    }

    listen = new Promise<uwslib.us_listen_socket>((resolve, reject) => {
      try {
        server.listen(host, port, (token) => {
          logger.log(`Listening ${host}:${port}`)
          resolve(token)
        })
      } catch (err: any) {
        reject(err)
      }
    })

    await listen
  }

  async function stop() {
    if (listen) {
      logger.info(`Closing server`)
      const token = await listen
      uwslib.us_listen_socket_close(token)
      logger.info(`Server closed`)
    }
  }

  let configuredContext: Context = Object.create({})

  const serverHandler = createServerHandler<Context>()

  const ret: FullHttpServerComponent<Context> = {
    // IBaseComponent
    start,
    stop,
    // IStatusCheckCapableComponent
    async startupProbe() {
      return true
    },
    async readynessProbe() {
      if (!listen) return false
      await listen
      return true
    },
    // IHttpServerComponent
    use: serverHandler.use,
    setContext(context) {
      configuredContext = context
    },

    // extra
    resetMiddlewares: serverHandler.resetMiddlewares,
  }

  function handler(response: uwslib.HttpResponse, request: uwslib.HttpRequest) {
    let aborted = false
    response.onAborted(() => {
      aborted = true
    })

    async function asyncHandle(req: uwslib.HttpRequest, res: uwslib.HttpResponse) {
      const request = getRequestFromµws(req, res, host)
      const response = await serverHandler.processRequest(configuredContext, request)
      if (!aborted) successUws(response, res)
    }
    asyncHandle(request, response).catch((error) => {
      logger.error(error)

      if (error.code == "ERR_INVALID_URL") {
        response.writeStatus("404 Not found").end()
      } else {
        response.writeStatus("500 Internal Server Error").end()
      }
    })
  }

  function wsHandler(res: uwslib.HttpResponse, req: uwslib.HttpRequest, context: uwslib.us_socket_context_t) {
    const userData: Partial<WsUserData> = {
      aborted: false,
      websocketConnect: null as any,
      /** The connection is not yet open. */
      CONNECTING: 0,
      /** The connection is open and ready to communicate. */
      OPEN: 1,
      /** The connection is in the process of closing. */
      CLOSING: 2,
      /** The connection is closed. */
      CLOSED: 3,
      readyState: 0,
      ...mitt(),
    }

    /* You MUST register an abort handler to know if the upgrade was aborted by peer */
    res.onAborted(() => {
      /* We can simply signal that we were aborted */
      userData.aborted = true
      userData.readyState = userData.CLOSED!
      userData.emit!("error", new Error("Ws connection aborted"))
      userData.emit!("close", {})
    })

    async function h() {
      if (!ws) {
        throw new Error("No WebSocketServer present")
      }

      const request = getRequestFromµws(req, res, host)
      const response = await serverHandler.processRequest(configuredContext, request)

      const websocketConnect = getWebSocketCallback(response)
      if (userData.aborted) return
      if (websocketConnect) {
        userData.websocketConnect = websocketConnect
        const secWebSocketKey = req.getHeader("sec-websocket-key")
        const secWebSocketProtocol = req.getHeader("sec-websocket-protocol")
        const secWebSocketExtensions = req.getHeader("sec-websocket-extensions")

        res.upgrade(
          userData /* Use our copies here */,
          secWebSocketKey,
          secWebSocketProtocol,
          secWebSocketExtensions,
          context
        )
      } else {
        successUws(response, res)
      }
    }
    h().catch((error) => {
      logger.error(error)

      if (error.code == "ERR_INVALID_URL") {
        res.writeStatus("404 Not found").end()
      } else {
        res.writeStatus("500 Internal Server Error").end()
      }
    })
  }

  return ret
}

/**
 * @internal
 */
export function successUws(data: fetch.Response, res: uwslib.HttpResponse) {
  const isBuffer = Buffer.isBuffer(data.body) || data instanceof Uint8Array

  const headers = new fetch.Headers(data.headers as any)

  res.cork(() => {
    if (data.status) {
      res.writeStatus(`${data.status} ${data.statusText || http.STATUS_CODES[data.status] || "Not found"}`)
    }

    if (data.headers) {
      headers.forEach((value, key) => {
        // µWs sets the content-length automatically
        if (key == "content-length") return
        if (key == "transfer-encoding") return
        if (value !== undefined) {
          res.writeHeader(key, value)
        }
      })
    }

    if (isBuffer) res.end(toArrayBuffer(data.body as any))
  })

  if (isBuffer) return

  const body = data.body

  if (body && (body as any).pipe) {
    const len = headers.get("content-length")
    if (len && !isNaN(len as any)) {
      pipeStreamOverResponse(res, body as Readable, +len)
    } else {
      pipeOpenEndedStreamOverResponse(res, body as Readable)
    }
  } else if (body !== undefined && body !== null) {
    throw new Error("Unknown response body")
  } else {
    res.end()
  }
}

function tb(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

/* Helper function converting Node.js buffer to ArrayBuffer */
function toArrayBuffer(element: Buffer | ArrayBufferLike) {
  if (element instanceof Buffer || Buffer.isBuffer(element)) {
    return tb(element)
  } else if (ArrayBuffer.isView(element)) {
    return tb(Buffer.from(element.buffer, element.byteOffset, element.byteLength))
  } else if (element instanceof ArrayBuffer) {
    return tb(Buffer.from(element))
  } else {
    return tb(Buffer.from(typeof element === "string" ? element : String(element)))
  }
  throw new Error("Cannot convert argument to buffer")
}

/* Helper function to pipe the ReadaleStream over an Http responses */
function pipeOpenEndedStreamOverResponse(res: uwslib.HttpResponse, readStream: Readable) {
  /* Careful! If Node.js would emit error before the first res.tryEnd, res will hang and never time out */
  /* For this demo, I skipped checking for Node.js errors, you are free to PR fixes to this example */
  readStream
    .on("data", (chunk) => {
      /* We only take standard V8 units of data */
      const ab = toArrayBuffer(chunk)

      /* Store where we are, globally, in our response */
      let lastOffset = res.getWriteOffset()

      /* Streaming a chunk returns whether that chunk was sent, and if that chunk was last */
      let ok = res.write(ab)

      /* Did we successfully send last chunk? */
      if (!ok) {
        /* If we could not send this chunk, pause */
        readStream.pause()

        /* Save unsent chunk for when we can send it */
        res.ab = ab
        res.abOffset = lastOffset

        /* Register async handlers for drainage */
        res.onWritable((offset) => {
          /* We sent a chunk and it was not the last one, so let's resume reading.
           * Timeout is still disabled, so we can spend any amount of time waiting
           * for more chunks to send. */
          readStream.resume()

          /* We always have to return true/false in onWritable.
           * If you did not send anything, return true for success. */
          return ok
        })
      }
    })
    .on("close", () => {
      res.end()
    })
    .on("error", (err) => {
      /* Todo: handle errors of the stream, probably good to simply close the response */
      console.log(err)
      res.end()
    })

  /* If you plan to asyncronously respond later on, you MUST listen to onAborted BEFORE returning */
  res.onAborted(() => {
    onAbortedOrFinishedResponse(res, readStream)
  })
}

/* Helper function to pipe the ReadaleStream over an Http responses */
function pipeStreamOverResponse(res: uwslib.HttpResponse, readStream: Readable, totalSize: number) {
  /* Careful! If Node.js would emit error before the first res.tryEnd, res will hang and never time out */
  /* For this demo, I skipped checking for Node.js errors, you are free to PR fixes to this example */
  readStream
    .on("data", (chunk) => {
      /* We only take standard V8 units of data */
      const ab = toArrayBuffer(chunk)

      /* Store where we are, globally, in our response */
      let lastOffset = res.getWriteOffset()

      /* Streaming a chunk returns whether that chunk was sent, and if that chunk was last */
      let [ok, done] = res.tryEnd(ab, totalSize)

      /* Did we successfully send last chunk? */
      if (done) {
        onAbortedOrFinishedResponse(res, readStream)
      } else if (!ok) {
        /* If we could not send this chunk, pause */
        readStream.pause()

        /* Save unsent chunk for when we can send it */
        res.ab = ab
        res.abOffset = lastOffset

        /* Register async handlers for drainage */
        res.onWritable((offset) => {
          /* Here the timeout is off, we can spend as much time before calling tryEnd we want to */

          /* On failure the timeout will start */
          let [ok, done] = res.tryEnd(res.ab.slice(offset - res.abOffset), totalSize)
          if (done) {
            onAbortedOrFinishedResponse(res, readStream)
          } else if (ok) {
            /* We sent a chunk and it was not the last one, so let's resume reading.
             * Timeout is still disabled, so we can spend any amount of time waiting
             * for more chunks to send. */
            readStream.resume()
          }

          /* We always have to return true/false in onWritable.
           * If you did not send anything, return true for success. */
          return ok
        })
      }
    })
    .on("close", () => {
      res.end()
    })
    .on("error", (err) => {
      /* Todo: handle errors of the stream, probably good to simply close the response */
      console.log(err)
      res.end()
    })

  /* If you plan to asyncronously respond later on, you MUST listen to onAborted BEFORE returning */
  res.onAborted(() => {
    onAbortedOrFinishedResponse(res, readStream)
  })
}

/* Either onAborted or simply finished request */
function onAbortedOrFinishedResponse(res: uwslib.HttpResponse, readStream: Readable) {
  if (res.id == -1) {
    console.log("ERROR! onAbortedOrFinishedResponse called twice for the same res!")
  } else {
    readStream.destroy()
  }

  /* Mark this response already accounted for */
  res.id = -1
}

export function getRequestFromµws(
  request: uwslib.HttpRequest,
  response: uwslib.HttpResponse,
  host: string
): IHttpServerComponent.IRequest {
  const headers = new fetch.Headers()

  request.forEach((key, value) => {
    headers.append(key, value)
  })

  const requestInit: fetch.RequestInit = {
    headers: headers,
    method: request.getMethod().toUpperCase(),
  }

  if (requestInit.method != "GET" && requestInit.method != "HEAD") {
    const stream = new Readable({ objectMode: false, read() {} })
    requestInit.body = stream
    response.onData((chunk, isLast) => {
      /* Buffer this anywhere you want to */
      stream.push(Buffer.from(chunk))
      /* We respond when we are done */
      if (isLast) {
        stream.push(null)
      }
    })

    response.onAborted(() => {
      /* Request was prematurely aborted, stop reading */
      stream.destroy(new Error("Request aborted by client"))
    })
  }

  const protocol = headers.get("X-Forwarded-Proto") == "https" ? "https" : "http"
  const baseUrl = protocol + "://" + (headers.get("X-Forwarded-Host") || headers.get("host") || host || "0.0.0.0")

  // Note: Express.js overwrite `req.url` freely for internal routing
  // purposes and retains the original value on `req.originalUrl`
  // @see https://expressjs.com/en/api.html#req.originalUrl
  const originalUrl = request.getUrl()
  let url = new URL(baseUrl + originalUrl)
  try {
    url = new URL(originalUrl, baseUrl)
  } catch {}
  const qs = request.getQuery()
  if (qs) url.search = qs
  const ret = new fetch.Request(url.toString(), requestInit)

  return ret
}
