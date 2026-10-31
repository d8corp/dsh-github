// SPDX-License-Identifier: MIT
// dsh-github-app — browser half: the Settings → GitHub section.

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

import { Settings } from './components'
import { ensureStyles } from './utils'

const PLUGIN_ID = 'dsh-github-app'

export const inject = ['slots']

export function apply (ctx: Context): void {
  ensureStyles(PLUGIN_ID)

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'github',
        order: 40,
        label: 'GitHub',
      },
      Settings,
    ),
  )
}
