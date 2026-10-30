/**
 * Atomic private-file writes shared by settings and key storage.
 *
 * Files are written to a sibling temp file, fsynced, renamed into place and
 * tightened to 0600, so a crash never leaves a half-written secret and an
 * existing destination cannot keep looser permissions.
 */
/**
 * Write a secret file atomically with mode 0600.
 *
 * @param file destination path.
 * @param content file contents.
 */
export declare function writeSecretFile(file: string, content: string): void;
