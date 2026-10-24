// SPDX-License-Identifier: MIT
// @d8corp/dsh-github — browser half: the Settings → GitHub section.

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type * as ReactTypes from 'react'

import { Settings } from './components'
import { ensureStyles, setReact } from './utils'

interface DshModuleLoader {
  load (module: {
    id: string
    factory: (require: (id: string) => typeof ReactTypes) => unknown
  }): void
}

declare global {
  interface Window {
    __ModuleLoader__: DshModuleLoader
  }
}

const PLUGIN_ID = '@d8corp/dsh-github'

window.__ModuleLoader__.load({
  id: PLUGIN_ID,
  factory: (require) => {
    setReact(require('react'))
    ensureStyles(PLUGIN_ID)

    return {
      apply (ctx: Context) {
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
      },
      inject: ['slots'],
    }
  },
})
