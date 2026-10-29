/**
 * @jest-environment node
 */
import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { createApiHandler } from '../src/api'
import { TOKEN_TTL_SECONDS } from '../src/constants'
import { connect, disconnect, getAuthStatus } from '../src/github'
import { decryptPrivateKey, encryptPrivateKey } from '../src/keyCrypto'
import { normalizeSettings, readSettings, writeSettings } from '../src/settings'

const isWindows = process.platform === 'win32'
const testUnlessWindows = isWindows ? test.skip : test

// A real RSA key: connect() builds a JWT from the PEM before it calls the API.
const PRIVATE_KEY_PEM = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey
  .export({ type: 'pkcs1', format: 'pem' }) as string

const PASSPHRASE = 'test-key-passphrase'

// `gh auth status` fixture: a healthy, active account.
const LOGGED_IN_STATUS = [
  'github.com',
  '  ✓ Logged in to github.com account test-user (keyring)',
  '  - Active account: true',
  '  - Git operations protocol: https',
].join('\n')

/**
 * Shell body of the stub `gh`: answers `--version`, consumes the piped token
 * for `auth login`, and reports the healthy `auth status` fixture.
 *
 * Like the real binary, the stub refuses `auth login`/`auth logout` when any
 * token environment variable is present, and reports the environment token
 * instead of the stored account for `auth status`.
 *
 * @param loginCode exit code of `gh auth login` (non-zero simulates failure).
 * @returns the stub script body.
 */
function ghStub (loginCode = 0): string {
  const tokenGuard = [
    '  if [ -n "$GH_TOKEN" ] || [ -n "$GITHUB_TOKEN" ] || [ -n "$GH_ENTERPRISE_TOKEN" ] || [ -n "$GITHUB_ENTERPRISE_TOKEN" ]; then',
    '    echo "The value of the GH_TOKEN environment variable is being used for authentication." >&2',
    '    exit 1',
    '  fi',
  ]

  return [
    'if [ "$1" = "--version" ]; then',
    '  echo "gh version 2.62.0 (2024-09-01)"',
    '  exit 0',
    'fi',
    'if [ "$1" = "auth" ] && [ "$2" = "login" ]; then',
    ...tokenGuard,
    '  cat > /dev/null',
    loginCode === 0
      ? '  exit 0'
      : `  echo "failed to log in to github.com" >&2\n  exit ${loginCode}`,
    'fi',
    'if [ "$1" = "auth" ] && [ "$2" = "logout" ]; then',
    ...tokenGuard,
    // Read the confirmation `y` before exiting: a stub that closes the pipe
    // while the host is still writing raises EPIPE on the child's stdin.
    '  cat > /dev/null',
    '  if [ -n "$GH_STUB_MARKER" ]; then echo "logged-out" > "$GH_STUB_MARKER"; fi',
    '  exit 0',
    'fi',
    'if [ "$1" = "auth" ] && [ "$2" = "setup-git" ]; then',
    '  exit 0',
    'fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
    '  if [ -n "$GH_TOKEN" ] || [ -n "$GITHUB_TOKEN" ]; then',
    "    cat <<'GH_TOKEN_STATUS'",
    'github.com',
    '  X Failed to log in to github.com using token (GH_TOKEN)',
    '  - Active account: true',
    '  - The token in GH_TOKEN is invalid.',
    'GH_TOKEN_STATUS',
    '    exit 0',
    '  fi',
    "  cat <<'GH_AUTH_STATUS'",
    LOGGED_IN_STATUS,
    'GH_AUTH_STATUS',
    '  exit 0',
    'fi',
    'exit 0',
  ].join('\n')
}

const API_ISSUED_ISO = '2026-01-02T03:04:05.678Z'
const API_ISSUED_MS = Date.parse(API_ISSUED_ISO)
const API_EXPIRES_ISO = '2026-01-02T04:04:05.678Z'
const API_EXPIRES_MS = Date.parse(API_EXPIRES_ISO)

const originalFetch = globalThis.fetch

/** Every environment variable the tests touch, restored after each case. */
const RESTORED_ENV_KEYS = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GH_STUB_MARKER',
] as const

const originalEnv = new Map<string, string | undefined>(
  RESTORED_ENV_KEYS.map((key) => [key, process.env[key]]),
)

/**
 * Restore one environment variable to the value it had before the test.
 *
 * @param key variable name.
 * @param value original value, or undefined when it was unset.
 */
function restoreEnv (key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of RESTORED_ENV_KEYS) restoreEnv(key, originalEnv.get(key))
})

/**
 * Replace `globalThis.fetch` with a stub returning a canned access-token body.
 *
 * @param payload response body (object is JSON-encoded, string is passed through).
 * @param status HTTP status of the stubbed response.
 * @returns the jest mock installed on `globalThis.fetch`.
 */
function stubFetch (payload: unknown, status = 200): jest.Mock {
  const mock = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  }))

  globalThis.fetch = mock as unknown as typeof fetch

  return mock
}

/**
 * Put a stub `gh` on PATH so the tests never touch the host's real credentials,
 * and restore PATH afterwards (same helper as test/github.test.ts).
 *
 * @param script shell body executed by the stub.
 * @param fn callback run with the stub in place.
 */
async function withStubGh<T> (script: string, fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-token-gh-'))
  const file = join(dir, 'gh')
  writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 })
  chmodSync(file, 0o755)

  const previousPath = process.env.PATH
  process.env.PATH = `${dir}:${previousPath}`

  try {
    return await fn()
  } finally {
    process.env.PATH = previousPath
    rmSync(dir, { recursive: true, force: true })
  }
}

interface TokenEnv {
  home: string
  keyPath: string
}

/**
 * Run a test with `DSH_HOME` pointing at a fresh temp dir and a real private
 * key file inside it; the temp dir and `DSH_HOME` are restored afterwards.
 *
 * @param fn callback receiving the temp home and key path.
 */
async function withTokenEnv<T> (fn: (env: TokenEnv) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-token-expiry-'))
  const home = join(root, 'home')
  const keyPath = join(home, 'dsh-github', 'github-app.pem.enc')
  mkdirSync(join(home, 'dsh-github'), { recursive: true })
  writeFileSync(keyPath, await encryptPrivateKey(PRIVATE_KEY_PEM, PASSPHRASE), { mode: 0o600 })

  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home

  try {
    return await fn({ home, keyPath })
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(root, { recursive: true, force: true })
  }
}

describe('connect token lifetime', () => {
  testUnlessWindows('persists the expires_at instant reported by the GitHub API', async () => {
    await withStubGh(ghStub(), () => withTokenEnv(async ({ keyPath }) => {
      stubFetch({ token: 'ghs_installation_token', expires_at: API_EXPIRES_ISO })

      const before = Date.now()
      const result = await connect({ appId: '123', installationId: '456', keyPath, keyEncrypted: true }, PASSPHRASE)
      const after = Date.now()

      expect(result.ok).toBe(true)

      const settings = readSettings()
      expect(settings.tokenExpiresAt).toBe(API_EXPIRES_ISO)

      const issuedAt = Date.parse(settings.tokenIssuedAt as string)
      expect(issuedAt).toBeGreaterThanOrEqual(before)
      expect(issuedAt).toBeLessThanOrEqual(after)
    }))
  })

  testUnlessWindows('falls back to issuedAt + TOKEN_TTL_SECONDS without a usable expires_at', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['missing', { token: 'ghs_installation_token' }],
      ['empty', { token: 'ghs_installation_token', expires_at: '' }],
      ['unparsable', { token: 'ghs_installation_token', expires_at: 'not-a-date' }],
      ['non-string', { token: 'ghs_installation_token', expires_at: API_EXPIRES_MS }],
    ]

    for (const [label, body] of cases) {
      await withStubGh(ghStub(), () => withTokenEnv(async ({ keyPath }) => {
        stubFetch(body)

        const before = Date.now() + TOKEN_TTL_SECONDS * 1000
        const result = await connect({ appId: '123', installationId: '456', keyPath, keyEncrypted: true }, PASSPHRASE)
        const after = Date.now() + TOKEN_TTL_SECONDS * 1000

        expect(result.ok).toBe(true)

        const settings = readSettings()
        const expiresAt = Date.parse(settings.tokenExpiresAt as string)
        const issuedAt = Date.parse(settings.tokenIssuedAt as string)

        expect(label).toBeTruthy()
        expect(expiresAt - issuedAt).toBe(TOKEN_TTL_SECONDS * 1000)
        expect(expiresAt).toBeGreaterThanOrEqual(before)
        expect(expiresAt).toBeLessThanOrEqual(after)
      }))
    }
  })

  testUnlessWindows('does not record a lifetime when gh auth login fails', async () => {
    await withStubGh(ghStub(1), () => withTokenEnv(async ({ keyPath }) => {
      stubFetch({ token: 'ghs_installation_token', expires_at: API_EXPIRES_ISO })

      const result = await connect({ appId: '123', installationId: '456', keyPath, keyEncrypted: true }, PASSPHRASE)

      expect(result.ok).toBe(false)
      expect(readSettings().tokenExpiresAt).toBeNull()
      expect(readSettings().tokenIssuedAt).toBeNull()
    }))
  })
})

describe('private key protection', () => {
  testUnlessWindows('connect refuses a key stored without encryption', async () => {
    await withTokenEnv(async ({ home }) => {
      const legacyPath = join(home, 'legacy.pem')
      writeFileSync(legacyPath, PRIVATE_KEY_PEM, { mode: 0o600 })
      const fetchMock = stubFetch({ token: 'ghs_installation_token' })

      const result = await connect({
        appId: '123',
        installationId: '456',
        keyPath: legacyPath,
        keyEncrypted: false,
      }, PASSPHRASE)

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/unencrypted/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  testUnlessWindows('connect refuses a wrong or missing passphrase before calling GitHub', async () => {
    await withTokenEnv(async ({ keyPath }) => {
      const fetchMock = stubFetch({ token: 'ghs_installation_token' })
      const settings = {
        appId: '123',
        installationId: '456',
        keyPath,
        keyEncrypted: true,
      }

      const wrong = await connect(settings, 'wrong-passphrase')
      const missing = await connect(settings)

      expect(wrong.ok).toBe(false)
      expect(wrong.error).toMatch(/decrypt/i)
      expect(missing.ok).toBe(false)
      expect(missing.error).toMatch(/passphrase/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  testUnlessWindows('rejects a key upload without a passphrase and leaves the stored key untouched', async () => {
    await withTokenEnv(async ({ home }) => {
      const keyPath = join(home, 'dsh-github', 'github-app.pem.enc')
      const before = readFileSync(keyPath, 'utf8')

      const response = await postApi({
        action: 'saveConfig',
        pemBase64: Buffer.from(PRIVATE_KEY_PEM, 'utf8').toString('base64'),
        pemFileName: 'uploaded.pem',
      })

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.body).error.message).toMatch(/passphrase/i)
      expect(readFileSync(keyPath, 'utf8')).toBe(before)
    })
  })

  testUnlessWindows('saveConfig encrypts an uploaded key and removes the legacy plaintext', async () => {
    await withStubGh(ghStub(), () => withTokenEnv(async ({ home }) => {
      const legacyPath = join(home, 'legacy.pem')
      writeFileSync(legacyPath, PRIVATE_KEY_PEM, { mode: 0o600 })
      writeSettings({ appId: '123', installationId: '456', keyPath: legacyPath, keyEncrypted: false })

      const response = await postApi({
        action: 'saveConfig',
        appId: '123',
        installationId: '456',
        pemBase64: Buffer.from(PRIVATE_KEY_PEM, 'utf8').toString('base64'),
        pemFileName: 'uploaded.pem',
        passphrase: PASSPHRASE,
      })

      expect(response.statusCode).toBe(200)

      const settings = JSON.parse(response.body).value.settings
      const encryptedPath = settings.keyPath as string

      expect(settings.keyEncrypted).toBe(true)
      expect(encryptedPath.endsWith('github-app.pem.enc')).toBe(true)
      expect(existsSync(legacyPath)).toBe(false)
      expect(existsSync(encryptedPath)).toBe(true)

      const encryptedText = readFileSync(encryptedPath, 'utf8')
      expect(encryptedText).not.toContain('PRIVATE KEY')
      expect(await decryptPrivateKey(encryptedText, PASSPHRASE)).toBe(PRIVATE_KEY_PEM)
      expect(statSync(encryptedPath).mode & 0o777).toBe(0o600)
    }))
  })

  testUnlessWindows('encryptKey migrates a legacy plaintext key in place', async () => {
    await withStubGh(ghStub(), () => withTokenEnv(async ({ home }) => {
      const legacyPath = join(home, 'legacy.pem')
      writeFileSync(legacyPath, PRIVATE_KEY_PEM, { mode: 0o600 })
      writeSettings({ appId: '123', installationId: '456', keyPath: legacyPath, keyEncrypted: false })

      const response = await postApi({ action: 'encryptKey', passphrase: PASSPHRASE })

      expect(response.statusCode).toBe(200)

      const settings = JSON.parse(response.body).value.settings
      expect(settings.keyEncrypted).toBe(true)
      expect(settings.keyPath.endsWith('github-app.pem.enc')).toBe(true)
      expect(existsSync(legacyPath)).toBe(false)

      const encryptedText = readFileSync(settings.keyPath, 'utf8')
      expect(await decryptPrivateKey(encryptedText, PASSPHRASE)).toBe(PRIVATE_KEY_PEM)
    }))
  })
})

describe('disconnect', () => {
  testUnlessWindows('clears the recorded token lifetime', async () => {
    await withStubGh(ghStub(), () => withTokenEnv(async ({ home, keyPath }) => {
      writeSettings({
        appId: '123',
        installationId: '456',
        keyPath,
        keyEncrypted: true,
        tokenIssuedAt: API_ISSUED_ISO,
        tokenExpiresAt: API_EXPIRES_ISO,
      })

      const result = await disconnect()

      expect(result.ok).toBe(true)

      const settings = readSettings()
      expect(settings.tokenIssuedAt).toBeNull()
      expect(settings.tokenExpiresAt).toBeNull()
      expect(settings.appId).toBe('123')
      expect(settings.keyPath).toBe(keyPath)
      expect(settings.keyEncrypted).toBe(true)

      const onDisk = JSON.parse(readFileSync(join(home, 'dsh-github', 'github.json'), 'utf8'))
      expect(onDisk.tokenIssuedAt).toBeNull()
      expect(onDisk.tokenExpiresAt).toBeNull()
    }))
  })
})

describe('token environment vs auth commands', () => {
  const STALE_TOKEN = 'ghs_expired_installation_token'
  const FRESH_TOKEN = 'ghs_fresh_installation_token'

  testUnlessWindows('connect succeeds while the previous installation token is exported', async () => {
    await withStubGh(ghStub(), () => withTokenEnv(async ({ keyPath }) => {
      // A previous successful connect exports the token into the host process.
      // Real `gh` refuses to store credentials while it is set, which used to
      // make every reconnect after the first one fail.
      process.env.GH_TOKEN = STALE_TOKEN
      process.env.GITHUB_TOKEN = STALE_TOKEN

      stubFetch({ token: FRESH_TOKEN, expires_at: API_EXPIRES_ISO })

      const result = await connect({ appId: '123', installationId: '456', keyPath, keyEncrypted: true }, PASSPHRASE)

      expect(result.ok).toBe(true)
      expect(result.error).toBeUndefined()

      // The freshly issued token replaces the stale one for the agent.
      expect(process.env.GH_TOKEN).toBe(FRESH_TOKEN)
      expect(process.env.GITHUB_TOKEN).toBe(FRESH_TOKEN)
      expect(readSettings().tokenExpiresAt).toBe(API_EXPIRES_ISO)
    }))
  })

  testUnlessWindows('connect succeeds with enterprise token variables exported', async () => {
    await withStubGh(ghStub(), () => withTokenEnv(async ({ keyPath }) => {
      process.env.GH_ENTERPRISE_TOKEN = STALE_TOKEN
      process.env.GITHUB_ENTERPRISE_TOKEN = STALE_TOKEN

      stubFetch({ token: FRESH_TOKEN })

      const result = await connect({ appId: '123', installationId: '456', keyPath, keyEncrypted: true }, PASSPHRASE)

      expect(result.ok).toBe(true)
      expect(process.env.GH_ENTERPRISE_TOKEN).toBe(STALE_TOKEN)
      expect(process.env.GITHUB_ENTERPRISE_TOKEN).toBe(STALE_TOKEN)
    }))
  })

  testUnlessWindows('disconnect logs out while a token is exported', async () => {
    await withStubGh(ghStub(), () => withTokenEnv(async ({ home }) => {
      const marker = join(home, 'logout.marker')
      process.env.GH_STUB_MARKER = marker
      process.env.GH_TOKEN = STALE_TOKEN
      process.env.GITHUB_TOKEN = STALE_TOKEN

      const result = await disconnect()

      expect(result.ok).toBe(true)
      // The stub writes the marker only after passing the token guard, so the
      // marker proves `gh auth logout` actually reached gh without GH_TOKEN.
      expect(readFileSync(marker, 'utf8').trim()).toBe('logged-out')
      expect(process.env.GH_TOKEN).toBeUndefined()
      expect(process.env.GITHUB_TOKEN).toBeUndefined()
    }))
  })

  testUnlessWindows('getAuthStatus reads the stored credentials, not the environment token', async () => {
    await withStubGh(ghStub(), async () => {
      process.env.GH_TOKEN = STALE_TOKEN

      const status = await getAuthStatus()

      // The stub reports a failed (GH_TOKEN) account when it sees the token,
      // so a healthy verdict proves the token was stripped from the child.
      expect(status.loggedIn).toBe(true)
      expect(status.error).toBeUndefined()
    })
  })
})

describe('normalizeSettings token lifetime', () => {
  test('rejects garbage, NaN and negative timestamps without throwing', () => {
    const garbage: unknown[] = [{}, [], 'nonsense', 'NaN', '', NaN, Infinity, -Infinity, -1, -API_EXPIRES_MS, true, null]

    for (const value of garbage) {
      const settings = normalizeSettings({ tokenIssuedAt: value, tokenExpiresAt: value })

      expect(settings.tokenIssuedAt).toBeNull()
      expect(settings.tokenExpiresAt).toBeNull()
    }
  })

  test('canonicalizes valid ISO strings and epoch-millisecond numbers', () => {
    expect(normalizeSettings({ tokenIssuedAt: API_ISSUED_ISO }).tokenIssuedAt).toBe(API_ISSUED_ISO)
    expect(normalizeSettings({ tokenExpiresAt: API_EXPIRES_MS }).tokenExpiresAt).toBe(API_EXPIRES_ISO)
    expect(normalizeSettings({ tokenExpiresAt: '2026-01-02T05:04:05.678+02:00' }).tokenExpiresAt).toBe(API_ISSUED_ISO)
    expect(normalizeSettings({ tokenExpiresAt: '2026-01-02' }).tokenExpiresAt).toBe('2026-01-02T00:00:00.000Z')
  })

  test('keyEncrypted is strictly boolean', () => {
    expect(normalizeSettings({}).keyEncrypted).toBe(false)
    expect(normalizeSettings({ keyEncrypted: 'true' }).keyEncrypted).toBe(false)
    expect(normalizeSettings({ keyEncrypted: true }).keyEncrypted).toBe(true)
  })
})

class StubResponse {
  statusCode = 0
  headers: Record<string, unknown> = {}
  body = ''
  writableEnded = false
  destroyed = false

  writeHead (status: number, headers: Record<string, unknown>): this {
    this.statusCode = status
    this.headers = headers

    return this
  }

  end (chunk?: string): void {
    this.body = chunk === undefined ? '' : chunk
    this.writableEnded = true
  }
}

/**
 * Call the plugin API handler with a trusted loopback POST request.
 *
 * @param body JSON body to send.
 * @returns captured status code and response body.
 */
async function postApi (body: Record<string, unknown>): Promise<{ statusCode: number, body: string }> {
  const handler = createApiHandler({}, { trustedHosts: [] })
  const req = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage

  req.method = 'POST'
  req.headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }

  const res = new StubResponse()

  await handler(req, res as unknown as ServerResponse)

  return { statusCode: res.statusCode, body: res.body }
}

describe('statusPayload token', () => {
  testUnlessWindows('exposes epoch-ms issue/expiry, the TTL and the active flag', async () => {
    await withStubGh(ghStub(), () => withTokenEnv(async ({ keyPath }) => {
      writeSettings({
        appId: '123',
        installationId: '456',
        keyPath,
        keyEncrypted: true,
        tokenIssuedAt: API_ISSUED_ISO,
        tokenExpiresAt: API_EXPIRES_ISO,
      })

      const response = await postApi({ action: 'status' })

      expect(response.statusCode).toBe(200)

      const payload = JSON.parse(response.body)

      expect(payload.ok).toBe(true)
      expect(payload.value.auth.loggedIn).toBe(true)

      expect(payload.value.token).toEqual({
        issuedAt: API_ISSUED_MS,
        expiresAt: API_EXPIRES_MS,
        ttlSeconds: TOKEN_TTL_SECONDS,
        active: true,
      })

      expect(payload.value.token.ttlSeconds).toBe(3600)
    }))
  })

  testUnlessWindows('reports null timestamps for unparsable persisted values', async () => {
    await withStubGh(ghStub(), () => withTokenEnv(async () => {
      writeSettings({ appId: '123', installationId: '456', tokenIssuedAt: 'garbage', tokenExpiresAt: 'nonsense' })

      const response = await postApi({ action: 'status' })
      const payload = JSON.parse(response.body)

      expect(payload.value.token.issuedAt).toBeNull()
      expect(payload.value.token.expiresAt).toBeNull()
      expect(payload.value.token.ttlSeconds).toBe(TOKEN_TTL_SECONDS)
      expect(payload.value.token.active).toBe(true)
    }))
  })

  testUnlessWindows('saveConfig and clearConfig round-trip the recorded lifetime', async () => {
    await withStubGh(ghStub(), () => withTokenEnv(async ({ keyPath }) => {
      writeSettings({
        appId: '123',
        installationId: '456',
        keyPath,
        keyEncrypted: true,
        tokenIssuedAt: API_ISSUED_ISO,
        tokenExpiresAt: API_EXPIRES_ISO,
      })

      const saved = await postApi({ action: 'saveConfig', appId: '999' })

      expect(JSON.parse(saved.body).value.settings.tokenExpiresAt).toBe(API_EXPIRES_ISO)
      expect(readSettings().tokenExpiresAt).toBe(API_EXPIRES_ISO)
      expect(readSettings().appId).toBe('999')

      const cleared = await postApi({ action: 'clearConfig' })

      expect(JSON.parse(cleared.body).value.token.expiresAt).toBeNull()
      expect(readSettings().tokenExpiresAt).toBeNull()
      expect(readSettings().tokenIssuedAt).toBeNull()
    }))
  })
})
