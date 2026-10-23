import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createPrivateKey, createSign } from 'node:crypto'
import { DEFAULT_HOSTNAME } from './constants.js'

function run (command, args, options = {}) {
  return new Promise((resolve) => {
    const env = options.env ? { ...process.env, ...options.env } : process.env
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })

    let settled = false
    let timedOut = false
    const finish = (code, error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        code: typeof code === 'number' ? code : (error ? 1 : 0),
        stdout,
        stderr,
        error: error || (timedOut ? new Error('Command timed out') : (code !== 0 ? new Error(stderr || stdout || 'Command failed') : null))
      })
    }

    const timer = (options.timeout && options.timeout > 0)
      ? setTimeout(() => {
          timedOut = true
          try { child.kill('SIGTERM') } catch { /* ignore */ }
          setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } }, 5000)
        }, options.timeout)
      : null

    child.on('error', (error) => finish(1, error))
    child.on('close', (code) => finish(code, null))

    try {
      if (options.input != null) child.stdin.write(options.input)
      child.stdin.end()
    } catch { /* ignore */ }
  })
}

export async function getGhInfo () {
  const result = await run('gh', ['--version'])
  if (result.code !== 0) return { installed: false, version: null }
  const match = result.stdout.match(/gh version (\S+)/) || result.stderr.match(/gh version (\S+)/)
  return { installed: true, version: match ? match[1] : result.stdout.trim() || result.stderr.trim() }
}

export async function getGitInfo () {
  const result = await run('git', ['--version'])
  if (result.code !== 0) return { installed: false, version: null }
  const match = result.stdout.match(/git version (\S+)/) || result.stderr.match(/git version (\S+)/)
  return { installed: true, version: match ? match[1] : result.stdout.trim() || result.stderr.trim() }
}

export const getGitVersion = getGitInfo
export const getGitCliInfo = getGitInfo
export const getGitCliVersion = getGitInfo
export const getGitInfoVersion = getGitInfo

const AUTH_FAILURE_TEXT = /failed to log in|not logged in(to)?|is invalid|has expired|authentication failed|bad credentials|re-?authenticate/i
const AUTH_SUCCESS_TEXT = /logged in to|logged in as/i
const AUTH_FAILURE_MARKER = /^\s*[✗✘×]\s+/u
const AUTH_FAILURE_MARKER_TEXT = /^\s*X\s+(failed|not logged|invalid|expired|bad credentials)/i
const AUTH_SUCCESS_MARKER = /^\s*[✓✔]\s+.*logged in/iu
const AUTH_ACTIVE_ACCOUNT = /^(?:[-*]\s*)?active account:\s*true$/i

/**
 * Classify a single `gh auth status` line as `'failed'`, `'ok'`, or `null` when
 * the line carries no verdict of its own (host header, `- Token:` metadata...).
 *
 * @param line one line of `gh auth status` output.
 * @returns the verdict carried by that line, if any.
 */
function classifyAuthLine (line) {
  if (AUTH_FAILURE_TEXT.test(line) || AUTH_FAILURE_MARKER.test(line) || AUTH_FAILURE_MARKER_TEXT.test(line)) return 'failed'
  if (AUTH_SUCCESS_TEXT.test(line) || AUTH_SUCCESS_MARKER.test(line)) return 'ok'
  return null
}

/**
 * Decide whether `gh auth status` output describes a usable authentication.
 *
 * `gh` exits 0 as soon as *one* configured account is usable, so judging the
 * merged output as a whole reports a false "disconnected" whenever an unusable
 * entry sits next to a working one. The entry marked `Active account: true` —
 * the credential `gh` and git operations actually use — decides the verdict.
 * Other entries are only consulted when no such marker is present; when the
 * marker is present but its status line is unrecognisable (a future `gh`
 * re-wording), the verdict stays `false` instead of falling back to another
 * account, so an unknown format can never claim "Connected".
 *
 * @param output merged stdout+stderr of `gh auth status`.
 * @returns true when the active (or only) account is authenticated.
 */
export function isLoggedInOutput (output) {
  let pendingStatus = null
  let activeStatus = null
  let activeAccountSeen = false
  let sawOk = false
  let sawFailed = false

  for (const line of String(output).split(/\r?\n/)) {
    const status = classifyAuthLine(line)
    if (status === 'ok') {
      pendingStatus = 'ok'
      sawOk = true
    } else if (status === 'failed') {
      pendingStatus = 'failed'
      sawFailed = true
    }
    if (AUTH_ACTIVE_ACCOUNT.test(line.trim())) {
      activeAccountSeen = true
      activeStatus = pendingStatus
    }
  }

  if (activeAccountSeen) return activeStatus === 'ok'
  if (sawOk) return true
  if (sawFailed) return false
  return false
}

export async function getAuthStatus (hostname = DEFAULT_HOSTNAME) {
  const result = await run('gh', ['auth', 'status', '--hostname', hostname])
  const output = `${result.stdout}\n${result.stderr}`.trim()
  const loggedIn = result.code === 0 && isLoggedInOutput(output)

  // git credential helper configured by `gh auth setup-git`
  const gitCfg = await run('git', ['config', '--global', '--get', `credential.https://${hostname}.helper`])
  const gitConfigured = gitCfg.code === 0 && /gh auth git-credential|gh/.test(gitCfg.stdout)

  return {
    loggedIn,
    gitConfigured,
    hostname,
    output: loggedIn ? output : undefined,
    error: loggedIn ? undefined : (output || 'gh auth status failed')
  }
}

export async function installGit () {
  const info = await getGitInfo()
  if (info.installed) return { ok: true, version: info.version, skipped: true }
  const update = await run('apt-get', ['update'], { timeout: 300000 })
  if (update.code !== 0) {
    return { ok: false, error: (update.stderr || update.stdout || 'apt-get update failed').trim() }
  }
  const install = await run('apt-get', ['install', '-y', 'git'], { timeout: 300000 })
  if (install.code !== 0) {
    return { ok: false, error: (install.stderr || install.stdout || 'apt-get install git failed').trim() }
  }
  const after = await getGitInfo()
  return { ok: after.installed, version: after.version, error: after.installed ? undefined : 'git still not found after install' }
}

export const installGitCli = installGit
export const installGitVersion = installGit
export const installGitTool = installGit

export async function installGh () {
  // Install GitHub CLI if missing.
  const ghBefore = await getGhInfo()
  let ghResult
  if (ghBefore.installed) {
    ghResult = { ok: true, version: ghBefore.version, skipped: true }
  } else {
    const update = await run('apt-get', ['update'], { timeout: 300000 })
    if (update.code !== 0) {
      ghResult = { ok: false, error: (update.stderr || update.stdout || 'apt-get update failed').trim() }
    } else {
      const install = await run('apt-get', ['install', '-y', 'gh'], { timeout: 300000 })
      if (install.code !== 0) {
        ghResult = { ok: false, error: (install.stderr || install.stdout || 'apt-get install gh failed').trim() }
      } else {
        const after = await getGhInfo()
        ghResult = { ok: after.installed, version: after.version, error: after.installed ? undefined : 'gh still not found after install' }
      }
    }
  }

  // Install Git CLI if missing.
  const gitResult = await installGit()

  const ok = ghResult.ok && gitResult.ok
  return {
    ok,
    version: ghResult.version,
    gh: ghResult,
    git: gitResult,
    error: ok ? undefined : (ghResult.error || gitResult.error)
  }
}

// Combined installer (alias).
export const install = installGh
export const installMissing = installGh
export const installCli = installGh
export const installTools = installGh

function base64UrlEncode (value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function createAppJwt (appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 60, exp: now + (10 * 60), iss: String(appId) }
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`

  let key
  try {
    key = createPrivateKey(privateKeyPem)
  } catch (error) {
    throw new Error(`Invalid private key: ${error && error.message ? error.message : error}`)
  }
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const signature = signer.sign(key)
  return `${signingInput}.${base64UrlEncode(signature)}`
}

function apiBaseFor (hostname) {
  return hostname === 'github.com' ? 'https://api.github.com' : `https://${hostname}/api/v3`
}

async function fetchInstallationToken (jwt, installationId, hostname) {
  const url = `${apiBaseFor(hostname)}/app/installations/${encodeURIComponent(String(installationId))}/access_tokens`
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: '{}'
    })
  } catch (error) {
    return { ok: false, error: `Network error: ${error && error.message ? error.message : error}` }
  }
  const text = await response.text()
  if (!response.ok) {
    return { ok: false, error: `GitHub API ${response.status}: ${text.trim()}` }
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Invalid JSON response from GitHub API' }
  }
  if (!data || typeof data.token !== 'string' || data.token === '') {
    return { ok: false, error: 'No installation token in GitHub API response' }
  }
  return { ok: true, token: data.token }
}

export async function connect (settings) {
  const s = settings || {}
  if (!s.appId || !s.installationId || !s.keyPath) {
    return { ok: false, error: 'Missing appId, installationId or key file' }
  }
  if (!existsSync(s.keyPath)) {
    return { ok: false, error: 'Private key file not found' }
  }

  let pem
  try {
    pem = readFileSync(s.keyPath, 'utf8')
  } catch (error) {
    return { ok: false, error: `Cannot read private key: ${error && error.message ? error.message : error}` }
  }

  let jwt
  try {
    jwt = createAppJwt(s.appId, pem)
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : 'Failed to create JWT' }
  }

  const tokenResult = await fetchInstallationToken(jwt, s.installationId, DEFAULT_HOSTNAME)
  if (!tokenResult.ok) {
    return { ok: false, error: tokenResult.error }
  }

  const token = tokenResult.token

  const login = await run('gh', [
    'auth', 'login',
    '--hostname', DEFAULT_HOSTNAME,
    '--with-token',
    '--git-protocol', 'https'
  ], { timeout: 120000, input: `${token}\n` })

  if (login.code !== 0) {
    const msg = (login.stderr || login.stdout || 'gh auth login failed').trim()
    return { ok: false, error: msg }
  }

  const setup = await run('gh', ['auth', 'setup-git'], { timeout: 120000 })
  if (setup.code !== 0) {
    const msg = (setup.stderr || setup.stdout || 'gh auth setup-git failed').trim()
    return { ok: false, error: msg, partial: true }
  }

  process.env.GH_TOKEN = token
  process.env.GITHUB_TOKEN = token

  const auth = await getAuthStatus()
  return { ok: auth.loggedIn, auth, error: auth.loggedIn ? undefined : auth.error }
}

export async function disconnect () {
  await run('gh', ['auth', 'logout', '--hostname', DEFAULT_HOSTNAME], { timeout: 60000, input: 'y\n' })
  delete process.env.GH_TOKEN
  delete process.env.GITHUB_TOKEN
  return { ok: true }
}


export async function getGitIdentity () {
  const nameResult = await run('git', ['config', '--global', '--get', 'user.name'])
  const emailResult = await run('git', ['config', '--global', '--get', 'user.email'])
  return {
    name: nameResult.code === 0 ? nameResult.stdout.trim() : '',
    email: emailResult.code === 0 ? emailResult.stdout.trim() : ''
  }
}

export async function setGitIdentity (name, email) {
  if (typeof name === 'string' && name.trim() !== '') {
    await run('git', ['config', '--global', 'user.name', name.trim()])
  } else {
    await run('git', ['config', '--global', '--unset', 'user.name'])
  }
  if (typeof email === 'string' && email.trim() !== '') {
    await run('git', ['config', '--global', 'user.email', email.trim()])
  } else {
    await run('git', ['config', '--global', '--unset', 'user.email'])
  }
  return getGitIdentity()
}
