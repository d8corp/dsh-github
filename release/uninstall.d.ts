/**
 * Removes plugin-owned artifacts after the bundle is uninstalled.
 *
 * DSH has no uninstall lifecycle: removing a bundle disposes the plugin fiber
 * exactly like disabling it, an HMR reload, or a host restart. Disposal alone
 * therefore proves nothing. The watcher keeps reading the profile manifest
 * after disposal and deletes plugin data only after the package has stayed
 * absent from both `dependencies` and `dsh.profile.bundles` for a quiet
 * period. Until the package is gone, the manifest still declares it, so a
 * disable, reload, or restart leaves the data alone.
 *
 * The watcher lives in the host process, so this covers removals performed
 * while a DSH host is running. Removing the package with no host running
 * (`dsh plugin remove`) leaves the data directory for manual cleanup.
 */
/**
 * Whether a profile manifest still claims this package.
 *
 * @param profileDir profile root holding `package.json`.
 * @param packageName bundle package name.
 * @returns true when declared, false when absent, null when the manifest
 * cannot be read — callers must treat null as "still installed".
 */
export declare function profileDeclaresPackage(profileDir: string, packageName?: string): boolean | null;
/**
 * Delete the plugin data directory. Paths are derived from `DSH_HOME`, never
 * from user input.
 *
 * @param env environment to read `DSH_HOME` from.
 * @returns true when the directory was removed.
 */
export declare function removePluginArtifacts(env?: NodeJS.ProcessEnv): boolean;
export interface UninstallCleanupOptions {
    /** Profile root captured while the plugin was mounted. */
    profileDir: string;
    packageName?: string;
    env?: NodeJS.ProcessEnv;
    /** Manifest re-read interval; tests shorten this. */
    intervalMs?: number;
    /** Consecutive absent readings required before cleanup. */
    confirmations?: number;
    /** Upper bound on the watcher's lifetime. */
    timeoutMs?: number;
}
/**
 * Watch the profile for this package's removal and delete plugin artifacts.
 *
 * @param options profile location and timing knobs.
 * @returns a function that stops the watcher before it acts.
 */
export declare function watchForUninstallCleanup(options: UninstallCleanupOptions): () => void;
/**
 * Cancel watchers started by this module instance, for example when the
 * plugin mounts again after an HMR reload or a reinstall.
 */
export declare function cancelUninstallCleanup(): void;
