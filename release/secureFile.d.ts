/**
 * Private-file helpers for the GitHub App key.
 *
 * Deletions are restricted to the harness home so a tampered settings file
 * cannot turn `clearConfig` into arbitrary file removal.
 */
/**
 * Whether a path lives inside the harness home, judged by its parent's real
 * location so a symlinked directory cannot escape the check.
 *
 * @param file candidate path.
 * @returns true when removing the path cannot reach outside `$DSH_HOME`.
 */
export declare function isInsideDshHome(file: string | null | undefined): boolean;
/**
 * Remove a file only when it is inside the harness home.
 *
 * @param file candidate path.
 * @returns true when the file is gone (or was absent), false otherwise.
 */
export declare function removeSecretFile(file: string | null | undefined): boolean;
