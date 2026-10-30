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
import { encryptPrivateKey } from './keyCrypto'
import { passphraseError } from './passphrase'
import { isInsideDshHome, removeSecretFile } from './secureFile'
import type { GithubSettings } from './settings'
import {
  encryptedKeyPath,
  keyFileExists,
  readSettings,
  writeSettings,
} from './settings'
import { parseTimestamp } from './time'
import { errorMessage } from './utils/errorMessage'

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/**
 * The slice of the DSH `connection` service this plugin relies on. It is
 * looked up lazily so the plugin keeps loading in profiles that have no
 * browser connection, where only loopback requests are accepted.
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
 * Require a live DSH browser session (or API credential) for a request.
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
    },
    auth,
    token: {
      issuedAt: parseTimestamp(settings.tokenIssuedAt),
      expiresAt: parseTimestamp(settings.tokenExpiresAt),
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

    // The DSH connection service is the authority whenever it is available:
    // it applies the Host/Origin fence and then requires a browser session or
    // an API credential for every request, loopback included. Skipping it for
    // a "loopback" Host would be a hole, because the Host header is supplied
    // by the client: a remote caller could send `Host: 127.0.0.1` and reach
    // every action unauthenticated. Only a profile without the service
    // (headless) falls back to loopback as the local trust boundary.
    if (resolveConnection(ctx) !== undefined || !isLoopbackRequest(req)) {
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
          const patch: Partial<GithubSettings> = {}
          if (typeof payload.appId === 'string') patch.appId = payload.appId
          if (typeof payload.installationId === 'string') patch.installationId = payload.installationId
          if (typeof payload.gitUserName === 'string') patch.gitUserName = payload.gitUserName
          if (typeof payload.gitUserEmail === 'string') patch.gitUserEmail = payload.gitUserEmail

          let uploadedName: string | null = null

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
            uploadedName = typeof payload.pemFileName === 'string' ? payload.pemFileName.trim() : ''
          }

          // Re-read after the async encryption above: a concurrent auto-save
          // must not be rolled back by a stale snapshot.
          const latest = readSettings()

          if (uploadedName !== null) {
            patch.keyFileName = uploadedName || latest.keyFileName || KEY_ENCRYPTED_FILENAME
          }

          const replacedKeyPath = patch.keyPath && latest.keyPath && latest.keyPath !== patch.keyPath && isInsideDshHome(latest.keyPath)
            ? latest.keyPath
            : null

          const next = writeSettings({ ...latest, ...patch })

          if (replacedKeyPath !== null) removeSecretFile(replacedKeyPath)

          // Touch the shared global git config only when the stored identity
          // actually changed. Auto-save used to rewrite it on every unrelated
          // edit, including merely opening the settings section.
          if (next.gitUserName !== latest.gitUserName || next.gitUserEmail !== latest.gitUserEmail) {
            await setGitIdentity(next.gitUserName, next.gitUserEmail)
          }

          ok(res, { settings: next, status: await statusPayload() })
          break
        }

        case 'clearConfig': {
          // Clearing the configuration must also end the session. Without the
          // logout the agent keeps using a token whose key the user just
          // deleted. Logout failures are not fatal here: the user asked to
          // drop the local configuration either way.
          await disconnect()

          const current = readSettings()

          removeSecretFile(current.keyPath)
          removeSecretFile(encryptedKeyPath())

          writeSettings({ appId: '', installationId: '', keyPath: null, keyFileName: null })
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
          const result = await disconnect()

          if (!result.ok) {
            fail(res, 500, result.error || 'Disconnect failed')

            return
          }

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
