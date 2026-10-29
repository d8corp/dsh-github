import type { ApiHandler } from './api'
import { createApiHandler } from './api'
import { API_PREFIX } from './constants'
import { buildTrustedHosts } from './fence'
import { migrateLegacyLayout } from './settings'

interface PluginContext {
  webStartup?: {
    trustedHosts?: unknown
  }
  webServer: {
    register (route: { kind: 'prefix', path: string, handler: ApiHandler }): unknown
  }
  effect (callback: () => unknown, label: string): unknown
}

export const name = 'github'

export const inject = ['webServer', 'webStartup']

export function apply (ctx: PluginContext): void {
  migrateLegacyLayout()

  const trustedHosts = buildTrustedHosts(ctx.webStartup?.trustedHosts, (message) => {
    // eslint-disable-next-line no-console
    console.warn('[@d8corp/dsh-github] ignoring invalid trusted host:', message)
  })

  const handler = createApiHandler(ctx, { trustedHosts })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler,
  }), '@d8corp/dsh-github: api')
}
