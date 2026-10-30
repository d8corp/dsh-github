/** Same-origin browser API prefix (host route). */
export const API_PREFIX = '/github/api'

/** Maximum request body size for the browser API (bytes). */
export const MAX_BODY_BYTES = 1024 * 1024

/** This package's name as the profile manifest declares it. */
export const PACKAGE_NAME = 'dsh-github-app'

/** Plugin data directory name under the DSH home. */
export const PLUGIN_DIR_NAME = 'dsh-github-app'

/** Settings file name inside the plugin directory. */
export const SETTINGS_FILENAME = 'github.json'

/** Private key file name inside the plugin directory (legacy, unencrypted). */
export const KEY_FILENAME = 'github-app.pem'

/** Encrypted private key file name inside the plugin directory. */
export const KEY_ENCRYPTED_FILENAME = 'github-app.pem.enc'

/** Default hostname for GitHub. */
export const DEFAULT_HOSTNAME = 'github.com'

/** GitHub App installation access tokens are issued for one hour. */
export const TOKEN_TTL_SECONDS = 3600

/** Minimum length of the passphrase that encrypts the private key. */
export const MIN_PASSPHRASE_CHARS = 8

/** Maximum accepted passphrase length (guards scrypt input size). */
export const MAX_PASSPHRASE_CHARS = 1024
