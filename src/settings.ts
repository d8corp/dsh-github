/**
 * Host-side settings for @d8corp/dsh-github.
 *
 * Stored at `$DSH_HOME/github.json` (or `~/.dsh/github.json`). The private key
 * is never stored here — only its path on the host (the key lives in a
 * separate 0600 file).
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

export interface GithubSettings {
  appId: string
  installationId: string
  gitUserName: string
  gitUserEmail: string
  keyPath: string | null
  keyFileName: string | null
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

export function settingsPath (env: NodeJS.ProcessEnv = process.env): string {
  return join(dshHomeDir(env), 'github.json')
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

  return normalizeSettings(next)
}

export function readSettings (file = settingsPath()): GithubSettings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return normalizeSettings({})
  }
}

export function writeSettings (settings: unknown, file = settingsPath()): GithubSettings {
  const normalized = normalizeSettings(settings)
  const directory = dirname(file)
  mkdirSync(directory, { recursive: true })

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

export function keyFileExists (settings: unknown): boolean {
  const s = normalizeSettings(settings)

  return !!s.keyPath && existsSync(s.keyPath)
}
