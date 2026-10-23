import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAuthStatus, isLoggedInOutput } from '../lib/github.js'

const isWindows = process.platform === 'win32'

// Output fixtures mirror real `gh auth status` formats (gh 2.x, plain text).
const LOGGED_IN = [
  'github.com',
  '  ✓ Logged in to github.com account test-user (keyring)',
  '  - Active account: true',
  '  - Git operations protocol: https',
  "  - Token scopes: 'gist', 'read:org', 'repo'"
].join('\n')

const LEGACY_LOGGED_IN = [
  'github.com',
  '  ✓ Logged in to github.com as test-user (oauth_token)'
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
  '  - Active account: true'
].join('\n')

// Mirror image: the working account is not active, the broken one is.
const ACTIVE_ENTRY_FAILED = [
  'github.com',
  '  X Failed to log in to github.com using token (GH_TOKEN)',
  '  - Active account: true',
  '  - The token in GH_TOKEN is invalid.',
  '  ✓ Logged in to github.com account test-user (keyring)',
  '  - Active account: false'
].join('\n')

const NOT_LOGGED_IN = 'You are not logged into any GitHub hosts. To log in, run: gh auth login'

// The active entry fails with a wording the classifier does not know. The
// verdict must fail closed instead of falling back to another working account.
const UNKNOWN_ACTIVE_WORDING = [
  'github.com',
  '  X Authentication is required to access github.com',
  '  - Active account: true',
  '  ✓ Logged in to github.com account test-user (keyring)',
  '  - Active account: false'
].join('\n')

// A legacy `✓`-prefixed metadata line inside a FAILED entry must not be read as
// a successful login.
const FAILED_ENTRY_WITH_CHECK_METADATA = [
  'github.com',
  '  X Failed to log in to github.com account stale-user (keyring)',
  '  ✓ Token: ********************',
  '  - Active account: true'
].join('\n')

test('isLoggedInOutput accepts a logged-in account', () => {
  assert.equal(isLoggedInOutput(LOGGED_IN), true)
  assert.equal(isLoggedInOutput(LEGACY_LOGGED_IN), true)
  assert.equal(isLoggedInOutput(LOGGED_IN.replace(/✓/g, '\u001b[32m✓\u001b[0m')), true)
})

test('isLoggedInOutput ignores failing entries that are not the active account', () => {
  assert.equal(isLoggedInOutput(FAILED_ENTRY_THEN_ACTIVE_OK), true)
})

test('isLoggedInOutput follows the active account even when another account works', () => {
  assert.equal(isLoggedInOutput(ACTIVE_ENTRY_FAILED), false)
  assert.equal(isLoggedInOutput(FAILED_ENTRY_WITH_CHECK_METADATA), false)
})

test('isLoggedInOutput stays conservative when the active entry is unrecognisable', () => {
  assert.equal(isLoggedInOutput(UNKNOWN_ACTIVE_WORDING), false)
})

test('isLoggedInOutput rejects output without a usable account', () => {
  assert.equal(isLoggedInOutput(NOT_LOGGED_IN), false)
  assert.equal(isLoggedInOutput(''), false)
  assert.equal(isLoggedInOutput('github.com\n  - Active account: true'), false)
})

/**
 * Put a stub `gh` on PATH so the API-level tests never touch the host's real
 * credentials, and restore PATH afterwards.
 *
 * @param script shell body executed by the stub.
 * @param fn callback run with the stub in place.
 */
async function withStubGh (script, fn) {
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
function stubGh (output, code) {
  return `cat <<'GH_AUTH_STATUS'\n${output}\nGH_AUTH_STATUS\nexit ${code}`
}

test('getAuthStatus reports a healthy setup as logged in despite a stale entry', { skip: isWindows }, async () => {
  await withStubGh(stubGh(FAILED_ENTRY_THEN_ACTIVE_OK, 0), async () => {
    const status = await getAuthStatus()
    assert.equal(status.loggedIn, true)
    assert.equal(status.error, undefined)
    assert.equal(status.hostname, 'github.com')
  })
})

test('getAuthStatus reports an unusable active account as logged out', { skip: isWindows }, async () => {
  await withStubGh(stubGh(ACTIVE_ENTRY_FAILED, 0), async () => {
    const status = await getAuthStatus()
    assert.equal(status.loggedIn, false)
    assert.equal(status.output, undefined)
    assert.match(status.error, /invalid/i)
  })
})

test('getAuthStatus reports a non-zero exit as logged out and surfaces the error', { skip: isWindows }, async () => {
  await withStubGh(stubGh(NOT_LOGGED_IN, 1), async () => {
    const status = await getAuthStatus()
    assert.equal(status.loggedIn, false)
    assert.equal(status.output, undefined)
    assert.match(status.error, /not logged into any GitHub hosts/i)
  })
})

test('getAuthStatus reports a successful exit with no account entries as logged out', { skip: isWindows }, async () => {
  await withStubGh(stubGh('github.com', 0), async () => {
    const status = await getAuthStatus()
    assert.equal(status.loggedIn, false)
    assert.equal(typeof status.gitConfigured, 'boolean')
  })
})

test('getAuthStatus requires a zero exit from gh, even for a logged-in looking output', { skip: isWindows }, async () => {
  await withStubGh(stubGh(LOGGED_IN, 1), async () => {
    const status = await getAuthStatus()
    assert.equal(status.loggedIn, false)
    assert.equal(status.output, undefined)
    assert.ok(status.error)
  })
})
