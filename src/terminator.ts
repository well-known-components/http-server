// Based on work of https://github.com/gajus/http-terminator

import type { ILoggerComponent } from '@well-known-components/interfaces'
import future, { IFuture } from 'fp-future'
import http from 'http'
import https from 'https'
import type { Duplex } from 'stream'

const configurationDefaults: HttpTerminatorConfigurationInput = {
  gracefulTerminationTimeout: 1_000
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

type Socket = Duplex & {
  server?: http.Server | https.Server
}

export type HttpTerminatorConfigurationInput = {
  gracefulTerminationTimeout: number
}

export function createServerTerminator(
  server: http.Server | https.Server,
  components: { logger: ILoggerComponent.ILogger },
  configurationInput: Partial<HttpTerminatorConfigurationInput>
) {
  const { logger } = components

  const configuration: HttpTerminatorConfigurationInput = {
    ...configurationDefaults,
    ...configurationInput
  }

  const sockets = new Set<Socket>()
  const secureSockets = new Set<Socket>()

  let terminating: IFuture<void> | undefined

  server.on('connection', (socket) => {
    if (terminating) {
      socket.destroy()
    } else {
      sockets.add(socket)

      socket.once('close', () => {
        sockets.delete(socket)
      })
    }
  })

  server.on('secureConnection', (socket) => {
    if (terminating) {
      socket.destroy()
    } else {
      secureSockets.add(socket)

      socket.once('close', () => {
        secureSockets.delete(socket)
      })
    }
  })

  /**
   * Evaluate whether additional steps are required to destroy the socket.
   *
   * @see https://github.com/nodejs/node/blob/57bd715d527aba8dae56b975056961b0e429e91e/lib/_http_client.js#L363-L413
   */
  const destroySocket = (socket: Socket) => {
    socket.destroy()

    if (socket.server instanceof http.Server) {
      sockets.delete(socket)
    } else {
      secureSockets.delete(socket)
    }
  }

  const terminate = async () => {
    if (terminating) {
      logger.warn('Already terminating HTTP server')

      return terminating
    }

    terminating = future<void>()

    server.on('request', (incomingMessage, outgoingMessage) => {
      if (!outgoingMessage.headersSent) {
        outgoingMessage.setHeader('connection', 'close')
      }
    })

    for (const socket of sockets) {
      // This is the HTTP CONNECT request socket.
      // Unclear if I am using wrong type or how else this should be handled.
      if (!(socket.server instanceof https.Server) && !(socket.server instanceof http.Server)) {
        continue
      }

      // @ts-expect-error Unclear if I am using wrong type or how else this should be handled.
      const serverResponse = socket._httpMessage

      if (serverResponse) {
        if (!serverResponse.headersSent) {
          serverResponse.setHeader('connection', 'close')
        }

        continue
      }

      destroySocket(socket)
    }

    for (const socket of secureSockets) {
      // @ts-expect-error Unclear if I am using wrong type or how else this should be handled.
      const serverResponse = socket._httpMessage

      if (serverResponse) {
        if (!serverResponse.headersSent) {
          serverResponse.setHeader('connection', 'close')
        }

        continue
      }

      destroySocket(socket)
    }

    if (sockets.size) {
      await delay(configuration.gracefulTerminationTimeout)

      for (const socket of sockets) {
        destroySocket(socket)
      }
    }

    if (secureSockets.size) {
      await delay(configuration.gracefulTerminationTimeout)

      for (const socket of secureSockets) {
        destroySocket(socket)
      }
    }

    server.close((error) => {
      if (error) {
        terminating!.reject(error)
      } else {
        terminating!.resolve()
      }
    })

    return terminating
  }

  return {
    secureSockets,
    sockets,
    terminate
  }
}
