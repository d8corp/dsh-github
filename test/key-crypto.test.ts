/**
 * @jest-environment node
 */
import { generateKeyPairSync } from 'node:crypto'

import {
  decryptPrivateKey,
  encryptPrivateKey,
  MAX_PASSPHRASE_CHARS,
  MIN_PASSPHRASE_CHARS,
  passphraseError,
} from '../src/keyCrypto'

const PRIVATE_KEY_PEM = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey
  .export({ type: 'pkcs1', format: 'pem' }) as string

const PASSPHRASE = 'correct horse battery staple'

describe('keyCrypto', () => {
  test('round-trips a PEM under a passphrase', async () => {
    const envelope = await encryptPrivateKey(PRIVATE_KEY_PEM, PASSPHRASE)

    expect(envelope).not.toContain('PRIVATE KEY')
    await expect(decryptPrivateKey(envelope, PASSPHRASE)).resolves.toBe(PRIVATE_KEY_PEM)
  })

  test('uses a fresh salt and IV for every encryption', async () => {
    const first = JSON.parse(await encryptPrivateKey(PRIVATE_KEY_PEM, PASSPHRASE))
    const second = JSON.parse(await encryptPrivateKey(PRIVATE_KEY_PEM, PASSPHRASE))

    expect(first.salt).not.toBe(second.salt)
    expect(first.iv).not.toBe(second.iv)
    expect(first.data).not.toBe(second.data)
    expect(await decryptPrivateKey(JSON.stringify(first), PASSPHRASE)).toBe(PRIVATE_KEY_PEM)
    expect(await decryptPrivateKey(JSON.stringify(second), PASSPHRASE)).toBe(PRIVATE_KEY_PEM)
  })

  test('rejects a wrong passphrase', async () => {
    const envelope = await encryptPrivateKey(PRIVATE_KEY_PEM, PASSPHRASE)

    await expect(decryptPrivateKey(envelope, 'not-the-passphrase')).rejects.toThrow(/cannot decrypt/i)
  })

  test('rejects tampered ciphertext and metadata', async () => {
    const envelope = JSON.parse(await encryptPrivateKey(PRIVATE_KEY_PEM, PASSPHRASE))
    const data = Buffer.from(envelope.data, 'base64')
    data[0] ^= 0xff
    const tampered = JSON.stringify({ ...envelope, data: data.toString('base64') })

    await expect(decryptPrivateKey(tampered, PASSPHRASE)).rejects.toThrow(/cannot decrypt/i)
    await expect(decryptPrivateKey(JSON.stringify({ ...envelope, salt: 'AAAA' }), PASSPHRASE)).rejects.toThrow(/malformed/i)
    await expect(decryptPrivateKey(JSON.stringify({ ...envelope, N: 3 }), PASSPHRASE)).rejects.toThrow(/malformed/i)
    await expect(decryptPrivateKey(JSON.stringify({ ...envelope, version: 2 }), PASSPHRASE)).rejects.toThrow(/unsupported/i)
  })

  test('rejects malformed documents without throwing parser internals', async () => {
    for (const value of ['', 'not json', '{}', '[]', 'null']) {
      await expect(decryptPrivateKey(value, PASSPHRASE)).rejects.toThrow(/malformed|unsupported/i)
    }
  })

  test('validates passphrases', () => {
    expect(passphraseError('')).toMatch(/required/i)
    expect(passphraseError('        ')).toMatch(/required/i)
    expect(passphraseError(undefined)).toMatch(/required/i)
    expect(passphraseError('short')).toMatch(new RegExp(String(MIN_PASSPHRASE_CHARS)))
    expect(passphraseError('x'.repeat(MAX_PASSPHRASE_CHARS + 1))).toMatch(/at most/i)
    expect(passphraseError(PASSPHRASE)).toBeNull()
  })

  test('refuses to encrypt an empty key', async () => {
    await expect(encryptPrivateKey('   ', PASSPHRASE)).rejects.toThrow(/empty/i)
  })
})
