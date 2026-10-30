/**
 * @jest-environment node
 */
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isInsideDshHome, removeSecretFile } from '../src/secureFile'

const testUnlessWindows = process.platform === 'win32' ? test.skip : test

function withHome<T> (home: string, fn: () => T): T {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home

  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
}

function createRoot (): { root: string, home: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-secure-'))
  const home = join(root, 'home')

  mkdirSync(home)

  return { root, home }
}

describe('isInsideDshHome', () => {
  it('accepts files below the home and rejects siblings', () => {
    const { root, home } = createRoot()

    withHome(home, () => {
      expect(isInsideDshHome(join(home, 'github-app.pem'))).toBe(true)
      expect(isInsideDshHome(join(home, 'dsh-github-app', 'github.json'))).toBe(true)
      expect(isInsideDshHome(join(root, 'outside.pem'))).toBe(false)
      expect(isInsideDshHome(join(home, '..', 'outside.pem'))).toBe(false)
      expect(isInsideDshHome(null)).toBe(false)
      expect(isInsideDshHome('')).toBe(false)
    })
  })

  testUnlessWindows('rejects a path whose directory symlink escapes the home', () => {
    const { root, home } = createRoot()
    const outside = join(root, 'outside')

    mkdirSync(outside)
    symlinkSync(outside, join(home, 'link'), 'dir')

    const target = join(outside, 'secret.pem')
    writeFileSync(target, 'secret', { mode: 0o600 })

    withHome(home, () => {
      expect(isInsideDshHome(join(home, 'link', 'secret.pem'))).toBe(false)
      expect(removeSecretFile(join(home, 'link', 'secret.pem'))).toBe(false)
    })

    expect(existsSync(target)).toBe(true)
  })
})

describe('removeSecretFile', () => {
  testUnlessWindows('removes a file inside the home', () => {
    const { home } = createRoot()
    const directory = join(home, 'dsh-github-app')
    const target = join(directory, 'github-app.pem')

    mkdirSync(directory)
    writeFileSync(target, 'secret', { mode: 0o600 })

    withHome(home, () => {
      expect(removeSecretFile(target)).toBe(true)
    })

    expect(existsSync(target)).toBe(false)
  })

  it('refuses paths outside the home', () => {
    const { root, home } = createRoot()
    const target = join(root, 'outside.pem')

    writeFileSync(target, 'secret')

    withHome(home, () => {
      expect(removeSecretFile(target)).toBe(false)
    })

    expect(existsSync(target)).toBe(true)
  })
})
