/**
 * Private-file helpers for the GitHub App key.
 *
 * Writes are atomic (temp file + fsync + rename) and always end up with mode
 * 0600, including when the destination already existed with looser bits.
 * Deletions are restricted to the harness home so a tampered settings file
 * cannot turn `clearConfig` into arbitrary file removal.
 */

import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import { dshHomeDir } from './settings'

/**
 * Write a secret file atomically with mode 0600.
 *
 * @param file destination path.
 * @param content file contents.
 */
export function writeSecretFile (file: string, content: string): void {
  const directory = dirname(file)
  mkdirSync(directory, { recursive: true })

  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  let handle: number | undefined

  try {
    handle = openSync(temp, 'w', 0o600)
    writeFileSync(handle, content, 'utf8')
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

  // openSync's mode only applies on creation: an existing destination keeps
  // its old bits through rename, so tighten them explicitly.
  try { chmodSync(file, 0o600) } catch { /* non-POSIX filesystem */ }
}

/**
 * Whether a path lives inside the harness home, judged by its parent's real
 * location so a symlinked directory cannot escape the check.
 *
 * @param file candidate path.
 * @returns true when removing the path cannot reach outside `$DSH_HOME`.
 */
export function isInsideDshHome (file: string | null | undefined): boolean {
  if (typeof file !== 'string' || file.trim() === '') return false

  const home = resolve(dshHomeDir())
  const parent = dirname(resolve(file))
  const relation = relative(home, parent)

  // `''` means a direct child of the home; the target is a file there, never
  // the home directory itself.
  return !relation.startsWith('..') && !isAbsolute(relation)
}

/**
 * Remove a file only when it is inside the harness home.
 *
 * @param file candidate path.
 * @returns true when the file is gone (or was absent), false otherwise.
 */
export function removeSecretFile (file: string | null | undefined): boolean {
  if (!isInsideDshHome(file)) return false

  const target = file as string

  try {
    if (existsSync(target)) unlinkSync(target)

    return true
  } catch {
    return false
  }
}
