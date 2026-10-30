import { spawn } from 'node:child_process'
import { createPrivateKey, createSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { DEFAULT_HOSTNAME, TOKEN_TTL_SECONDS } from './constants'
import type { GitIdentity, ToolStatus } from './contracts'
import { decryptPrivateKey } from './keyCrypto'
import { passphraseError } from './passphrase'
import type { GithubSettings } from './settings'
import { readSettings, writeSettings } from './settings'
import { parseTimestamp } from './time'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Variables to drop from the inherited environment before spawning. */
  unset?: string[]
  timeout?: number
  input?: string
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  error: Error | null
}

export interface InstallResult {
  ok: boolean
  version?: string | null
  skipped?: boolean
  error?: string
}

export interface InstallGhResult extends InstallResult {
  gh: InstallResult
  git: InstallResult
}

export interface AuthStatus {
  loggedIn: boolean
  gitConfigured: boolean
  hostname: string
  output?: string
  error?: string
}

export interface ConnectResult {
  ok: boolean
  error?: string
  auth?: AuthStatus
}

type TokenResult =
  | { ok: true, token: string, expiresAt: number | null }
  | { ok: false, error: string }

function run (command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    // Always copy: `unset` must never mutate the host environment.
    const env: NodeJS.ProcessEnv = { ...process.env, ...(options.env || {}) }
    for (const key of options.unset || []) delete env[key]

    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })

    let settled = false
    let timedOut = false
    let timer: NodeJS.Timeout | null = null

    const finish = (code: number | null, error: Error | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)

      resolve({
        code: typeof code === 'number' ? code : (error ? 1 : 0),
        stdout,
        stderr,
        error: error || (timedOut ? new Error('Command timed out') : (code !== 0 ? new Error(stderr || stdout || 'Command failed') : null)),
      })
    }

    if (options.timeout && options.timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true
        try { child.kill('SIGTERM') } catch { /* ignore */ }
        setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } }, 5000)
      }, options.timeout)
    }

    child.on('error', (error) => finish(1, error))
    child.on('close', (code) => finish(code, null))

    // A child that exits before reading stdin (for example `gh auth logout`
    // when no account is signed in) closes the pipe under us; without this
    // handler the resulting EPIPE surfaces as an unhandled stream error and
    // takes the host process down.
    child.stdin.on('error', () => { /* ignore */ })

    try {
      if (options.input != null) child.stdin.write(options.input)
      child.stdin.end()
    } catch { /* ignore */ }
  })
}

/**
 * Environment variables `gh` accepts as a token source.
 *
 * When any of them is set, `gh auth login` and `gh auth logout` refuse to
 * touch gh's own credential store ("…first clear the value from the
 * environment"), and `gh auth status` reports the environment token instead
 * of the stored credentials. The plugin exports the installation token into
 * its own process environment for the agent, so every auth-management command
 * has to run without them — otherwise the second Connect in one server
 * lifetime always fails, and Disconnect never removes the stored credentials.
 */
const GH_TOKEN_ENV_KEYS = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
]

/**
 * Run a `gh auth` subcommand with the token environment removed, so it reads
 * and writes gh's credential store rather than the ambient token.
 *
 * @param args `gh` arguments, starting after the binary name.
 * @param options spawn options; `unset` entries are added, never replaced.
 * @returns the command result.
 */
function runGhAuth (args: string[], options: RunOptions = {}): Promise<RunResult> {
  return run('gh', args, {
    ...options,
    unset: [...(options.unset || []), ...GH_TOKEN_ENV_KEYS],
  })
}

async function getToolInfo (command: 'gh' | 'git'): Promise<ToolStatus> {
  const result = await run(command, ['--version'])

  if (result.code !== 0) return { installed: false, version: null }

  const pattern = new RegExp(`${command} version (\\S+)`)
  const match = result.stdout.match(pattern) || result.stderr.match(pattern)

  return { installed: true, version: match ? match[1] : result.stdout.trim() || result.stderr.trim() }
}

export function getGhInfo (): Promise<ToolStatus> {
  return getToolInfo('gh')
}

export function getGitInfo (): Promise<ToolStatus> {
  return getToolInfo('git')
}

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
function classifyAuthLine (line: string): 'failed' | 'ok' | null {
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
export function isLoggedInOutput (output: unknown): boolean {
  let pendingStatus: 'ok' | 'failed' | null = null
  let activeStatus: 'ok' | 'failed' | null = null
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

export async function getAuthStatus (hostname = DEFAULT_HOSTNAME): Promise<AuthStatus> {
  const result = await runGhAuth(['auth', 'status', '--hostname', hostname])
  const output = `${result.stdout}\n${result.stderr}`.trim()

  // `gh auth status` exits 1 when *any* account on the host has issues, even
  // an inactive one, so the exit code says nothing about the active account.
  // The parsed output does, and it also covers the plain "not logged in" case.
  const loggedIn = isLoggedInOutput(output)

  // git credential helper configured by `gh auth setup-git`
  const gitCfg = await run('git', ['config', '--global', '--get', `credential.https://${hostname}.helper`])
  const gitConfigured = gitCfg.code === 0 && /gh auth git-credential|gh/.test(gitCfg.stdout)

  return {
    loggedIn,
    gitConfigured,
    hostname,
    output: loggedIn ? output : undefined,
    error: loggedIn ? undefined : (output || 'gh auth status failed'),
  }
}

/** Tool the settings section can install automatically. */
export type InstallableTool = 'gh' | 'git'

/**
 * One supported package manager and the commands that install a tool with it.
 *
 * `install` is a prefix: the resolved package name is appended as the last
 * argument, so managers that put the name after flags (`winget --id`) can use
 * the same shape.
 */
export interface PackageManager {
  /** Executable to spawn. */
  command: string
  /** Arguments that exit 0 when the manager is usable. */
  probe: string[]
  /** Arguments that refresh the package index, or null when not needed. */
  update: string[] | null
  /** Arguments to install a package (package name appended). */
  install: string[]
  /** Package name when it differs from the tool name. */
  packageName?: Partial<Record<InstallableTool, string>>
}

/**
 * Package managers tried in order, per platform.
 *
 * `winget` is preferred on Windows and Chocolatey is the fallback; on Linux the
 * order covers Debian/Ubuntu, Fedora/RHEL, Arch and Alpine/openSUSE.
 */
const PACKAGE_MANAGERS: Partial<Record<NodeJS.Platform, PackageManager[]>> = {
  darwin: [
    { command: 'brew', probe: ['--version'], update: null, install: ['install'] },
  ],
  win32: [
    {
      command: 'winget',
      probe: ['--version'],
      update: null,
      install: [
        'install',
        '--source', 'winget',
        '--accept-source-agreements',
        '--accept-package-agreements',
        '--silent',
        '--id',
      ],
      packageName: { gh: 'GitHub.cli', git: 'Git.Git' },
    },
    { command: 'choco', probe: ['--version'], update: null, install: ['install', '-y'] },
  ],
  linux: [
    {
      command: 'apt-get',
      probe: ['--version'],
      update: ['update'],
      install: ['install', '-y'],
    },
    { command: 'dnf', probe: ['--version'], update: null, install: ['install', '-y'] },
    { command: 'yum', probe: ['--version'], update: null, install: ['install', '-y'] },
    { command: 'pacman', probe: ['--version'], update: null, install: ['-S', '--noconfirm'], packageName: { gh: 'github-cli' } },
    { command: 'zypper', probe: ['--version'], update: null, install: ['--non-interactive', 'install'] },
    { command: 'apk', probe: ['--version'], update: null, install: ['add', '--no-cache'], packageName: { gh: 'github-cli' } },
  ],
}

/**
 * Package managers available for a platform, in probe order.
 *
 * @param platform target platform; defaults to the host.
 * @returns the manager list, empty when the platform has no installer.
 */
export function packageManagers (platform: NodeJS.Platform = process.platform): PackageManager[] {
  return PACKAGE_MANAGERS[platform] ?? []
}

/**
 * Commands needed to install one tool with a known package manager.
 *
 * @param manager manager to use.
 * @param tool tool to install.
 * @returns ordered commands; an install failure aborts the sequence.
 */
export function installCommands (manager: PackageManager, tool: InstallableTool): Array<{ command: string, args: string[] }> {
  const steps: Array<{ command: string, args: string[] }> = []

  if (manager.update !== null) steps.push({ command: manager.command, args: manager.update })

  steps.push({
    command: manager.command,
    args: [...manager.install, manager.packageName?.[tool] ?? tool],
  })

  return steps
}

/**
 * Probe the platform's managers in order and return the first usable one.
 *
 * @param platform target platform.
 * @returns the manager, or null when none answers.
 */
async function findPackageManager (platform: NodeJS.Platform = process.platform): Promise<PackageManager | null> {
  for (const manager of packageManagers(platform)) {
    const probe = await run(manager.command, manager.probe, { timeout: 15000 })

    if (probe.code === 0) return manager
  }

  return null
}

/**
 * Human-readable fallback hint for a platform without an automatic installer.
 *
 * @param tool tool the user wanted to install.
 * @returns a short instruction.
 */
function installHint (tool: InstallableTool): string {
  if (process.platform === 'darwin') {
    return `Install Homebrew (https://brew.sh) and retry, or download ${tool} from https://cli.github.com`
  }

  if (process.platform === 'win32') {
    return `Install winget or Chocolatey and retry, or download ${tool} from https://cli.github.com`
  }

  return `Install a supported package manager (apt, dnf, yum, pacman, zypper or apk), or see https://github.com/cli/cli#installation for ${tool}`
}

/**
 * Install one missing tool with the first available platform manager.
 *
 * @param tool `gh` or `git`.
 * @returns the install outcome; `skipped` when the tool was already present.
 */
async function installTool (tool: InstallableTool): Promise<InstallResult> {
  const before = tool === 'gh' ? await getGhInfo() : await getGitInfo()

  if (before.installed) return { ok: true, version: before.version, skipped: true }

  const managers = packageManagers()
  const manager = await findPackageManager()

  if (manager === null) {
    return {
      ok: false,
      error: managers.length === 0
        ? `Automatic install is not supported on ${process.platform}. ${installHint(tool)}`
        : `No supported package manager found. ${installHint(tool)}`,
    }
  }

  for (const step of installCommands(manager, tool)) {
    const result = await run(step.command, step.args, { timeout: 300000 })

    if (result.code !== 0) {
      const output = (result.stderr || result.stdout || `${step.command} ${step.args.join(' ')} failed`).trim()

      // Debian/Ubuntu keep gh out of the default repositories, so a plain
      // "unable to locate package" deserves the official instruction.
      const hint = manager.command === 'apt-get' && tool === 'gh' && /unable to locate|has no installation candidate/i.test(output)
        ? 'On Debian/Ubuntu, gh needs the GitHub CLI repository: https://github.com/cli/cli/blob/trunk/docs/install_linux.md'
        : installHint(tool)

      return { ok: false, error: `${output}\n${hint}` }
    }
  }

  const after = tool === 'gh' ? await getGhInfo() : await getGitInfo()

  return {
    ok: after.installed,
    version: after.version,
    error: after.installed ? undefined : `${tool} still not found after install`,
  }
}

export async function installGit (): Promise<InstallResult> {
  return installTool('git')
}

export async function installGh (): Promise<InstallGhResult> {
  const ghResult = await installTool('gh')
  const gitResult = await installTool('git')
  const ok = ghResult.ok && gitResult.ok

  return {
    ok,
    version: ghResult.version,
    gh: ghResult,
    git: gitResult,
    error: ok ? undefined : (ghResult.error || gitResult.error),
  }
}

function base64UrlEncode (value: Buffer | string): string {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')

  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function createAppJwt (appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 60, exp: now + (10 * 60), iss: String(appId) }
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`

  let key

  try {
    key = createPrivateKey(privateKeyPem)
  } catch (error) {
    throw new Error(`Invalid private key: ${error instanceof Error && error.message ? error.message : error}`)
  }

  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const signature = signer.sign(key)

  return `${signingInput}.${base64UrlEncode(signature)}`
}

function apiBaseFor (hostname: string): string {
  return hostname === 'github.com' ? 'https://api.github.com' : `https://${hostname}/api/v3`
}

async function fetchInstallationToken (jwt: string, installationId: string, hostname: string): Promise<TokenResult> {
  const url = `${apiBaseFor(hostname)}/app/installations/${encodeURIComponent(String(installationId))}/access_tokens`
  let response: Response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
  } catch (error) {
    return { ok: false, error: `Network error: ${error instanceof Error && error.message ? error.message : error}` }
  }

  const text = await response.text()

  if (!response.ok) {
    return { ok: false, error: `GitHub API ${response.status}: ${text.trim()}` }
  }

  let data: unknown

  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Invalid JSON response from GitHub API' }
  }

  if (data === null || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string' || data.token === '') {
    return { ok: false, error: 'No installation token in GitHub API response' }
  }

  // The API field is documented as a string; anything else is treated as absent.
  const rawExpiresAt = (data as { expires_at?: unknown }).expires_at
  const expiresAt = typeof rawExpiresAt === 'string' ? parseTimestamp(rawExpiresAt) : null

  return { ok: true, token: data.token, expiresAt }
}

/**
 * Exchange the GitHub App private key for an installation token.
 *
 * The key file is encrypted at rest, so the passphrase is required on every
 * call: the decrypted PEM lives only for the duration of this operation and is
 * never cached in the server process.
 *
 * @param settings persisted App ID, installation ID and key location.
 * @param passphrase passphrase protecting the key file.
 * @returns the connection outcome and refreshed auth status.
 */
export async function connect (settings?: Partial<GithubSettings> | null, passphrase?: unknown): Promise<ConnectResult> {
  const s: Partial<GithubSettings> = settings || {}
  const { appId, installationId, keyPath } = s

  if (!appId || !installationId || !keyPath) {
    return { ok: false, error: 'Missing appId, installationId or key file' }
  }

  const invalidPassphrase = passphraseError(passphrase)

  if (invalidPassphrase !== null) return { ok: false, error: invalidPassphrase }

  if (!existsSync(keyPath)) {
    return { ok: false, error: 'Private key file not found' }
  }

  let envelope: string

  try {
    envelope = readFileSync(keyPath, 'utf8')
  } catch (error) {
    return { ok: false, error: `Cannot read private key: ${error instanceof Error && error.message ? error.message : error}` }
  }

  let pem: string

  try {
    pem = await decryptPrivateKey(envelope, passphrase as string)
  } catch {
    return { ok: false, error: 'Cannot decrypt private key: wrong passphrase or corrupted key file.' }
  }

  let jwt: string

  try {
    jwt = createAppJwt(appId, pem)
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.message ? error.message : 'Failed to create JWT' }
  } finally {
    // Drop the plaintext reference as soon as signing is done.
    pem = ''
  }

  const tokenResult = await fetchInstallationToken(jwt, installationId, DEFAULT_HOSTNAME)

  if (!tokenResult.ok) {
    return { ok: false, error: tokenResult.error }
  }

  const token = tokenResult.token

  const login = await runGhAuth([
    'auth', 'login',
    '--hostname', DEFAULT_HOSTNAME,
    '--with-token',
    '--git-protocol', 'https',
  ], { timeout: 120000, input: `${token}\n` })

  if (login.code !== 0) {
    const msg = (login.stderr || login.stdout || 'gh auth login failed').trim()

    return { ok: false, error: msg }
  }

  // `gh auth login` accepted the token, so it is active from this moment on.
  // Record the authoritative API expiry when GitHub sent one, otherwise the
  // documented one-hour lifetime. Persisting the lifetime is best-effort: a
  // settings-write failure must never turn a successful connect into a failure.
  const issuedAt = Date.now()
  const expiresAt = tokenResult.expiresAt ?? issuedAt + TOKEN_TTL_SECONDS * 1000

  try {
    writeSettings({
      ...readSettings(),
      tokenIssuedAt: new Date(issuedAt).toISOString(),
      tokenExpiresAt: new Date(expiresAt).toISOString(),
    })
  } catch { /* lifetime tracking is best-effort */ }

  const setup = await runGhAuth(['auth', 'setup-git'], { timeout: 120000 })

  if (setup.code !== 0) {
    const msg = (setup.stderr || setup.stdout || 'gh auth setup-git failed').trim()

    // `gh auth login` already wrote credentials, so leaving them behind would
    // report a failure while the store says "connected". Undo it instead.
    await rollbackLogin()

    return { ok: false, error: msg }
  }

  process.env.GH_TOKEN = token
  process.env.GITHUB_TOKEN = token

  const auth = await getAuthStatus()

  if (!auth.loggedIn) {
    const msg = auth.error || 'gh auth status did not confirm the login'

    await rollbackLogin()

    return { ok: false, error: msg }
  }

  return { ok: true, auth }
}

/**
 * Undo a login that was written to gh's credential store when a later step of
 * {@link connect} failed, so the reported state matches the store.
 *
 * @returns nothing; failures are best-effort.
 */
async function rollbackLogin (): Promise<void> {
  await runGhAuth(['auth', 'logout', '--hostname', DEFAULT_HOSTNAME], { timeout: 60000, input: 'y\n' })

  delete process.env.GH_TOKEN
  delete process.env.GITHUB_TOKEN

  try {
    writeSettings({ ...readSettings(), tokenIssuedAt: null, tokenExpiresAt: null })
  } catch { /* lifetime tracking is best-effort */ }
}

export interface DisconnectResult {
  ok: boolean
  error?: string
}

export async function disconnect (): Promise<DisconnectResult> {
  const result = await runGhAuth(['auth', 'logout', '--hostname', DEFAULT_HOSTNAME], {
    timeout: 60000,
    input: 'y\n',
  })

  const output = `${result.stdout}\n${result.stderr}`.trim()
  // Leaving gh already logged out is the desired end state, not a failure.
  const loggedOut = result.code === 0 || /not logged in/i.test(output)

  // Never leave the plugin's own token export behind: it shadows gh's store
  // and keeps the agent authenticated with a token the user asked to drop.
  delete process.env.GH_TOKEN
  delete process.env.GITHUB_TOKEN

  try {
    writeSettings({ ...readSettings(), tokenIssuedAt: null, tokenExpiresAt: null })
  } catch { /* lifetime tracking is best-effort */ }

  return loggedOut ? { ok: true } : { ok: false, error: output || 'gh auth logout failed' }
}

export async function getGitIdentity (): Promise<GitIdentity> {
  const nameResult = await run('git', ['config', '--global', '--get', 'user.name'])
  const emailResult = await run('git', ['config', '--global', '--get', 'user.email'])

  return {
    name: nameResult.code === 0 ? nameResult.stdout.trim() : '',
    email: emailResult.code === 0 ? emailResult.stdout.trim() : '',
  }
}

export async function setGitIdentity (name: unknown, email: unknown): Promise<GitIdentity> {
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
