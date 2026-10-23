/**
 * Host-side settings for dsh-github.
 *
 * Stored at `$DSH_HOME/github.json` (or `~/.dsh/github.json`). The private key
 * is never stored here — only its path on the host (the key lives in a
 * separate 0600 file).
 */

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
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

const MAX_ID_CHARS = 64
const MAX_GIT_NAME_CHARS = 128
const MAX_GIT_EMAIL_CHARS = 255
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

export function settingsPath (env = process.env) {
  const home = env && typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'github.json')
}

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeId (value) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(Math.trunc(value))
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '' || CONTROL_CHARS.test(trimmed)) return ''
  return trimmed.slice(0, MAX_ID_CHARS)
}

function normalizePath (value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || CONTROL_CHARS.test(trimmed)) return null
  return trimmed
}

export function normalizeSettings (value) {
  const source = isPlainObject(value) ? value : {}
  return {
    appId: normalizeId(source.appId),
    installationId: normalizeId(source.installationId),
    gitUserName: typeof source.gitUserName === 'string' ? source.gitUserName.trim().slice(0, MAX_GIT_NAME_CHARS) : '',
    gitUserEmail: typeof source.gitUserEmail === 'string' ? source.gitUserEmail.trim().slice(0, MAX_GIT_EMAIL_CHARS) : '',
    keyPath: normalizePath(source.keyPath),
    keyFileName: typeof source.keyFileName === 'string' && source.keyFileName.trim() !== ''
      ? source.keyFileName.trim().slice(0, 255)
      : null
  }
}

export function mergeSettings (current, patch) {
  const base = normalizeSettings(current)
  if (!isPlainObject(patch)) return base
  const next = { ...base }
  if (Object.prototype.hasOwnProperty.call(patch, 'appId')) next.appId = patch.appId
  if (Object.prototype.hasOwnProperty.call(patch, 'installationId')) next.installationId = patch.installationId
  if (Object.prototype.hasOwnProperty.call(patch, 'gitUserName')) next.gitUserName = patch.gitUserName
  if (Object.prototype.hasOwnProperty.call(patch, 'gitUserEmail')) next.gitUserEmail = patch.gitUserEmail
  if (Object.prototype.hasOwnProperty.call(patch, 'keyPath')) next.keyPath = patch.keyPath
  if (Object.prototype.hasOwnProperty.call(patch, 'keyFileName')) next.keyFileName = patch.keyFileName
  return normalizeSettings(next)
}

export function readSettings (file = settingsPath()) {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return normalizeSettings({})
  }
}

export function writeSettings (settings, file = settingsPath()) {
  const normalized = normalizeSettings(settings)
  const directory = dirname(file)
  mkdirSync(directory, { recursive: true })

  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const payload = `${JSON.stringify(normalized, null, 2)}\n`

  let handle
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

export function keyFileExists (settings) {
  const s = normalizeSettings(settings)
  return !!s.keyPath && existsSync(s.keyPath)
}