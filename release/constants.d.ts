/** Same-origin browser API prefix (host route). */
export declare const API_PREFIX = "/github/api";
/** Maximum request body size for the browser API (bytes). */
export declare const MAX_BODY_BYTES: number;
/** This package's name as the profile manifest declares it. */
export declare const PACKAGE_NAME = "dsh-github-app";
/** Plugin data directory name under the DSH home. */
export declare const PLUGIN_DIR_NAME = "dsh-github-app";
/** Settings file name inside the plugin directory. */
export declare const SETTINGS_FILENAME = "github.json";
/** Encrypted private key file name inside the plugin directory. */
export declare const KEY_ENCRYPTED_FILENAME = "github-app.pem.enc";
/** Default hostname for GitHub. */
export declare const DEFAULT_HOSTNAME = "github.com";
/** GitHub App installation access tokens are issued for one hour. */
export declare const TOKEN_TTL_SECONDS = 3600;
/** Minimum length of the passphrase that encrypts the private key. */
export declare const MIN_PASSPHRASE_CHARS = 8;
/** Maximum accepted passphrase length (guards scrypt input size). */
export declare const MAX_PASSPHRASE_CHARS = 1024;
