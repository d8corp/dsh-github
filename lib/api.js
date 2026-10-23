import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  API_PREFIX,
  KEY_FILENAME,
  MAX_BODY_BYTES
} from './constants.js'
import {
  dshHomeDir,
  readSettings,
  writeSettings,
  keyFileExists
} from './settings.js'
import {
  buildTrustedHosts,
  isTrustedApiRequest,
  PAYLOAD_TOO_LARGE,
  readJsonBody,
  writeJson
} from './fence.js'
import {
  getGhInfo,
  getGitInfo,
  getAuthStatus,
  getGitIdentity,
  installGh,
  installGit,
  connect,
  disconnect,
  setGitIdentity
} from './github.js'

function ok (res, value) { writeJson(res, 200, { ok: true, value }) }
function fail (res, status, message) { writeJson(res, status, { ok: false, error: { message } }) }

async function statusPayload () {
  const settings = readSettings()
  const gh = await getGhInfo()
  const git = await getGitInfo()
  let auth = { loggedIn: false, gitConfigured: false }
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
      hasKey: keyFileExists(settings)
    },
    auth,
    gitIdentity
  }
}

export function createApiHandler (ctx, { trustedHosts }) {
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
    if (body === null) {
      // could be empty body or parse error; treat as empty action
    }
    if (body === (Symbol && Symbol.for ? undefined : undefined)) {}
    // readJsonBody returns PAYLOAD_TOO_LARGE symbol on overflow
    if (body === PAYLOAD_TOO_LARGE) {
      fail(res, 413, 'Payload too large')
      return
    }

    const action = body && typeof body === 'object' ? body.action : undefined
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
          const patch = {}
          if (typeof body.appId === 'string') patch.appId = body.appId
          if (typeof body.installationId === 'string') patch.installationId = body.installationId
          if (typeof body.gitUserName === 'string') patch.gitUserName = body.gitUserName
          if (typeof body.gitUserEmail === 'string') patch.gitUserEmail = body.gitUserEmail

          // handle pem upload
          if (typeof body.pemBase64 === 'string' && body.pemBase64.trim() !== '') {
            let pemText
            try {
              pemText = Buffer.from(body.pemBase64, 'base64').toString('utf8')
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
            patch.keyFileName = typeof body.pemFileName === 'string' && body.pemFileName.trim() !== ''
              ? body.pemFileName.trim()
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
          const auth = await getAuthStatus()
          ok(res, { auth, status: await statusPayload() })
          break
        }
        default:
          fail(res, 400, `Unknown action: ${action}`)
      }
    } catch (error) {
      fail(res, 500, error && error.message ? error.message : 'Internal error')
    }
  }
}