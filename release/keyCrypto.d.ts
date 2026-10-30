/**
 * Passphrase encryption for the GitHub App private key.
 *
 * The key is stored as a self-describing JSON envelope: scrypt turns the
 * passphrase into an AES-256-GCM key, and the envelope carries only the KDF
 * parameters, salt, IV and authentication tag — never the passphrase. The
 * passphrase is not persisted anywhere and is required again after every
 * server restart.
 */
/**
 * Encrypt a PEM private key under a passphrase.
 *
 * @param pem PEM text.
 * @param passphrase user passphrase; never stored.
 * @returns the JSON envelope to write to disk.
 */
export declare function encryptPrivateKey(pem: string, passphrase: string): Promise<string>;
/**
 * Decrypt a key envelope produced by {@link encryptPrivateKey}.
 *
 * @param text JSON envelope read from disk.
 * @param passphrase user passphrase.
 * @returns the PEM text.
 */
export declare function decryptPrivateKey(text: string, passphrase: string): Promise<string>;
