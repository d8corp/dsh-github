/**
 * Private-file helpers for the GitHub App key.
 *
 * Deletions are restricted to the harness home so a tampered settings file
 * cannot turn `clearConfig` into arbitrary file removal.
 */

import { existsSync, realpathSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import { dshHomeDir } from './settings'

/** Real path when it exists, otherwise a lexically resolved absolute path. */
function realOrResolved (path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
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

  const home = realOrResolved(dshHomeDir())
  const parent = realOrResolved(dirname(resolve(file)))
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
