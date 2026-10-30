/**
 * Host-side settings for @d8corp/dsh-github.
 *
 * Stored at `$DSH_HOME/dsh-github/github.json` (or `~/.dsh/dsh-github/github.json`).
 * The private key is never stored here — only its path on the host. The key
 * itself lives in a separate 0600 file encrypted with a passphrase that is
 * never persisted.
 *
 * Files written by older releases directly under the DSH home are moved into
 * the plugin directory once by `migrateLegacyLayout()`.
 */
export interface GithubSettings {
    appId: string;
    installationId: string;
    gitUserName: string;
    gitUserEmail: string;
    keyPath: string | null;
    keyFileName: string | null;
    keyEncrypted: boolean;
    tokenIssuedAt: string | null;
    tokenExpiresAt: string | null;
}
/**
 * Resolve the DeepSeek Harness home: `$DSH_HOME` when set, otherwise `~/.dsh`.
 *
 * The configured value is `~`-expanded and resolved to an absolute path, so
 * `DSH_HOME=~/harness` means `$HOME/harness` — never a literal `./~` directory
 * relative to the server's working directory.
 *
 * Kept local on purpose — the host half must load with no runtime dependency
 * beyond Node built-ins, so no `@deepseek-ai/*` helper package is imported here.
 *
 * @returns the absolute harness home directory.
 */
export declare function dshHomeDir(env?: NodeJS.ProcessEnv): string;
/**
 * Plugin-owned data directory under the DSH home.
 *
 * @param env environment to read `DSH_HOME` from.
 * @returns `$DSH_HOME/dsh-github`.
 */
export declare function pluginDir(env?: NodeJS.ProcessEnv): string;
export declare function settingsPath(env?: NodeJS.ProcessEnv): string;
/** Pre-directory settings location, still read until the migration moves it. */
export declare function legacySettingsPath(env?: NodeJS.ProcessEnv): string;
/** Fixed location of the encrypted private key envelope. */
export declare function encryptedKeyPath(env?: NodeJS.ProcessEnv): string;
export declare function normalizeSettings(value: unknown): GithubSettings;
export declare function readSettings(file?: string): GithubSettings;
export declare function writeSettings(settings: unknown, file?: string): GithubSettings;
/**
 * Move the pre-directory layout into `$DSH_HOME/dsh-github/`.
 *
 * Old releases kept `github.json`, `github-app.pem.enc` and the plaintext
 * `github-app.pem` directly under the DSH home. Existing destinations are
 * never overwritten; a failed move leaves the old file in place, and
 * `readSettings()` keeps reading it through the legacy fallback.
 *
 * @param env environment to read `DSH_HOME` from.
 */
export declare function migrateLegacyLayout(env?: NodeJS.ProcessEnv): void;
export declare function keyFileExists(settings: unknown): boolean;
