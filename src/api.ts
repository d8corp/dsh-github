import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { writeSecretFile } from './atomicFile'
import {
  KEY_ENCRYPTED_FILENAME,
  MAX_BODY_BYTES,
  TOKEN_TTL_SECONDS,
} from './constants'
import type { StatusAuth, StatusPayload } from './contracts'
import {
  isLoopbackRequest,
  isTrustedApiRequest,
  PAYLOAD_TOO_LARGE,
  readJsonBody,
  writeJson,
} from './fence'
import type { AuthStatus } from './github'
import {
  connect,
  disconnect,
  getAuthStatus,
  getGhInfo,
  getGitIdentity,
  getGitInfo,
  installGh,
  installGit,
  setGitIdentity,
} from './github'
import { encryptPrivateKey, passphraseError } from './keyCrypto'
import { isInsideDshHome, removeSecretFile } from './secureFile'
import type { GithubSettings } from './settings'
import {
  encryptedKeyPath,
  keyFileExists,
  readSettings,
  writeSettings,
} from './settings'

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/**
 * The slice of the DSH `connection` service this plugin relies on. It is
 * looked up lazily so the plugin keeps loading in profiles that have no
 * browser connection, where non-loopback requests then fail closed.
 */
interface ConnectionLike {
  requestRejection?: (request: IncomingMessage) => unknown
}

interface PluginContext {
  connection?: ConnectionLike
  get?: (name: string) => unknown
}

/**
 * Resolve the connection service for browser-session verification.
 *
 * @param ctx plugin context.
 * @returns the service, or undefined when this profile has none.
 */
function resolveConnection (ctx: unknown): ConnectionLike | undefined {
  if (ctx === null || typeof ctx !== 'object') return undefined

  const candidate = ctx as PluginContext
  let direct: ConnectionLike | undefined

  try {
    direct = candidate.connection
  } catch { /* unknown services throw on some context proxies */ }

  if (direct && typeof direct.requestRejection === 'function') return direct

  if (typeof candidate.get === 'function') {
    try {
      const service = candidate.get('connection') as ConnectionLike | undefined

      if (service && typeof service.requestRejection === 'function') return service
    } catch { /* service lookup can fail while the host boots */ }
  }

  return undefined
}

/**
 * Require a live DSH browser session for a non-loopback request.
 *
 * @param ctx plugin context.
 * @param req incoming request.
 * @returns undefined when admitted, otherwise the HTTP status to return.
 */
function sessionRejection (ctx: unknown, req: IncomingMessage): number | undefined {
  const connection = resolveConnection(ctx)

  // Without a verifier the safe answer for a remote authority is "no".
  if (!connection || typeof connection.requestRejection !== 'function') return 403

  let rejection: unknown

  try {
    rejection = connection.requestRejection(req)
  } catch {
    return 403
  }

  if (rejection === undefined) return undefined

  return rejection === 401 ? 401 : 403
}

/**
 * Parse a persisted ISO-8601 token timestamp into epoch milliseconds.
 *
 * @param value ISO string stored in settings, or null.
 * @returns epoch milliseconds, or null when missing or unparsable.
 */
function tokenTime (value: string | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const ms = Date.parse(value)

  return Number.isFinite(ms) ? ms : null
}

function errorMessage (error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function ok (res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

function fail (res: ServerResponse, status: number, message: string): void {
  writeJson(res, status, { ok: false, error: { message } })
}

type StoredKey = { ok: true, keyPath: string } | { ok: false, status: number, message: string }

const PEM_MARKER = /PRIVATE KEY-----/

/**
 * Validate browser-supplied key material, encrypt it and store it at the
 * fixed encrypted-key path.
 *
 * @param pem PEM text.
 * @param passphrase user passphrase; never persisted.
 * @returns the stored path, or an HTTP status and message for the failure.
 */
async function storeEncryptedKey (pem: string, passphrase: unknown): Promise<StoredKey> {
  const invalid = passphraseError(passphrase)

  if (invalid !== null) return { ok: false, status: 400, message: invalid }
  if (!PEM_MARKER.test(pem)) return { ok: false, status: 400, message: 'Invalid private key format' }

  try {
    const envelope = await encryptPrivateKey(pem, passphrase as string)
    const keyPath = encryptedKeyPath()

    writeSecretFile(keyPath, envelope)

    return { ok: true, keyPath }
  } catch (error) {
    return { ok: false, status: 500, message: errorMessage(error, 'Cannot store encrypted private key') }
  }
}

async function statusPayload (): Promise<StatusPayload> {
  const settings = readSettings()
  const gh = await getGhInfo()
  const git = await getGitInfo()
  let auth: StatusAuth = { loggedIn: false, gitConfigured: false }
  if (gh.installed) auth = await getAuthStatus()
  const gitIdentity = git.installed ? await getGitIdentity() : { name: '', email: '' }

  return {
    gh,
    git,
    config: {
      appId: settings.appId,
      installationId: settings.installationId,
      gitUserName: settings.gitUserName,
      gitUserEmail: settings.gitUserEmail,
      keyFileName: settings.keyFileName,
      hasKey: keyFileExists(settings),
      keyEncrypted: settings.keyEncrypted,
    },
    auth,
    token: {
      issuedAt: tokenTime(settings.tokenIssuedAt),
      expiresAt: tokenTime(settings.tokenExpiresAt),
      ttlSeconds: TOKEN_TTL_SECONDS,
      active: auth.loggedIn,
    },
    gitIdentity,
  }
}

export function createApiHandler (ctx: unknown, { trustedHosts }: { trustedHosts: string[] }): ApiHandler {
  return async (req, res) => {
    if (!isTrustedApiRequest(req, trustedHosts)) {
      fail(res, 403, 'Untrusted request')

      return
    }

    // Loopback is the local trust boundary. Every remote authority must also
    // present a live DSH browser session: Host/Origin checks alone let anyone
    // who can reach the port replace the key or wipe the configuration.
    if (!isLoopbackRequest(req)) {
      const rejection = sessionRejection(ctx, req)

      if (rejection !== undefined) {
        fail(
          res,
          rejection,
          rejection === 401
            ? 'Authentication required: open the DSH Web UI from its printed URL.'
            : 'Untrusted request',
        )

        return
      }
    }

    const method = (req.method || 'GET').toUpperCase()

    if (method !== 'POST') {
      fail(res, 405, 'Method not allowed')

      return
    }

    const body = await readJsonBody(req, MAX_BODY_BYTES)

    // readJsonBody returns PAYLOAD_TOO_LARGE symbol on overflow
    if (body === PAYLOAD_TOO_LARGE) {
      fail(res, 413, 'Payload too large')

      return
    }

    const payload: Record<string, unknown> = body !== null && typeof body === 'object'
      ? body as Record<string, unknown>
      : {}

    const action = payload.action

    if (typeof action !== 'string' || action.trim() === '') {
      fail(res, 400, 'Missing action')

      return
    }

    try {
      switch (action) {
        case 'status': {
          ok(res, await statusPayload())
          break
        }

        case 'installGh': {
          const result = await installGh()
          ok(res, { install: result, status: await statusPayload() })
          break
        }

        case 'installGit': {
          const result = await installGit()
          ok(res, { install: result, status: await statusPayload() })
          break
        }

        case 'saveConfig': {
          const current = readSettings()
          const patch: Partial<GithubSettings> = {}
          if (typeof payload.appId === 'string') patch.appId = payload.appId
          if (typeof payload.installationId === 'string') patch.installationId = payload.installationId
          if (typeof payload.gitUserName === 'string') patch.gitUserName = payload.gitUserName
          if (typeof payload.gitUserEmail === 'string') patch.gitUserEmail = payload.gitUserEmail

          // handle pem upload
          if (typeof payload.pemBase64 === 'string' && payload.pemBase64.trim() !== '') {
            const pemBuffer = Buffer.from(payload.pemBase64, 'base64')
            let pemText = pemBuffer.toString('utf8')

            const stored = await storeEncryptedKey(pemText, payload.passphrase).finally(() => {
              pemText = ''
              pemBuffer.fill(0)
            })

            if (!stored.ok) {
              fail(res, stored.status, stored.message)

              return
            }

            patch.keyPath = stored.keyPath
            patch.keyEncrypted = true

            patch.keyFileName = typeof payload.pemFileName === 'string' && payload.pemFileName.trim() !== ''
              ? payload.pemFileName.trim()
              : (current.keyFileName || KEY_ENCRYPTED_FILENAME)
          }

          // Re-read after the async encryption above: a concurrent auto-save
          // must not be rolled back by a stale snapshot.
          const latest = readSettings()

          const replacedKeyPath = patch.keyPath && latest.keyPath && latest.keyPath !== patch.keyPath && isInsideDshHome(latest.keyPath)
            ? latest.keyPath
            : null

          const next = writeSettings({ ...latest, ...patch })

          if (replacedKeyPath !== null) removeSecretFile(replacedKeyPath)

          if (Object.prototype.hasOwnProperty.call(patch, 'gitUserName') || Object.prototype.hasOwnProperty.call(patch, 'gitUserEmail')) {
            await setGitIdentity(next.gitUserName, next.gitUserEmail)
          }

          ok(res, { settings: next, status: await statusPayload() })
          break
        }

        case 'encryptKey': {
          const current = readSettings()

          if (!current.keyPath || !existsSync(current.keyPath)) {
            fail(res, 400, 'No private key to encrypt')
            break
          }

          if (current.keyEncrypted) {
            ok(res, { settings: current, status: await statusPayload() })
            break
          }

          if (!isInsideDshHome(current.keyPath)) {
            fail(res, 400, 'Private key is outside the DSH home; upload it again to encrypt.')
            break
          }

          let pemText: string

          try {
            pemText = readFileSync(current.keyPath, 'utf8')
          } catch {
            fail(res, 400, 'Cannot read private key')
            break
          }

          const stored = await storeEncryptedKey(pemText, payload.passphrase).finally(() => {
            pemText = ''
          })

          if (!stored.ok) {
            fail(res, stored.status, stored.message)
            break
          }

          const next = writeSettings({ ...readSettings(), keyPath: stored.keyPath, keyEncrypted: true })

          removeSecretFile(current.keyPath)

          ok(res, { settings: next, status: await statusPayload() })
          break
        }

        case 'clearConfig': {
          const current = readSettings()

          removeSecretFile(current.keyPath)
          removeSecretFile(encryptedKeyPath())

          writeSettings({ appId: '', installationId: '', keyPath: null, keyFileName: null, keyEncrypted: false })
          ok(res, await statusPayload())
          break
        }

        case 'connect': {
          const settings = readSettings()
          const result = await connect(settings, payload.passphrase)
          ok(res, { connect: result, status: await statusPayload() })
          break
        }

        case 'disconnect': {
          await disconnect()
          ok(res, await statusPayload())
          break
        }

        case 'test': {
          const auth: AuthStatus = await getAuthStatus()
          ok(res, { auth, status: await statusPayload() })
          break
        }

        default:
          fail(res, 400, `Unknown action: ${action}`)
      }
    } catch (error) {
      fail(res, 500, errorMessage(error, 'Internal error'))
    }
  }
}
