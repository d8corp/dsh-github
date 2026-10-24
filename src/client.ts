// SPDX-License-Identifier: MIT
// dsh-github — browser half: the Settings → GitHub section.

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type * as ReactTypes from 'react'

interface DshModuleLoader {
  load (module: {
    id: string
    factory: (require: (id: string) => unknown) => unknown
  }): void
}

declare global {
  interface Window {
    __ModuleLoader__: DshModuleLoader
  }
}

interface GithubToolState {
  installed: boolean
  version: string | null
}

interface GithubConfigState {
  appId: string
  installationId: string
  gitUserName: string
  gitUserEmail: string
  keyFileName: string | null
  hasKey: boolean
}

interface GithubAuthState {
  loggedIn: boolean
  gitConfigured: boolean
  error?: string
}

interface GithubIdentityState {
  name: string
  email: string
}

interface GithubStatus {
  gh: GithubToolState
  git: GithubToolState
  gitInfo?: GithubToolState
  config: GithubConfigState
  auth: GithubAuthState
  gitIdentity: GithubIdentityState
}

interface GithubActionResult {
  ok?: boolean
  error?: string
}

interface GithubMessage {
  kind: 'error' | 'success'
  text: string
}

interface GithubSettingsRowOptions {
  key: string
  title: string
  description?: string
  control: ReactTypes.ReactNode
  badge?: ReactTypes.ReactNode
}

window.__ModuleLoader__.load({
  id: 'dsh-github',
  factory: (require) => {
    const React = require('react') as typeof ReactTypes
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    function errorMessage (error: unknown, fallback: string): string {
      return error instanceof Error && error.message ? error.message : fallback
    }

    // #region constants
    const API_URL = '/github/api'
    const SECTION_ID = 'github'
    const SECTION_ORDER = 40
    const SECTION_LABEL = 'GitHub'
    // #endregion

    // #region host API
    async function callApi (action: string, extra?: Record<string, unknown>): Promise<unknown> {
      const body = Object.assign({ action }, extra || {})

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })

      let payload: unknown = null

      try {
        payload = await response.json()
      } catch {
        payload = null
      }

      const record = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : null

      if (record && record.ok === false) {
        const error = record.error as { message?: unknown } | undefined

        const msg = error && typeof error.message === 'string'
          ? error.message
          : 'Request failed'

        throw new Error(msg)
      }

      if (!response.ok) throw new Error('GitHub request failed (HTTP ' + response.status + ').')
      if (!record) throw new Error('Unreadable response.')

      return Object.prototype.hasOwnProperty.call(record, 'value') ? record.value : record
    }

    function readFileAsBase64 (file: File): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()

        reader.onload = () => {
          const result = String(reader.result || '')
          const base64 = result.includes(',') ? result.split(',')[1] : result
          resolve(base64)
        }

        reader.onerror = () => reject(reader.error || new Error('File read failed'))
        reader.readAsDataURL(file)
      })
    }
    // #endregion

    // #region styles
    const STYLE_ID = '@dsh-github/settings.css'

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
.gh-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
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
      tag.dataset.plugin = 'dsh-github'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    ensureStyles()
    // #endregion

    // #region component helpers
    function settingsRow ({ key, title, description, control, badge }: GithubSettingsRowOptions): ReactTypes.ReactNode {
      return h(
        'div',
        { key, className: 'gh-row' },
        h(
          'div',
          { className: 'gh-text' },
          h('div', { className: 'gh-titleRow' }, h('span', { className: 'gh-title' }, title), badge || null),
          description ? h('div', { className: 'gh-desc' }, description) : null,
        ),
        h('div', { className: 'gh-control' }, control),
      )
    }

    function statusBadge (state: string, label: string): ReactTypes.ReactNode {
      return h(
        'span',
        { className: 'gh-badge gh-badge-' + state },
        h('span', { className: 'gh-dot' }),
        label,
      )
    }
    // #endregion

    // #region main component
    function GitHubSection (): ReactTypes.ReactNode {
      const [loading, setLoading] = useState(true)
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState<GithubMessage | null>(null)
      const [status, setStatus] = useState<GithubStatus | null>(null)
      const [appId, setAppId] = useState('')
      const [installationId, setInstallationId] = useState('')
      const [gitUserName, setGitUserName] = useState('')
      const [gitUserEmail, setGitUserEmail] = useState('')
      const loadedRef = useRef(false)

      async function refresh (): Promise<void> {
        try {
          const value = await callApi('status') as GithubStatus | null
          setStatus(value)
          setAppId((value && value.config && value.config.appId) || '')
          setInstallationId((value && value.config && value.config.installationId) || '')
          setGitUserName((value && value.config && value.config.gitUserName) || (value && value.gitIdentity && value.gitIdentity.name) || '')
          setGitUserEmail((value && value.config && value.config.gitUserEmail) || (value && value.gitIdentity && value.gitIdentity.email) || '')
          loadedRef.current = true
        } catch (error) {
          setMessage({ kind: 'error', text: errorMessage(error, 'Failed to load status.') })
        } finally {
          setLoading(false)
        }
      }

      useEffect(() => {
        refresh()
      }, [])

      // auto-save text fields
      useEffect(() => {
        if (!loadedRef.current) return

        const timer = setTimeout(async () => {
          try {
            await callApi('saveConfig', { appId, installationId, gitUserName, gitUserEmail })
          } catch (error) {
            setMessage({ kind: 'error', text: errorMessage(error, 'Save failed.') })
          }
        }, 600)

        return () => clearTimeout(timer)
      }, [appId, installationId, gitUserName, gitUserEmail])

      async function withBusy (fn: () => Promise<void>): Promise<void> {
        setBusy(true)
        setMessage(null)

        try {
          await fn()
          await refresh()
        } catch (error) {
          setMessage({ kind: 'error', text: errorMessage(error, 'Action failed.') })
        } finally {
          setBusy(false)
        }
      }

      async function handleInstall (): Promise<void> {
        await withBusy(async () => {
          const result = await callApi('installGh') as { install?: GithubActionResult } | null

          if (result && result.install && result.install.ok === false) {
            throw new Error(result.install.error || 'Install failed.')
          }

          setMessage({ kind: 'success', text: 'Missing components installed.' })
        })
      }

      async function handleUpload (event: ReactTypes.ChangeEvent<HTMLInputElement>): Promise<void> {
        const file = event.target.files && event.target.files[0]
        if (!file) return

        await withBusy(async () => {
          const base64 = await readFileAsBase64(file)

          await callApi('saveConfig', {
            appId,
            installationId,
            pemBase64: base64,
            pemFileName: file.name,
          })

          setMessage({ kind: 'success', text: 'Private key uploaded.' })
        })

        event.target.value = ''
      }

      async function handleConnect (): Promise<void> {
        await withBusy(async () => {
          const result = await callApi('connect') as { connect?: GithubActionResult } | null

          if (result && result.connect && result.connect.ok === false) {
            throw new Error(result.connect.error || 'Connect failed.')
          }

          setMessage({ kind: 'success', text: 'Connected.' })
        })
      }

      async function handleDisconnect (): Promise<void> {
        await withBusy(async () => {
          await callApi('disconnect')
          setMessage({ kind: 'success', text: 'Disconnected.' })
        })
      }

      if (loading) {
        return h('div', { className: 'gh-section' }, h('div', { className: 'gh-loading' }, 'Loading…'))
      }

      const gh = (status && status.gh) || { installed: false, version: null }
      const git = (status && (status.git || status.gitInfo)) || { installed: false, version: null }
      const config = (status && status.config) || { hasKey: false, keyFileName: null, appId: '', installationId: '', gitUserName: '', gitUserEmail: '' }
      const auth = (status && status.auth) || { loggedIn: false, gitConfigured: false }

      // CLI status
      let cliStateLabel = 'Ready'
      let cliStateClass = 'connected'

      if (!gh.installed || !git.installed) {
        cliStateLabel = 'Install required'
        cliStateClass = 'missing'
      }

      // Connection status
      let connStateLabel = 'Pending setup'
      let connStateClass = 'pending'

      if (auth.loggedIn) {
        connStateLabel = 'Connected'
        connStateClass = 'connected'
      } else if (config.hasKey || auth.error) {
        connStateLabel = 'Disconnected'
        connStateClass = 'missing'
      }

      let connDesc = 'Authenticate GitHub CLI with a GitHub App'

      if (!auth.loggedIn && auth.error) {
        connDesc += '\n' + auth.error
      }

      const rows: ReactTypes.ReactNode[] = []

      // Status row
      rows.push(
        settingsRow({
          key: 'status',
          title: 'CLI status',
          description: (gh.installed ? 'GitHub version ' + (gh.version || 'unknown') : 'GitHub CLI is not installed') + '\n' + (git.installed ? 'Git version ' + (git.version || 'unknown') : 'Git is not installed'),
          badge: statusBadge(cliStateClass, cliStateLabel),
          control: (!gh.installed || !git.installed)
            ? h(
              'button',
              { className: 'gh-button gh-primary', disabled: busy, onClick: handleInstall },
              busy ? 'Installing…' : 'Install missing components',
            )
            : null,
        }),
      )

      // App ID
      rows.push(
        settingsRow({
          key: 'appId',
          title: 'App ID',
          description: 'Your GitHub App ID',
          control: h('input', {
            className: 'gh-input',
            type: 'text',
            value: appId,
            disabled: busy || !gh.installed || !git.installed,
            onChange: (e) => setAppId(e.target.value),
            placeholder: '123456',
          }),
        }),
      )

      // Installation ID
      rows.push(
        settingsRow({
          key: 'installationId',
          title: 'Installation ID',
          description: 'Your GitHub App installation ID',
          control: h('input', {
            className: 'gh-input',
            type: 'text',
            value: installationId,
            disabled: busy || !gh.installed || !git.installed,
            onChange: (e) => setInstallationId(e.target.value),
            placeholder: '12345678',
          }),
        }),
      )

      // Git user name
      rows.push(
        settingsRow({
          key: 'gitUserName',
          title: 'Git user name',
          description: 'Commit author name (git config --global user.name)',
          control: h('input', {
            className: 'gh-input',
            type: 'text',
            value: gitUserName,
            disabled: busy || !git.installed,
            onChange: (e) => setGitUserName(e.target.value),
            placeholder: 'Your Name',
          }),
        }),
      )

      // Git user email
      rows.push(
        settingsRow({
          key: 'gitUserEmail',
          title: 'Git user email',
          description: 'Commit author email (git config --global user.email)',
          control: h('input', {
            className: 'gh-input',
            type: 'email',
            value: gitUserEmail,
            disabled: busy || !git.installed,
            onChange: (e) => setGitUserEmail(e.target.value),
            placeholder: 'you@example.com',
          }),
        }),
      )

      // Private key
      rows.push(
        settingsRow({
          key: 'key',
          title: 'Private key (.pem)',
          description: config.hasKey
            ? 'Key uploaded' + (config.keyFileName ? ' (' + config.keyFileName + ')' : '')
            : 'Upload the GitHub App private key',
          control: h('input', {
            className: 'gh-fileInput',
            type: 'file',
            accept: '.pem',
            disabled: busy || !gh.installed || !git.installed,
            onChange: handleUpload,
          }),
        }),
      )

      // Actions row
      rows.push(
        h(
          'div',
          { key: 'actions', className: 'gh-row' },
          h(
            'div',
            { className: 'gh-text' },
            h('div', { className: 'gh-titleRow' },
              h('span', { className: 'gh-title' }, 'Connection'),
              statusBadge(connStateClass, connStateLabel),
            ),
            h('div', { className: 'gh-desc' }, connDesc),
          ),
          h(
            'div',
            { className: 'gh-control' },
            h(
              'div',
              { className: 'gh-actions' },
              auth.loggedIn
                ? h(
                  'button',
                  {
                    className: 'gh-button gh-secondary',
                    disabled: busy || !gh.installed,
                    onClick: handleDisconnect,
                  },
                  busy ? 'Disconnecting…' : 'Disconnect',
                )
                : h(
                  'button',
                  {
                    className: 'gh-button gh-primary',
                    disabled: busy || !gh.installed || !git.installed || !config.hasKey || !appId || !installationId,
                    onClick: handleConnect,
                  },
                  busy ? 'Connecting…' : 'Connect',
                ),
            ),
          ),
        ),
      )

      return h(
        'div',
        { className: 'gh-section' },
        rows,
        message
          ? h(
            'div',
            { className: 'gh-notice gh-notice-' + message.kind, style: { marginTop: '16px' } },
            message.text,
          )
          : null,
      )
    }
    // #endregion

    // #region plugin registration
    function apply (ctx: Context): void {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: SECTION_ID,
            order: SECTION_ORDER,
            label: SECTION_LABEL,
          },
          GitHubSection,
        ),
      )
    }

    return {
      apply,
      inject: ['slots'],
    }
    // #endregion
  },
})
