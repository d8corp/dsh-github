/**
 * @jest-environment node
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getAuthStatus, isLoggedInOutput } from '../src/github'

const isWindows = process.platform === 'win32'
const testUnlessWindows = isWindows ? test.skip : test

// Output fixtures mirror real `gh auth status` formats (gh 2.x, plain text).
const LOGGED_IN = [
  'github.com',
  '  ✓ Logged in to github.com account test-user (keyring)',
  '  - Active account: true',
  '  - Git operations protocol: https',
  "  - Token scopes: 'gist', 'read:org', 'repo'",
].join('\n')

const LEGACY_LOGGED_IN = [
  'github.com',
  '  ✓ Logged in to github.com as test-user (oauth_token)',
].join('\n')

// A stale account that fails is listed first and is NOT the active account:
// `gh` still exits 0 because the GH_TOKEN entry works. Whole-output scanning
// used to report this healthy setup as disconnected.
const FAILED_ENTRY_THEN_ACTIVE_OK = [
  'github.com',
  '  X Failed to log in to github.com account stale-user (keyring)',
  '  - Active account: false',
  '  - The token in keyring is invalid.',
  '  ✓ Logged in to github.com using token (GH_TOKEN)',
  '  - Active account: true',
].join('\n')

// Mirror image: the working account is not active, the broken one is.
const ACTIVE_ENTRY_FAILED = [
  'github.com',
  '  X Failed to log in to github.com using token (GH_TOKEN)',
  '  - Active account: true',
  '  - The token in GH_TOKEN is invalid.',
  '  ✓ Logged in to github.com account test-user (keyring)',
  '  - Active account: false',
].join('\n')

const NOT_LOGGED_IN = 'You are not logged into any GitHub hosts. To log in, run: gh auth login'

// The active entry fails with a wording the classifier does not know. The
// verdict must fail closed instead of falling back to another working account.
const UNKNOWN_ACTIVE_WORDING = [
  'github.com',
  '  X Authentication is required to access github.com',
  '  - Active account: true',
  '  ✓ Logged in to github.com account test-user (keyring)',
  '  - Active account: false',
].join('\n')

// A legacy `✓`-prefixed metadata line inside a FAILED entry must not be read as
// a successful login.
const FAILED_ENTRY_WITH_CHECK_METADATA = [
  'github.com',
  '  X Failed to log in to github.com account stale-user (keyring)',
  '  ✓ Token: ********************',
  '  - Active account: true',
].join('\n')

describe('isLoggedInOutput', () => {
  test('accepts a logged-in account', () => {
    expect(isLoggedInOutput(LOGGED_IN)).toBe(true)
    expect(isLoggedInOutput(LEGACY_LOGGED_IN)).toBe(true)
    expect(isLoggedInOutput(LOGGED_IN.replace(/✓/g, '\u001b[32m✓\u001b[0m'))).toBe(true)
  })

  test('ignores failing entries that are not the active account', () => {
    expect(isLoggedInOutput(FAILED_ENTRY_THEN_ACTIVE_OK)).toBe(true)
  })

  test('follows the active account even when another account works', () => {
    expect(isLoggedInOutput(ACTIVE_ENTRY_FAILED)).toBe(false)
    expect(isLoggedInOutput(FAILED_ENTRY_WITH_CHECK_METADATA)).toBe(false)
  })

  test('stays conservative when the active entry is unrecognisable', () => {
    expect(isLoggedInOutput(UNKNOWN_ACTIVE_WORDING)).toBe(false)
  })

  test('rejects output without a usable account', () => {
    expect(isLoggedInOutput(NOT_LOGGED_IN)).toBe(false)
    expect(isLoggedInOutput('')).toBe(false)
    expect(isLoggedInOutput('github.com\n  - Active account: true')).toBe(false)
  })
})

/**
 * Put a stub `gh` on PATH so the API-level tests never touch the host's real
 * credentials, and restore PATH afterwards.
 *
 * @param script shell body executed by the stub.
 * @param fn callback run with the stub in place.
 */
async function withStubGh<T> (script: string, fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-test-'))
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

/**
 * Build a stub `gh` body that prints a fixture and exits with a status.
 *
 * @param output text the stub prints on stdout.
 * @param code exit code of the stub.
 */
function stubGh (output: string, code: number): string {
  return `cat <<'GH_AUTH_STATUS'\n${output}\nGH_AUTH_STATUS\nexit ${code}`
}

describe('getAuthStatus', () => {
  testUnlessWindows('reports a healthy setup as logged in despite a stale entry', async () => {
    await withStubGh(stubGh(FAILED_ENTRY_THEN_ACTIVE_OK, 0), async () => {
      const status = await getAuthStatus()
      expect(status.loggedIn).toBe(true)
      expect(status.error).toBeUndefined()
      expect(status.hostname).toBe('github.com')
    })
  })

  testUnlessWindows('reports an unusable active account as logged out', async () => {
    await withStubGh(stubGh(ACTIVE_ENTRY_FAILED, 0), async () => {
      const status = await getAuthStatus()
      expect(status.loggedIn).toBe(false)
      expect(status.output).toBeUndefined()
      expect(status.error).toMatch(/invalid/i)
    })
  })

  testUnlessWindows('reports a non-zero exit as logged out and surfaces the error', async () => {
    await withStubGh(stubGh(NOT_LOGGED_IN, 1), async () => {
      const status = await getAuthStatus()
      expect(status.loggedIn).toBe(false)
      expect(status.output).toBeUndefined()
      expect(status.error).toMatch(/not logged into any GitHub hosts/i)
    })
  })

  testUnlessWindows('reports a successful exit with no account entries as logged out', async () => {
    await withStubGh(stubGh('github.com', 0), async () => {
      const status = await getAuthStatus()
      expect(status.loggedIn).toBe(false)
      expect(typeof status.gitConfigured).toBe('boolean')
    })
  })

  testUnlessWindows('requires a zero exit from gh, even for a logged-in looking output', async () => {
    await withStubGh(stubGh(LOGGED_IN, 1), async () => {
      const status = await getAuthStatus()
      expect(status.loggedIn).toBe(false)
      expect(status.output).toBeUndefined()
      expect(status.error).toBeTruthy()
    })
  })
})
