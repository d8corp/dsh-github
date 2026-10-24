// SPDX-License-Identifier: MIT
// @d8corp/dsh-github — browser half: the Settings → GitHub section.

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type * as ReactTypes from 'react'

import { Settings } from './components'
import { setReact } from './utils'

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

window.__ModuleLoader__.load({
  id: '@d8corp/dsh-github',
  factory: (require) => {
    setReact(require('react'))

    // #region styles
    const STYLE_ID = '@d8corp/dsh-github/settings.css'

    const CSS = `
.gh-section{display:flex;flex-direction:column;width:100%;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.gh-row{border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;align-items:center;gap:8px;padding:16px 0}
.gh-row:last-of-type{border-bottom:none}
.gh-text{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px}
.gh-titleRow{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.gh-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.gh-badge{display:inline-flex;align-items:center;gap:5px;flex:none;border:.5px solid transparent;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px;white-space:nowrap}
.gh-badge-missing{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.gh-badge-pending{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-label-caption);color:var(--dsw-alias-label-secondary)}
.gh-badge-connected{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.gh-dot{width:6px;height:6px;flex:none;border-radius:50%;background:currentColor}
.gh-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px;white-space:pre-line}
.gh-desc code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}
.gh-control{display:flex;align-items:center;gap:8px;flex:none;min-width:0}
.gh-input{box-sizing:border-box;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:36px;max-width:320px;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;padding:0 14px}
.gh-input:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gh-input:disabled{cursor:default;opacity:.5}
.gh-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.gh-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;border-radius:var(--dsw-radius-md);border:none;padding:0 14px;font:inherit;font-size:14px;line-height:22px;cursor:pointer;white-space:nowrap}
.gh-button:disabled{opacity:.4;cursor:default}
.gh-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.gh-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.gh-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.gh-secondary{border:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary)}
.gh-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gh-fileInput{font-size:12px;color:var(--dsw-alias-label-secondary)}
.gh-fileInput::file-selector-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);padding:0 10px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;margin-right:8px}
.gh-fileInput::file-selector-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gh-fileInput:disabled::file-selector-button{opacity:.4;cursor:default}
.gh-notice{margin:0;font-size:12px;line-height:18px;padding:8px 12px;border-radius:var(--dsw-radius-md)}
.gh-notice-success{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-success-primary)}
.gh-notice-error{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-error-primary)}
.gh-loading{border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);padding:16px 0;font-size:12px;line-height:18px}
@media (max-width:640px){
.gh-row{flex-wrap:wrap}
.gh-text{padding-right:0;flex-basis:100%}
.gh-control{width:100%;align-items:stretch}
.gh-input{width:100%;max-width:none}
}
`

    function ensureStyles (): void {
      if (typeof document === 'undefined' || !document.head) return
      if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@d8corp/dsh-github'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    ensureStyles()
    // #endregion

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
