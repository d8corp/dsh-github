/**
 * Host-side settings for @d8corp/dsh-github.
 *
 * Stored at `$DSH_HOME/dsh-github/github.json` (or `~/.dsh/dsh-github/github.json`).
 * The private key is never stored here — only its path on the host. The key
 * itself lives in a separate 0600 file encrypted with a passphrase that is
 * never persisted.
 *
 * Files written by older releases directly under the DSH home are moved into
 * the plugin directory once by `migrateLegacyLayout()`.
 */

import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { KEY_ENCRYPTED_FILENAME, KEY_FILENAME, PLUGIN_DIR_NAME, SETTINGS_FILENAME } from './constants'

export interface GithubSettings {
  appId: string
  installationId: string
  gitUserName: string
  gitUserEmail: string
  keyPath: string | null
  keyFileName: string | null
  keyEncrypted: boolean
  tokenIssuedAt: string | null
  tokenExpiresAt: string | null
}

const MAX_ID_CHARS = 64
const MAX_GIT_NAME_CHARS = 128
const MAX_GIT_EMAIL_CHARS = 255

/**
 * Expand a leading `~` to the current user's home directory. `~user/...` is
 * deliberately left alone, matching the harness home-path helper.
 *
 * @param value configured path.
 * @returns the path with `~` (or `~/`) expanded.
 */
function expandHome (value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))

  return value
}

/**
 * Resolve the DeepSeek Harness home: `$DSH_HOME` when set, otherwise `~/.dsh`.
 *
 * The configured value is `~`-expanded and resolved to an absolute path, so
 * `DSH_HOME=~/harness` means `$HOME/harness` — never a literal `./~` directory
 * relative to the server's working directory.
 *
 * Kept local on purpose — the host half must load with no runtime dependency
 * beyond Node built-ins, so no `@deepseek-ai/*` helper package is imported here.
 *
 * @returns the absolute harness home directory.
 */
export function dshHomeDir (env: NodeJS.ProcessEnv = process.env): string {
  const configured = env && typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''

  return resolve(configured === '' ? join(homedir(), '.dsh') : expandHome(configured))
}

/**
 * Plugin-owned data directory under the DSH home.
 *
 * @param env environment to read `DSH_HOME` from.
 * @returns `$DSH_HOME/dsh-github`.
 */
export function pluginDir (env: NodeJS.ProcessEnv = process.env): string {
  return join(dshHomeDir(env), PLUGIN_DIR_NAME)
}

export function settingsPath (env: NodeJS.ProcessEnv = process.env): string {
  return join(pluginDir(env), SETTINGS_FILENAME)
}

/** Pre-directory settings location, still read until the migration moves it. */
export function legacySettingsPath (env: NodeJS.ProcessEnv = process.env): string {
  return join(dshHomeDir(env), SETTINGS_FILENAME)
}

/** Fixed location of the encrypted private key envelope. */
export function encryptedKeyPath (env: NodeJS.ProcessEnv = process.env): string {
  return join(pluginDir(env), KEY_ENCRYPTED_FILENAME)
}

function defaultSettingsFile (env: NodeJS.ProcessEnv = process.env): string {
  const current = settingsPath(env)

  if (existsSync(current)) return current

  const legacy = legacySettingsPath(env)

  return existsSync(legacy) ? legacy : current
}

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeId (value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(Math.trunc(value))
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '') return ''

  return trimmed.slice(0, MAX_ID_CHARS)
}

function normalizePath (value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null

  return trimmed
}

/**
 * Normalize a persisted token timestamp to canonical ISO-8601 UTC.
 *
 * Accepts a parseable date string or a finite, non-negative epoch-millisecond
 * number; anything else — objects, arrays, `"nonsense"`, `NaN`, negative or
 * out-of-range numbers — normalizes to `null` instead of throwing.
 *
 * @param value candidate timestamp read from settings JSON.
 * @returns canonical ISO string, or null when the value is unusable.
 */
function normalizeTimestamp (value: unknown): string | null {
  let ms: number

  if (typeof value === 'number') {
    ms = value
  } else if (typeof value === 'string' && value.trim() !== '') {
    ms = Date.parse(value)
  } else {
    return null
  }

  if (!Number.isFinite(ms) || ms < 0) return null

  try {
    return new Date(ms).toISOString()
  } catch {
    return null
  }
}

export function normalizeSettings (value: unknown): GithubSettings {
  const source: Record<string, unknown> = isPlainObject(value) ? value : {}

  return {
    appId: normalizeId(source.appId),
    installationId: normalizeId(source.installationId),
    gitUserName: typeof source.gitUserName === 'string' ? source.gitUserName.trim().slice(0, MAX_GIT_NAME_CHARS) : '',
    gitUserEmail: typeof source.gitUserEmail === 'string' ? source.gitUserEmail.trim().slice(0, MAX_GIT_EMAIL_CHARS) : '',
    keyPath: normalizePath(source.keyPath),
    keyFileName: typeof source.keyFileName === 'string' && source.keyFileName.trim() !== ''
      ? source.keyFileName.trim().slice(0, 255)
      : null,
    keyEncrypted: source.keyEncrypted === true,
    tokenIssuedAt: normalizeTimestamp(source.tokenIssuedAt),
    tokenExpiresAt: normalizeTimestamp(source.tokenExpiresAt),
  }
}

export function mergeSettings (current: unknown, patch: unknown): GithubSettings {
  const base = normalizeSettings(current)
  if (!isPlainObject(patch)) return base
  const next: Record<string, unknown> = { ...base }
  if (Object.prototype.hasOwnProperty.call(patch, 'appId')) next.appId = patch.appId
  if (Object.prototype.hasOwnProperty.call(patch, 'installationId')) next.installationId = patch.installationId
  if (Object.prototype.hasOwnProperty.call(patch, 'gitUserName')) next.gitUserName = patch.gitUserName
  if (Object.prototype.hasOwnProperty.call(patch, 'gitUserEmail')) next.gitUserEmail = patch.gitUserEmail
  if (Object.prototype.hasOwnProperty.call(patch, 'keyPath')) next.keyPath = patch.keyPath
  if (Object.prototype.hasOwnProperty.call(patch, 'keyFileName')) next.keyFileName = patch.keyFileName
  if (Object.prototype.hasOwnProperty.call(patch, 'keyEncrypted')) next.keyEncrypted = patch.keyEncrypted
  if (Object.prototype.hasOwnProperty.call(patch, 'tokenIssuedAt')) next.tokenIssuedAt = patch.tokenIssuedAt
  if (Object.prototype.hasOwnProperty.call(patch, 'tokenExpiresAt')) next.tokenExpiresAt = patch.tokenExpiresAt

  return normalizeSettings(next)
}

export function readSettings (file = defaultSettingsFile()): GithubSettings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return normalizeSettings({})
  }
}

export function writeSettings (settings: unknown, file = settingsPath()): GithubSettings {
  const normalized = normalizeSettings(settings)
  const directory = dirname(file)
  mkdirSync(directory, { recursive: true, mode: 0o700 })

  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const payload = `${JSON.stringify(normalized, null, 2)}\n`

  let handle: number | undefined

  try {
    handle = openSync(temp, 'w', 0o600)
    writeFileSync(handle, payload, 'utf8')
    fsyncSync(handle)
    closeSync(handle)
    handle = undefined
  } catch (error) {
    if (handle !== undefined) {
      try { closeSync(handle) } catch { /* already closed */ }
    }

    try { unlinkSync(temp) } catch { /* nothing to clean up */ }
    throw error
  }

  try {
    renameSync(temp, file)
  } catch (error) {
    try { unlinkSync(temp) } catch { /* nothing to clean up */ }
    throw error
  }

  try { chmodSync(file, 0o600) } catch { /* non-POSIX filesystem */ }

  return normalized
}

function warn (message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[@d8corp/dsh-github] ${message}`)
}

/**
 * Move the pre-directory layout into `$DSH_HOME/dsh-github/`.
 *
 * Old releases kept `github.json`, `github-app.pem.enc` and the plaintext
 * `github-app.pem` directly under the DSH home. Existing destinations are
 * never overwritten; a failed move leaves the old file in place, and
 * `readSettings()` keeps reading it through the legacy fallback.
 *
 * @param env environment to read `DSH_HOME` from.
 */
export function migrateLegacyLayout (env: NodeJS.ProcessEnv = process.env): void {
  const home = dshHomeDir(env)
  const dir = pluginDir(env)

  const move = (from: string, to: string): void => {
    if (!existsSync(from) || existsSync(to)) return

    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      renameSync(from, to)
    } catch (error) {
      warn(`cannot move ${from} to ${to}: ${error instanceof Error && error.message ? error.message : error}`)
    }
  }

  move(join(home, SETTINGS_FILENAME), join(dir, SETTINGS_FILENAME))
  move(join(home, KEY_ENCRYPTED_FILENAME), join(dir, KEY_ENCRYPTED_FILENAME))
  move(join(home, KEY_FILENAME), join(dir, KEY_FILENAME))

  const settings = readSettings()
  const legacyKeys = [join(home, KEY_ENCRYPTED_FILENAME), join(home, KEY_FILENAME)]
  const index = settings.keyPath === null ? -1 : legacyKeys.indexOf(settings.keyPath)

  if (index === -1) return

  const target = join(dir, index === 0 ? KEY_ENCRYPTED_FILENAME : KEY_FILENAME)

  if (!existsSync(target)) return

  try {
    writeSettings({ ...settings, keyPath: target })
  } catch (error) {
    warn(`cannot repoint keyPath to ${target}: ${error instanceof Error && error.message ? error.message : error}`)
  }
}

export function keyFileExists (settings: unknown): boolean {
  const s = normalizeSettings(settings)

  return !!s.keyPath && existsSync(s.keyPath)
}
