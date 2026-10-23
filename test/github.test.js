import test from 'node:test'
import assert from 'node:assert/strict'
import { getAuthStatus } from '../lib/github.js'

test('getAuthStatus correctly detects invalid token state', async () => {
  const status = await getAuthStatus()
  assert.strictEqual(typeof status.loggedIn, 'boolean')
  assert.strictEqual(typeof status.gitConfigured, 'boolean')
  assert.strictEqual(status.hostname, 'github.com')

  // When token is invalid, loggedIn must be false and error must be populated
  if (status.error && /invalid|failed to log in|expired/i.test(status.error)) {
    assert.strictEqual(status.loggedIn, false)
    assert.strictEqual(status.output, undefined)
  }
})
