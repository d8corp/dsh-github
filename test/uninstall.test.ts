/**
 * @jest-environment node
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PACKAGE_NAME } from '../src/constants'
import { pluginDir } from '../src/settings'
import {
  profileDeclaresPackage,
  removePluginArtifacts,
  watchForUninstallCleanup,
} from '../src/uninstall'

const OTHER_PACKAGE = 'other-plugin'

function makeRoot (): string {
  return mkdtempSync(join(tmpdir(), 'dsh-github-app-uninstall-'))
}

function makeProfile (root: string): string {
  const profile = join(root, 'profile')
  mkdirSync(profile, { recursive: true })

  return profile
}

function writeManifest (
  profileDir: string,
  dependencies: Record<string, string> = {},
  bundles: string[] = [],
): void {
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    dependencies,
    dsh: { profile: { bundles } },
  }))
}

function delay (ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor (condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now()

  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition was not met in time')
    await delay(5)
  }
}

describe('profileDeclaresPackage', () => {
  it('finds the package in dependencies', () => {
    const root = makeRoot()

    try {
      const profile = makeProfile(root)
      writeManifest(profile, { [PACKAGE_NAME]: '1.0.0' })

      expect(profileDeclaresPackage(profile)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('finds the package in devDependencies', () => {
    const root = makeRoot()

    try {
      const profile = makeProfile(root)

      writeFileSync(join(profile, 'package.json'), JSON.stringify({
        devDependencies: { [PACKAGE_NAME]: '1.0.0' },
      }))

      expect(profileDeclaresPackage(profile)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('finds the package in the bundle selection', () => {
    const root = makeRoot()

    try {
      const profile = makeProfile(root)
      writeManifest(profile, {}, [OTHER_PACKAGE, PACKAGE_NAME])

      expect(profileDeclaresPackage(profile)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports absence once dependency and bundle selection drop the package', () => {
    const root = makeRoot()

    try {
      const profile = makeProfile(root)
      writeManifest(profile, { [OTHER_PACKAGE]: '2.0.0' }, [OTHER_PACKAGE])

      expect(profileDeclaresPackage(profile)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports unknown for a missing or unreadable manifest', () => {
    const root = makeRoot()

    try {
      const profile = makeProfile(root)

      expect(profileDeclaresPackage(profile)).toBeNull()

      writeFileSync(join(profile, 'package.json'), '{not json')

      expect(profileDeclaresPackage(profile)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('removePluginArtifacts', () => {
  it('removes the plugin directory and legacy files', () => {
    const root = makeRoot()

    try {
      const env = { DSH_HOME: root }
      const dir = pluginDir(env)

      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'github.json'), '{}')
      writeFileSync(join(root, 'github.json'), '{}')
      writeFileSync(join(root, 'github-app.pem'), 'pem')
      writeFileSync(join(root, 'github-app.pem.enc'), 'envelope')

      expect(removePluginArtifacts(env)).toBe(true)
      expect(existsSync(dir)).toBe(false)
      expect(existsSync(join(root, 'github.json'))).toBe(false)
      expect(existsSync(join(root, 'github-app.pem'))).toBe(false)
      expect(existsSync(join(root, 'github-app.pem.enc'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves unrelated DSH home entries alone', () => {
    const root = makeRoot()

    try {
      const env = { DSH_HOME: root }
      const unrelated = join(root, 'profiles', 'web', 'package.json')

      mkdirSync(join(root, 'profiles', 'web'), { recursive: true })
      writeFileSync(unrelated, '{}')
      writeFileSync(join(root, 'other-plugin.json'), '{}')

      removePluginArtifacts(env)

      expect(existsSync(unrelated)).toBe(true)
      expect(existsSync(join(root, 'other-plugin.json'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports when there is nothing to remove', () => {
    const root = makeRoot()

    try {
      expect(removePluginArtifacts({ DSH_HOME: root })).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('watchForUninstallCleanup', () => {
  it('removes plugin data after the package stays absent', async () => {
    const root = makeRoot()
    let stop: (() => void) | undefined

    try {
      const profile = makeProfile(root)
      const dir = pluginDir({ DSH_HOME: root })

      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'github.json'), '{}')
      writeManifest(profile, { [PACKAGE_NAME]: '1.0.0' }, [PACKAGE_NAME])

      stop = watchForUninstallCleanup({
        profileDir: profile,
        env: { DSH_HOME: root },
        intervalMs: 5,
        confirmations: 2,
        timeoutMs: 1000,
      })

      writeManifest(profile)

      await waitFor(() => !existsSync(dir))
    } finally {
      stop?.()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps data while the manifest still declares the package', async () => {
    const root = makeRoot()
    let stop: (() => void) | undefined

    try {
      const profile = makeProfile(root)
      const dir = pluginDir({ DSH_HOME: root })

      mkdirSync(dir, { recursive: true })
      writeManifest(profile, { [PACKAGE_NAME]: '1.0.0' }, [PACKAGE_NAME])

      stop = watchForUninstallCleanup({
        profileDir: profile,
        env: { DSH_HOME: root },
        intervalMs: 5,
        confirmations: 2,
        timeoutMs: 1000,
      })

      await delay(60)

      expect(existsSync(dir)).toBe(true)
    } finally {
      stop?.()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps data while the manifest is unreadable', async () => {
    const root = makeRoot()
    let stop: (() => void) | undefined

    try {
      const profile = makeProfile(root)
      const dir = pluginDir({ DSH_HOME: root })

      mkdirSync(dir, { recursive: true })
      writeFileSync(join(profile, 'package.json'), '{not json')

      stop = watchForUninstallCleanup({
        profileDir: profile,
        env: { DSH_HOME: root },
        intervalMs: 5,
        confirmations: 2,
        timeoutMs: 1000,
      })

      await delay(60)

      expect(existsSync(dir)).toBe(true)
    } finally {
      stop?.()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('resets the absence streak when the package reappears', async () => {
    const root = makeRoot()
    let stop: (() => void) | undefined

    try {
      const profile = makeProfile(root)
      const dir = pluginDir({ DSH_HOME: root })

      mkdirSync(dir, { recursive: true })
      writeManifest(profile, { [PACKAGE_NAME]: '1.0.0' }, [PACKAGE_NAME])

      stop = watchForUninstallCleanup({
        profileDir: profile,
        env: { DSH_HOME: root },
        intervalMs: 10,
        confirmations: 4,
        timeoutMs: 1000,
      })

      writeManifest(profile)

      await delay(25)
      writeManifest(profile, { [PACKAGE_NAME]: '1.0.1' }, [PACKAGE_NAME])
      await delay(90)

      expect(existsSync(dir)).toBe(true)
    } finally {
      stop?.()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stops without deleting when cancelled', async () => {
    const root = makeRoot()
    let stop: (() => void) | undefined

    try {
      const profile = makeProfile(root)
      const dir = pluginDir({ DSH_HOME: root })

      mkdirSync(dir, { recursive: true })
      writeManifest(profile, { [PACKAGE_NAME]: '1.0.0' }, [PACKAGE_NAME])

      stop = watchForUninstallCleanup({
        profileDir: profile,
        env: { DSH_HOME: root },
        intervalMs: 5,
        confirmations: 2,
        timeoutMs: 1000,
      })

      stop()
      writeManifest(profile)

      await delay(50)

      expect(existsSync(dir)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
