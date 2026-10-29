/**
 * Passphrase rules shared by the browser settings UI and the host.
 */

import { MAX_PASSPHRASE_CHARS, MIN_PASSPHRASE_CHARS } from './constants'

/**
 * Validate a passphrase supplied by the browser.
 *
 * @param value raw value from the request.
 * @returns an error message, or null when the passphrase is usable.
 */
export function passphraseError (value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return 'Passphrase is required.'
  if (value.length < MIN_PASSPHRASE_CHARS) return `Passphrase must be at least ${MIN_PASSPHRASE_CHARS} characters.`
  if (value.length > MAX_PASSPHRASE_CHARS) return `Passphrase must be at most ${MAX_PASSPHRASE_CHARS} characters.`

  return null
}
