import { API_PREFIX } from './constants.js'
import { createApiHandler } from './api.js'
import { buildTrustedHosts } from './fence.js'

export const name = 'github'

export const inject = ['webServer', 'webStartup', 'credentials']

export function apply (ctx) {
  const trustedHosts = buildTrustedHosts(ctx.webStartup && ctx.webStartup.trustedHosts, (message) => {
    console.warn('[dsh-github] ignoring invalid trusted host:', message)
  })

  const handler = createApiHandler(ctx, { trustedHosts })
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler
  }), 'dsh-github: api')
}