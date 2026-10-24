// Copied/adapted from dsh-groq-speech (MIT).

import type { IncomingMessage, ServerResponse } from 'node:http'

import { MAX_BODY_BYTES } from './constants'

export const PAYLOAD_TOO_LARGE = Symbol('payload-too-large')

export function parseAuthority (authority: unknown): URL | undefined {
  if (typeof authority !== 'string') return undefined
  const value = authority.trim()
  if (value === '' || /[/?#@\\\s]/.test(value)) return undefined

  try {
    const url = new URL(`http://${value}`)
    if (url.username !== '' || url.password !== '' || url.pathname !== '/') return undefined

    return url
  } catch {
    return undefined
  }
}

export function isLoopbackHostname (hostname: unknown): boolean {
  if (typeof hostname !== 'string' || hostname === '') return false
  let name = hostname.toLowerCase()
  if (name.startsWith('[') && name.endsWith(']')) name = name.slice(1, -1)
  if (name === 'localhost' || name === '::1') return true
  const dotted = name.startsWith('::ffff:') ? name.slice('::ffff:'.length) : name
  const parts = dotted.split('.')

  return parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

export function canonicalAuthority (authority: string): string | undefined {
  const url = parseAuthority(authority)
  if (url === undefined) return undefined
  const explicitPort = /:(\d+)$/.exec(authority.trim())

  return explicitPort === null ? url.hostname : `${url.hostname}:${explicitPort[1]}`
}

function isTrustedAuthority (authority: string, hostUrl: URL, trustedHosts: string[]): boolean {
  const requestAuthority = canonicalAuthority(authority) || hostUrl.hostname

  return trustedHosts.some((entry) => {
    const url = parseAuthority(entry)
    if (url === undefined) return false
    const canonical = canonicalAuthority(entry)
    if (canonical === undefined) return false
    const entryHasPort = /:\d+$/.test(entry.trim())

    return entryHasPort ? canonical === requestAuthority : url.hostname === hostUrl.hostname
  })
}

export function buildTrustedHosts (entries: unknown, warn?: (message: string) => void): string[] {
  const trusted: string[] = []

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry !== 'string') {
      if (warn) warn('trusted host entry is not a string')
      continue
    }

    const canonical = canonicalAuthority(entry)

    if (canonical === undefined || canonical !== entry.trim().toLowerCase()) {
      if (warn) warn(`entry ${JSON.stringify(entry)} is not a bare host[:port] authority`)
      continue
    }

    trusted.push(entry.trim())
  }

  return trusted
}

export function isTrustedApiRequest (req: unknown, trustedHosts: string[] = []): boolean {
  if (req === null || typeof req !== 'object') return false

  const headers: Record<string, unknown> = 'headers' in req && req.headers !== null && typeof req.headers === 'object'
    ? req.headers as Record<string, unknown>
    : {}

  const host = typeof headers.host === 'string' ? headers.host : undefined
  if (host === undefined) return false

  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(host, hostUrl, trustedHosts)) return false

  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site.toLowerCase() === 'cross-site') return false

  const origin = headers.origin
  if (origin === undefined || origin === '') return true
  if (typeof origin !== 'string') return false

  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

export function readJsonBody (req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    req.on('data', (chunk) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
      size += buffer.length

      if (size > maxBytes) {
        settled = true
        req.pause()
        resolve(PAYLOAD_TOO_LARGE)

        return
      }

      chunks.push(buffer)
    })

    req.on('end', () => {
      if (settled) return
      settled = true

      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        resolve(raw === '' ? null : JSON.parse(raw))
      } catch {
        resolve(null)
      }
    })

    req.on('error', () => {
      if (settled) return
      settled = true
      resolve(null)
    })
  })
}

export function writeJson (res: ServerResponse, status: number, value: unknown): void {
  if (!res || res.writableEnded || res.destroyed) return
  const body = JSON.stringify(value)

  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })

  res.end(body)
}
