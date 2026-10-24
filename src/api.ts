import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'

import {
  KEY_FILENAME,
  MAX_BODY_BYTES,
} from './constants'
import {
  isTrustedApiRequest,
  PAYLOAD_TOO_LARGE,
  readJsonBody,
  writeJson,
} from './fence'
import type { AuthStatus, GitIdentity, ToolInfo } from './github'
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
import type { GithubSettings } from './settings'
import {
  dshHomeDir,
  keyFileExists,
  readSettings,
  writeSettings,
} from './settings'

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

interface StatusAuth {
  loggedIn: boolean
  gitConfigured: boolean
  error?: string
}

interface ToolStatus {
  installed: boolean
  version: string | null
}

interface ApiError {
  message: string
}

function errorMessage (error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function ok (res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

function fail (res: ServerResponse, status: number, message: string): void {
  writeJson(res, status, { ok: false, error: { message } as ApiError })
}

async function statusPayload (): Promise<{
  gh: ToolStatus
  git: ToolStatus
  gitInfo: ToolStatus
  gitVersion: ToolStatus
  gitCli: ToolStatus
  gitCliInfo: ToolStatus
  config: {
    appId: string
    installationId: string
    gitUserName: string
    gitUserEmail: string
    keyFileName: string | null
    hasKey: boolean
  }
  auth: StatusAuth
  gitIdentity: GitIdentity
}> {
  const settings = readSettings()
  const gh: ToolInfo = await getGhInfo()
  const git: ToolInfo = await getGitInfo()
  let auth: StatusAuth = { loggedIn: false, gitConfigured: false }
  if (gh.installed) auth = await getAuthStatus()
  const gitIdentity = git.installed ? await getGitIdentity() : { name: '', email: '' }

  return {
    gh,
    git,
    gitInfo: git,
    gitVersion: git,
    gitCli: git,
    gitCliInfo: git,
    config: {
      appId: settings.appId,
      installationId: settings.installationId,
      gitUserName: settings.gitUserName,
      gitUserEmail: settings.gitUserEmail,
      keyFileName: settings.keyFileName,
      hasKey: keyFileExists(settings),
    },
    auth,
    gitIdentity,
  }
}

export function createApiHandler (_ctx: unknown, { trustedHosts }: { trustedHosts: string[] }): ApiHandler {
  return async (req, res) => {
    if (!isTrustedApiRequest(req, trustedHosts)) {
      fail(res, 403, 'Untrusted request')

      return
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

        case 'installGh':
        case 'install':
        case 'installMissing':
        case 'installCli':

        case 'installTools': {
          const result = await installGh()
          ok(res, { install: result, status: await statusPayload() })
          break
        }

        case 'installGit':

        case 'installGitCli': {
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
            let pemText: string

            try {
              pemText = Buffer.from(payload.pemBase64, 'base64').toString('utf8')
            } catch {
              fail(res, 400, 'Invalid key encoding')

              return
            }

            if (!/PRIVATE KEY-----/.test(pemText)) {
              fail(res, 400, 'Invalid private key format')

              return
            }

            const keyPath = join(dshHomeDir(), KEY_FILENAME)
            mkdirSync(dirname(keyPath), { recursive: true })
            writeFileSync(keyPath, pemText, { mode: 0o600 })
            patch.keyPath = keyPath

            patch.keyFileName = typeof payload.pemFileName === 'string' && payload.pemFileName.trim() !== ''
              ? payload.pemFileName.trim()
              : KEY_FILENAME
          }

          const next = writeSettings({ ...current, ...patch })

          if (Object.prototype.hasOwnProperty.call(patch, 'gitUserName') || Object.prototype.hasOwnProperty.call(patch, 'gitUserEmail')) {
            await setGitIdentity(next.gitUserName, next.gitUserEmail)
          }

          ok(res, { settings: next, status: await statusPayload() })
          break
        }

        case 'clearConfig': {
          const current = readSettings()

          if (current.keyPath && existsSync(current.keyPath)) {
            try { unlinkSync(current.keyPath) } catch { /* ignore */ }
          }

          writeSettings({ appId: '', installationId: '', keyPath: null, keyFileName: null })
          ok(res, await statusPayload())
          break
        }

        case 'connect': {
          const settings = readSettings()
          const result = await connect(settings)
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
