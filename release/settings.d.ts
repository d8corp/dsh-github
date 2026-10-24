/**
 * Host-side settings for @d8corp/dsh-github.
 *
 * Stored at `$DSH_HOME/github.json` (or `~/.dsh/github.json`). The private key
 * is never stored here — only its path on the host (the key lives in a
 * separate 0600 file).
 */
export interface GithubSettings {
    appId: string;
    installationId: string;
    gitUserName: string;
    gitUserEmail: string;
    keyPath: string | null;
    keyFileName: string | null;
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
export declare function settingsPath(env?: NodeJS.ProcessEnv): string;
export declare function normalizeSettings(value: unknown): GithubSettings;
export declare function mergeSettings(current: unknown, patch: unknown): GithubSettings;
export declare function readSettings(file?: string): GithubSettings;
export declare function writeSettings(settings: unknown, file?: string): GithubSettings;
export declare function keyFileExists(settings: unknown): boolean;
