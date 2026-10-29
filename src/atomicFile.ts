/**
 * Atomic private-file writes shared by settings and key storage.
 *
 * Files are written to a sibling temp file, fsynced, renamed into place and
 * tightened to 0600, so a crash never leaves a half-written secret and an
 * existing destination cannot keep looser permissions.
 */

import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

/**
 * Write a secret file atomically with mode 0600.
 *
 * @param file destination path.
 * @param content file contents.
 */
export function writeSecretFile (file: string, content: string): void {
  const directory = dirname(file)
  mkdirSync(directory, { recursive: true, mode: 0o700 })

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
