/**
 * Host-side settings for dsh-github-app.
 *
 * Stored at `$DSH_HOME/dsh-github-app/github.json` (or `~/.dsh/dsh-github-app/github.json`).
 * The private key is never stored here — only its path on the host. The key
 * itself lives in a separate 0600 file encrypted with a passphrase that is
 * never persisted.
 */
export interface GithubSettings {
    appId: string;
    installationId: string;
    gitUserName: string;
    gitUserEmail: string;
    keyPath: string | null;
    keyFileName: string | null;
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
 * @returns `$DSH_HOME/dsh-github-app`.
 */
export declare function pluginDir(env?: NodeJS.ProcessEnv): string;
export declare function settingsPath(env?: NodeJS.ProcessEnv): string;
/** Fixed location of the encrypted private key envelope. */
export declare function encryptedKeyPath(env?: NodeJS.ProcessEnv): string;
export declare function normalizeSettings(value: unknown): GithubSettings;
export declare function readSettings(file?: string): GithubSettings;
export declare function writeSettings(settings: unknown, file?: string): GithubSettings;
export declare function keyFileExists(settings: unknown): boolean;
