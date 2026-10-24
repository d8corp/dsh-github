// src/constants.ts
/** Same-origin browser API prefix (host route). */
const API_PREFIX = "/github/api";
/** Maximum request body size for the browser API (bytes). */
const MAX_BODY_BYTES = 1048576;
/** Private key file name under the DSH home. */
const KEY_FILENAME = "github-app.pem";
/** Default hostname for GitHub. */
const DEFAULT_HOSTNAME = "github.com";
export { API_PREFIX, DEFAULT_HOSTNAME, KEY_FILENAME, MAX_BODY_BYTES };
