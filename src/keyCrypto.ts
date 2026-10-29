/**
 * Passphrase encryption for the GitHub App private key.
 *
 * The key is stored as a self-describing JSON envelope: scrypt turns the
 * passphrase into an AES-256-GCM key, and the envelope carries only the KDF
 * parameters, salt, IV and authentication tag — never the passphrase. The
 * passphrase is not persisted anywhere and is required again after every
 * server restart.
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'

import { passphraseError } from './passphrase'

const ENVELOPE_VERSION = 1
const KDF = 'scrypt'
const CIPHER = 'aes-256-gcm'
const KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const MIN_N = 1 << 12
const MAX_N = 1 << 18
const MAX_R = 16
const MAX_P = 4
// Bump only together with ENVELOPE_VERSION: it binds ciphertexts to this use.
const AAD = Buffer.from('dsh-github:private-key:v1', 'utf8')

interface KeyEnvelope {
  version: number
  kdf: typeof KDF
  cipher: typeof CIPHER
  N: number
  r: number
  p: number
  salt: string
  iv: string
  tag: string
  data: string
}

function decodeField (value: unknown, bytes: number): Buffer {
  if (typeof value !== 'string' || value === '') throw new Error('Malformed key envelope')
  const buffer = Buffer.from(value, 'base64')

  if (buffer.length !== bytes) throw new Error('Malformed key envelope')

  return buffer
}

function readEnvelope (text: string): KeyEnvelope {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Malformed key envelope')
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Malformed key envelope')
  }

  const value = parsed as Record<string, unknown>
  const N = value.N
  const r = value.r
  const p = value.p

  if (value.version !== ENVELOPE_VERSION || value.kdf !== KDF || value.cipher !== CIPHER) {
    throw new Error('Unsupported key envelope')
  }

  if (!Number.isInteger(N) || (N as number) < MIN_N || (N as number) > MAX_N || ((N as number) & ((N as number) - 1)) !== 0) {
    throw new Error('Malformed key envelope')
  }

  if (!Number.isInteger(r) || (r as number) < 1 || (r as number) > MAX_R) throw new Error('Malformed key envelope')
  if (!Number.isInteger(p) || (p as number) < 1 || (p as number) > MAX_P) throw new Error('Malformed key envelope')

  // Decode up front so decryption only ever sees well-formed material.
  decodeField(value.salt, SALT_BYTES)
  decodeField(value.iv, IV_BYTES)
  decodeField(value.tag, TAG_BYTES)

  if (typeof value.data !== 'string' || value.data === '') throw new Error('Malformed key envelope')

  return value as unknown as KeyEnvelope
}

function deriveKey (passphrase: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, KEY_BYTES, {
      N,
      r,
      p,
      maxmem: 128 * N * r + 64 * 1024 * 1024,
    }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

/**
 * Encrypt a PEM private key under a passphrase.
 *
 * @param pem PEM text.
 * @param passphrase user passphrase; never stored.
 * @returns the JSON envelope to write to disk.
 */
export async function encryptPrivateKey (pem: string, passphrase: string): Promise<string> {
  const invalid = passphraseError(passphrase)

  if (invalid !== null) throw new Error(invalid)
  if (pem.trim() === '') throw new Error('Private key is empty')

  const N = 1 << 15
  const r = 8
  const p = 1
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await deriveKey(passphrase, salt, N, r, p)

  try {
    const cipher = createCipheriv(CIPHER, key, iv)
    cipher.setAAD(AAD)
    const data = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()

    const envelope: KeyEnvelope = {
      version: ENVELOPE_VERSION,
      kdf: KDF,
      cipher: CIPHER,
      N,
      r,
      p,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: data.toString('base64'),
    }

    return `${JSON.stringify(envelope, null, 2)}\n`
  } finally {
    key.fill(0)
  }
}

/**
 * Decrypt a key envelope produced by {@link encryptPrivateKey}.
 *
 * @param text JSON envelope read from disk.
 * @param passphrase user passphrase.
 * @returns the PEM text.
 */
export async function decryptPrivateKey (text: string, passphrase: string): Promise<string> {
  const invalid = passphraseError(passphrase)

  if (invalid !== null) throw new Error(invalid)

  const envelope = readEnvelope(text)
  const salt = decodeField(envelope.salt, SALT_BYTES)
  const iv = decodeField(envelope.iv, IV_BYTES)
  const tag = decodeField(envelope.tag, TAG_BYTES)
  const data = Buffer.from(envelope.data, 'base64')
  const key = await deriveKey(passphrase, salt, envelope.N, envelope.r, envelope.p)

  try {
    const decipher = createDecipheriv(CIPHER, key, iv)
    decipher.setAAD(AAD)
    decipher.setAuthTag(tag)

    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    // Never distinguish a wrong passphrase from a corrupted ciphertext.
    throw new Error('Cannot decrypt private key')
  } finally {
    key.fill(0)
  }
}
