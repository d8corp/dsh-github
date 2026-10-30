import { MAX_PASSPHRASE_CHARS } from "./constants.mjs";
// src/passphrase.ts
/**
* Passphrase rules shared by the browser settings UI and the host.
*/
/**
* Validate a passphrase supplied by the browser.
*
* @param value raw value from the request.
* @returns an error message, or null when the passphrase is usable.
*/
function passphraseError(value) {
	if (typeof value !== "string" || value.trim() === "") return "Passphrase is required.";
	if (value.length < 8) return `Passphrase must be at least 8 characters.`;
	if (value.length > 1024) return `Passphrase must be at most ${MAX_PASSPHRASE_CHARS} characters.`;
	return null;
}
export { passphraseError };
