// src/constants.ts
/** Same-origin browser API prefix (host route). */
const API_PREFIX = "/github/api";
/** Maximum request body size for the browser API (bytes). */
const MAX_BODY_BYTES = 1048576;
/** This package's name as the profile manifest declares it. */
const PACKAGE_NAME = "@d8corp/dsh-github";
/** Plugin data directory name under the DSH home. */
const PLUGIN_DIR_NAME = "dsh-github";
/** Settings file name inside the plugin directory. */
const SETTINGS_FILENAME = "github.json";
/** Private key file name inside the plugin directory (legacy, unencrypted). */
const KEY_FILENAME = "github-app.pem";
/** Encrypted private key file name inside the plugin directory. */
const KEY_ENCRYPTED_FILENAME = "github-app.pem.enc";
/** Default hostname for GitHub. */
const DEFAULT_HOSTNAME = "github.com";
/** GitHub App installation access tokens are issued for one hour. */
const TOKEN_TTL_SECONDS = 3600;
/** Maximum accepted passphrase length (guards scrypt input size). */
const MAX_PASSPHRASE_CHARS = 1024;
export { API_PREFIX, DEFAULT_HOSTNAME, KEY_ENCRYPTED_FILENAME, KEY_FILENAME, MAX_BODY_BYTES, MAX_PASSPHRASE_CHARS, PACKAGE_NAME, PLUGIN_DIR_NAME, SETTINGS_FILENAME, TOKEN_TTL_SECONDS };
