/**
 * Passphrase rules shared by the browser settings UI and the host.
 */
/**
 * Validate a passphrase supplied by the browser.
 *
 * @param value raw value from the request.
 * @returns an error message, or null when the passphrase is usable.
 */
export declare function passphraseError(value: unknown): string | null;
