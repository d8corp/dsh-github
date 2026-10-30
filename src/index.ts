import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ApiHandler } from './api'
import { createApiHandler } from './api'
import { API_PREFIX } from './constants'
import { buildTrustedHosts } from './fence'
import { migrateLegacyLayout } from './settings'
import {
  cancelUninstallCleanup,
  profileDeclaresPackage,
  watchForUninstallCleanup,
} from './uninstall'

interface PluginContext {
  baseUrl?: unknown
  webStartup?: {
    trustedHosts?: unknown
  }
  webServer: {
    register (route: { kind: 'prefix', path: string, handler: ApiHandler }): unknown
  }
  effect (callback: () => unknown, label: string): unknown
}

/**
 * Resolve the profile directory from the loader context. The loader sets
 * `baseUrl` to the directory of the profile configuration, which is also the
 * directory holding `package.json`.
 *
 * @param baseUrl context base URL, usually a `file:` URL.
 * @returns an absolute directory path, or null when it cannot be resolved.
 */
function resolveProfileDir (baseUrl: unknown): string | null {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') return null

  try {
    const value = baseUrl.startsWith('file:')
      ? fileURLToPath(new URL('.', baseUrl))
      : baseUrl

    return resolve(value)
  } catch {
    return null
  }
}

export const name = 'github'

export const inject = ['webServer', 'webStartup']

export function apply (ctx: PluginContext): void {
  // A new instance means any watcher from the previous one is moot.
  cancelUninstallCleanup()

  migrateLegacyLayout()

  const trustedHosts = buildTrustedHosts(ctx.webStartup?.trustedHosts, (message) => {
    // eslint-disable-next-line no-console
    console.warn('[dsh-github-app] ignoring invalid trusted host:', message)
  })

  const handler = createApiHandler(ctx, { trustedHosts })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler,
  }), 'dsh-github-app: api')

  const profileDir = resolveProfileDir(ctx.baseUrl)

  // Watch only a manifest that currently declares this package: a context
  // rooted elsewhere says nothing about our lifecycle and must never trigger
  // deletion of plugin data.
  if (profileDir !== null && profileDeclaresPackage(profileDir) === true) {
    const watchedProfileDir = profileDir

    ctx.effect(() => () => {
      watchForUninstallCleanup({ profileDir: watchedProfileDir })
    }, 'dsh-github-app: uninstall cleanup')
  }
}
