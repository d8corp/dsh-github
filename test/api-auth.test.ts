/**
 * @jest-environment node
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import { createApiHandler } from '../src/api'

class StubResponse {
  statusCode = 0
  headers: Record<string, unknown> = {}
  body = ''
  writableEnded = false
  destroyed = false

  writeHead (status: number, headers: Record<string, unknown>): this {
    this.statusCode = status
    this.headers = headers

    return this
  }

  end (chunk?: string): void {
    this.body = chunk === undefined ? '' : chunk
    this.writableEnded = true
  }
}

interface CallOptions {
  host?: string
  trustedHosts?: string[]
  ctx?: unknown
  body?: Record<string, unknown>
}

/**
 * Invoke the API handler with a synthetic request.
 *
 * @param options host authority, trusted hosts, plugin context and JSON body.
 * @returns captured status code and parsed response body.
 */
async function callApi (options: CallOptions = {}): Promise<{ statusCode: number, payload: any }> {
  const host = options.host ?? '127.0.0.1:3080'
  const handler = createApiHandler(options.ctx ?? {}, { trustedHosts: options.trustedHosts ?? [] })
  const req = Readable.from([JSON.stringify(options.body ?? { action: 'unknown' })]) as unknown as IncomingMessage

  req.method = 'POST'
  req.headers = { host, origin: `http://${host}` }

  const res = new StubResponse()

  await handler(req, res as unknown as ServerResponse)

  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

describe('non-loopback API authentication', () => {
  test('rejects a trusted remote authority when no session verifier exists', async () => {
    const response = await callApi({
      host: '192.168.1.10:3080',
      trustedHosts: ['192.168.1.10:3080'],
    })

    expect(response.statusCode).toBe(403)
    expect(response.payload.ok).toBe(false)
  })

  test('rejects a remote authority without a browser session', async () => {
    const response = await callApi({
      host: '192.168.1.10:3080',
      trustedHosts: ['192.168.1.10:3080'],
      ctx: { connection: { requestRejection: () => 401 } },
    })

    expect(response.statusCode).toBe(401)
    expect(response.payload.error.message).toMatch(/authentication required/i)
  })

  test('admits a remote authority with a live DSH session', async () => {
    const seen: unknown[] = []
    const response = await callApi({
      host: '192.168.1.10:3080',
      trustedHosts: ['192.168.1.10:3080'],
      ctx: {
        connection: {
          requestRejection: (req: IncomingMessage) => {
            seen.push(req.headers.host)

            return undefined
          },
        },
      },
    })

    // The request passed the session gate and reached action dispatch.
    expect(response.statusCode).toBe(400)
    expect(response.payload.error.message).toMatch(/unknown action/i)
    expect(seen).toEqual(['192.168.1.10:3080'])
  })

  test('does not require a session on loopback', async () => {
    let calls = 0
    const response = await callApi({
      ctx: {
        connection: {
          requestRejection: () => {
            calls += 1

            return 401
          },
        },
      },
    })

    expect(response.statusCode).toBe(400)
    expect(calls).toBe(0)
  })

  test('keeps the Host/Origin fence in front of the session gate', async () => {
    const response = await callApi({ host: '192.168.1.10:3080' })

    expect(response.statusCode).toBe(403)
  })

  test('looks the connection service up lazily when it is not on the context proxy', async () => {
    const response = await callApi({
      host: '192.168.1.10:3080',
      trustedHosts: ['192.168.1.10:3080'],
      ctx: { get: (name: string) => (name === 'connection' ? { requestRejection: () => undefined } : undefined) },
    })

    expect(response.statusCode).toBe(400)
  })
})
