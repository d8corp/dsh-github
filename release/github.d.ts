import type { GithubSettings } from './settings';
export interface RunOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    input?: string;
}
export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
    error: Error | null;
}
export interface ToolInfo {
    installed: boolean;
    version: string | null;
}
export interface InstallResult {
    ok: boolean;
    version?: string | null;
    skipped?: boolean;
    error?: string;
}
export interface InstallGhResult extends InstallResult {
    gh: InstallResult;
    git: InstallResult;
}
export interface GitIdentity {
    name: string;
    email: string;
}
export interface AuthStatus {
    loggedIn: boolean;
    gitConfigured: boolean;
    hostname: string;
    output?: string;
    error?: string;
}
export interface ConnectResult {
    ok: boolean;
    error?: string;
    partial?: boolean;
    auth?: AuthStatus;
}
export declare function getGhInfo(): Promise<ToolInfo>;
export declare function getGitInfo(): Promise<ToolInfo>;
export declare const getGitVersion: typeof getGitInfo;
export declare const getGitCliInfo: typeof getGitInfo;
export declare const getGitCliVersion: typeof getGitInfo;
export declare const getGitInfoVersion: typeof getGitInfo;
/**
 * Decide whether `gh auth status` output describes a usable authentication.
 *
 * `gh` exits 0 as soon as *one* configured account is usable, so judging the
 * merged output as a whole reports a false "disconnected" whenever an unusable
 * entry sits next to a working one. The entry marked `Active account: true` —
 * the credential `gh` and git operations actually use — decides the verdict.
 * Other entries are only consulted when no such marker is present; when the
 * marker is present but its status line is unrecognisable (a future `gh`
 * re-wording), the verdict stays `false` instead of falling back to another
 * account, so an unknown format can never claim "Connected".
 *
 * @param output merged stdout+stderr of `gh auth status`.
 * @returns true when the active (or only) account is authenticated.
 */
export declare function isLoggedInOutput(output: unknown): boolean;
export declare function getAuthStatus(hostname?: string): Promise<AuthStatus>;
export declare function installGit(): Promise<InstallResult>;
export declare const installGitCli: typeof installGit;
export declare const installGitVersion: typeof installGit;
export declare const installGitTool: typeof installGit;
export declare function installGh(): Promise<InstallGhResult>;
export declare const install: typeof installGh;
export declare const installMissing: typeof installGh;
export declare const installCli: typeof installGh;
export declare const installTools: typeof installGh;
export declare function connect(settings?: Partial<GithubSettings> | null): Promise<ConnectResult>;
export declare function disconnect(): Promise<{
    ok: true;
}>;
export declare function getGitIdentity(): Promise<GitIdentity>;
export declare function setGitIdentity(name: unknown, email: unknown): Promise<GitIdentity>;
