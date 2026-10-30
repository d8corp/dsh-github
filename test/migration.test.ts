/**
 * @jest-environment node
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  migrateLegacyLayout,
  pluginDir,
  readSettings,
  settingsPath,
  writeSettings,
} from '../src/settings'

function withEnv (fn: (home: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'dsh-github-app-migrate-'))
  const home = join(root, 'home')
  mkdirSync(home, { recursive: true })

  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home

  try {
    fn(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(root, { recursive: true, force: true })
  }
}

describe('migrateLegacyLayout', () => {
  it('moves settings and the encrypted key into the plugin directory', () => {
    withEnv((home) => {
      const oldKeyPath = join(home, 'github-app.pem.enc')

      writeFileSync(join(home, 'github.json'), JSON.stringify({
        appId: '123',
        installationId: '456',
        keyPath: oldKeyPath,
        keyFileName: 'uploaded.pem',
        keyEncrypted: true,
      }))
      writeFileSync(oldKeyPath, 'envelope', { mode: 0o600 })

      migrateLegacyLayout()

      const dir = join(home, 'dsh-github-app')
      const settings = readSettings()

      expect(existsSync(join(home, 'github.json'))).toBe(false)
      expect(existsSync(oldKeyPath)).toBe(false)
      expect(existsSync(join(dir, 'github.json'))).toBe(true)
      expect(settings.appId).toBe('123')
      expect(settings.keyFileName).toBe('uploaded.pem')
      expect(settings.keyEncrypted).toBe(true)
      expect(settings.keyPath).toBe(join(dir, 'github-app.pem.enc'))
      expect(readFileSync(settings.keyPath as string, 'utf8')).toBe('envelope')

      if (process.platform !== 'win32') {
        expect(statSync(join(dir, 'github-app.pem.enc')).mode & 0o777).toBe(0o600)
        expect(statSync(dir).mode & 0o777).toBe(0o700)
      }
    })
  })

  it('moves a legacy plaintext key and keeps it flagged as unencrypted', () => {
    withEnv((home) => {
      const oldKeyPath = join(home, 'github-app.pem')

      writeFileSync(join(home, 'github.json'), JSON.stringify({
        appId: '7',
        installationId: '8',
        keyPath: oldKeyPath,
        keyEncrypted: false,
      }))
      writeFileSync(oldKeyPath, 'PEM', { mode: 0o600 })

      migrateLegacyLayout()

      const settings = readSettings()

      expect(existsSync(oldKeyPath)).toBe(false)
      expect(settings.keyEncrypted).toBe(false)
      expect(settings.keyPath).toBe(join(home, 'dsh-github-app', 'github-app.pem'))
      expect(readFileSync(settings.keyPath as string, 'utf8')).toBe('PEM')
    })
  })

  it('never overwrites files already in the plugin directory', () => {
    withEnv((home) => {
      const dir = join(home, 'dsh-github-app')
      const newKeyPath = join(dir, 'github-app.pem.enc')
      const oldKeyPath = join(home, 'github-app.pem.enc')

      writeSettings({ appId: 'new', keyPath: newKeyPath, keyEncrypted: true })
      writeFileSync(newKeyPath, 'new-envelope', { mode: 0o600 })
      writeFileSync(join(home, 'github.json'), JSON.stringify({ appId: 'old', keyPath: oldKeyPath, keyEncrypted: true }))
      writeFileSync(oldKeyPath, 'old-envelope', { mode: 0o600 })

      migrateLegacyLayout()

      expect(readSettings().appId).toBe('new')
      expect(readFileSync(newKeyPath, 'utf8')).toBe('new-envelope')
      expect(existsSync(join(home, 'github.json'))).toBe(true)
      expect(existsSync(oldKeyPath)).toBe(true)
    })
  })

  it('keeps reading the legacy file before any migration', () => {
    withEnv((home) => {
      writeFileSync(join(home, 'github.json'), JSON.stringify({ appId: '42' }))

      expect(readSettings().appId).toBe('42')
      expect(settingsPath()).toBe(join(home, 'dsh-github-app', 'github.json'))
    })
  })

  it('does not create the plugin directory when there is nothing to migrate', () => {
    withEnv((home) => {
      migrateLegacyLayout()

      expect(existsSync(pluginDir())).toBe(false)
      expect(readSettings()).toEqual({
        appId: '',
        installationId: '',
        gitUserName: '',
        gitUserEmail: '',
        keyPath: null,
        keyFileName: null,
        keyEncrypted: false,
        tokenIssuedAt: null,
        tokenExpiresAt: null,
      })
    })
  })

  it('is idempotent', () => {
    withEnv((home) => {
      const oldKeyPath = join(home, 'github-app.pem.enc')

      writeFileSync(join(home, 'github.json'), JSON.stringify({ appId: '1', keyPath: oldKeyPath, keyEncrypted: true }))
      writeFileSync(oldKeyPath, 'envelope', { mode: 0o600 })

      migrateLegacyLayout()
      const first = readSettings()

      migrateLegacyLayout()

      expect(readSettings()).toEqual(first)
      expect(first.keyPath).toBe(join(home, 'dsh-github-app', 'github-app.pem.enc'))
    })
  })
})
