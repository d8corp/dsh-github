import { passphraseError } from "./passphrase.mjs";
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
// src/keyCrypto.ts
/**
* Passphrase encryption for the GitHub App private key.
*
* The key is stored as a self-describing JSON envelope: scrypt turns the
* passphrase into an AES-256-GCM key, and the envelope carries only the KDF
* parameters, salt, IV and authentication tag — never the passphrase. The
* passphrase is not persisted anywhere and is required again after every
* server restart.
*/
const ENVELOPE_VERSION = 1;
const KDF = "scrypt";
const CIPHER = "aes-256-gcm";
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_N = 4096;
const MAX_N = 1 << 18;
const MAX_R = 16;
const MAX_P = 4;
const AAD = Buffer.from("dsh-github-app:private-key:v1", "utf8");
function decodeField(value, bytes) {
	if (typeof value !== "string" || value === "") throw new Error("Malformed key envelope");
	const buffer = Buffer.from(value, "base64");
	if (buffer.length !== bytes) throw new Error("Malformed key envelope");
	return buffer;
}
function readEnvelope(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("Malformed key envelope");
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Malformed key envelope");
	const value = parsed;
	const N = value.N;
	const r = value.r;
	const p = value.p;
	if (value.version !== ENVELOPE_VERSION || value.kdf !== KDF || value.cipher !== CIPHER) throw new Error("Unsupported key envelope");
	if (!Number.isInteger(N) || N < MIN_N || N > MAX_N || (N & N - 1) !== 0) throw new Error("Malformed key envelope");
	if (!Number.isInteger(r) || r < 1 || r > MAX_R) throw new Error("Malformed key envelope");
	if (!Number.isInteger(p) || p < 1 || p > MAX_P) throw new Error("Malformed key envelope");
	decodeField(value.salt, SALT_BYTES);
	decodeField(value.iv, IV_BYTES);
	decodeField(value.tag, TAG_BYTES);
	if (typeof value.data !== "string" || value.data === "") throw new Error("Malformed key envelope");
	return value;
}
function deriveKey(passphrase, salt, N, r, p) {
	return new Promise((resolve, reject) => {
		scrypt(passphrase, salt, KEY_BYTES, {
			N,
			r,
			p,
			maxmem: 128 * N * r + 67108864
		}, (error, key) => {
			if (error) reject(error);
			else resolve(key);
		});
	});
}
/**
* Encrypt a PEM private key under a passphrase.
*
* @param pem PEM text.
* @param passphrase user passphrase; never stored.
* @returns the JSON envelope to write to disk.
*/
async function encryptPrivateKey(pem, passphrase) {
	const invalid = passphraseError(passphrase);
	if (invalid !== null) throw new Error(invalid);
	if (pem.trim() === "") throw new Error("Private key is empty");
	const N = 32768;
	const r = 8;
	const p = 1;
	const salt = randomBytes(SALT_BYTES);
	const iv = randomBytes(IV_BYTES);
	const key = await deriveKey(passphrase, salt, N, r, p);
	try {
		const cipher = createCipheriv(CIPHER, key, iv);
		cipher.setAAD(AAD);
		const data = Buffer.concat([cipher.update(pem, "utf8"), cipher.final()]);
		const tag = cipher.getAuthTag();
		const envelope = {
			version: ENVELOPE_VERSION,
			kdf: KDF,
			cipher: CIPHER,
			N,
			r,
			p,
			salt: salt.toString("base64"),
			iv: iv.toString("base64"),
			tag: tag.toString("base64"),
			data: data.toString("base64")
		};
		return `${JSON.stringify(envelope, null, 2)}\n`;
	} finally {
		key.fill(0);
	}
}
/**
* Decrypt a key envelope produced by {@link encryptPrivateKey}.
*
* @param text JSON envelope read from disk.
* @param passphrase user passphrase.
* @returns the PEM text.
*/
async function decryptPrivateKey(text, passphrase) {
	const invalid = passphraseError(passphrase);
	if (invalid !== null) throw new Error(invalid);
	const envelope = readEnvelope(text);
	const salt = decodeField(envelope.salt, SALT_BYTES);
	const iv = decodeField(envelope.iv, IV_BYTES);
	const tag = decodeField(envelope.tag, TAG_BYTES);
	const data = Buffer.from(envelope.data, "base64");
	const key = await deriveKey(passphrase, salt, envelope.N, envelope.r, envelope.p);
	try {
		const decipher = createDecipheriv(CIPHER, key, iv);
		decipher.setAAD(AAD);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
	} catch {
		throw new Error("Cannot decrypt private key");
	} finally {
		key.fill(0);
	}
}
export { decryptPrivateKey, encryptPrivateKey };
