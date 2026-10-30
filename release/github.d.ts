import type { GitIdentity, ToolStatus } from './contracts';
import type { GithubSettings } from './settings';
export interface RunOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    /** Variables to drop from the inherited environment before spawning. */
    unset?: string[];
    timeout?: number;
    input?: string;
}
export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
    error: Error | null;
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
    auth?: AuthStatus;
}
export declare function getGhInfo(): Promise<ToolStatus>;
export declare function getGitInfo(): Promise<ToolStatus>;
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
/** Tool the settings section can install automatically. */
export type InstallableTool = 'gh' | 'git';
/**
 * One supported package manager and the commands that install a tool with it.
 *
 * `install` is a prefix: the resolved package name is appended as the last
 * argument, so managers that put the name after flags (`winget --id`) can use
 * the same shape.
 */
export interface PackageManager {
    /** Executable to spawn. */
    command: string;
    /** Arguments that exit 0 when the manager is usable. */
    probe: string[];
    /** Arguments that refresh the package index, or null when not needed. */
    update: string[] | null;
    /** Arguments to install a package (package name appended). */
    install: string[];
    /** Package name when it differs from the tool name. */
    packageName?: Partial<Record<InstallableTool, string>>;
}
/**
 * Package managers available for a platform, in probe order.
 *
 * @param platform target platform; defaults to the host.
 * @returns the manager list, empty when the platform has no installer.
 */
export declare function packageManagers(platform?: NodeJS.Platform): PackageManager[];
/**
 * Commands needed to install one tool with a known package manager.
 *
 * @param manager manager to use.
 * @param tool tool to install.
 * @returns ordered commands; an install failure aborts the sequence.
 */
export declare function installCommands(manager: PackageManager, tool: InstallableTool): Array<{
    command: string;
    args: string[];
}>;
export declare function installGit(): Promise<InstallResult>;
export declare function installGh(): Promise<InstallGhResult>;
/**
 * Exchange the GitHub App private key for an installation token.
 *
 * The key file is encrypted at rest, so the passphrase is required on every
 * call: the decrypted PEM lives only for the duration of this operation and is
 * never cached in the server process.
 *
 * @param settings persisted App ID, installation ID and key location.
 * @param passphrase passphrase protecting the key file.
 * @returns the connection outcome and refreshed auth status.
 */
export declare function connect(settings?: Partial<GithubSettings> | null, passphrase?: unknown): Promise<ConnectResult>;
export interface DisconnectResult {
    ok: boolean;
    error?: string;
}
export declare function disconnect(): Promise<DisconnectResult>;
export declare function getGitIdentity(): Promise<GitIdentity>;
export declare function setGitIdentity(name: unknown, email: unknown): Promise<GitIdentity>;
