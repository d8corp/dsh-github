import type * as ReactTypes from 'react'

import { Button } from '../../ui/Button'
import { FileInput } from '../../ui/FileInput'
import { Input } from '../../ui/Input'
import { Notice } from '../../ui/Notice'
import { Row } from '../../ui/Raw'
import { Status } from '../../ui/Status'
import { callApi, errorMessage, getReact } from '../../utils'

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

export function Settings () {
  const React = getReact()
  const { useState, useEffect, useRef } = React
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
    return (
      <div className='gh-section'>
        <div className='gh-loading'>Loading…</div>
      </div>
    )
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

  let installControl: ReactTypes.ReactNode = null

  if (!gh.installed || !git.installed) {
    installControl = (
      <Button disabled={busy} onClick={handleInstall}>
        {busy ? 'Installing…' : 'Install missing components'}
      </Button>
    )
  }

  let connectionControl: ReactTypes.ReactNode

  if (auth.loggedIn) {
    connectionControl = (
      <Button
        variant='secondary'
        disabled={busy || !gh.installed}
        onClick={handleDisconnect}
      >
        {busy ? 'Disconnecting…' : 'Disconnect'}
      </Button>
    )
  } else {
    connectionControl = (
      <Button
        disabled={busy || !gh.installed || !git.installed || !config.hasKey || !appId || !installationId}
        onClick={handleConnect}
      >
        {busy ? 'Connecting…' : 'Connect'}
      </Button>
    )
  }

  return (
    <div className='gh-section'>
      <Row
        key='status'
        title='CLI status'
        description={(gh.installed ? 'GitHub version ' + (gh.version || 'unknown') : 'GitHub CLI is not installed') + '\n' + (git.installed ? 'Git version ' + (git.version || 'unknown') : 'Git is not installed')}
        badge={<Status state={cliStateClass} label={cliStateLabel} />}
        control={installControl}
      />
      <Row
        key='appId'
        title='App ID'
        description='Your GitHub App ID'
        control={(
          <Input
            value={appId}
            disabled={busy || !gh.installed || !git.installed}
            onChange={setAppId}
            placeholder='123456'
          />
        )}
      />
      <Row
        key='installationId'
        title='Installation ID'
        description='Your GitHub App installation ID'
        control={(
          <Input
            value={installationId}
            disabled={busy || !gh.installed || !git.installed}
            onChange={setInstallationId}
            placeholder='12345678'
          />
        )}
      />
      <Row
        key='gitUserName'
        title='Git user name'
        description='Commit author name (git config --global user.name)'
        control={(
          <Input
            value={gitUserName}
            disabled={busy || !git.installed}
            onChange={setGitUserName}
            placeholder='Your Name'
          />
        )}
      />
      <Row
        key='gitUserEmail'
        title='Git user email'
        description='Commit author email (git config --global user.email)'
        control={(
          <Input
            type='email'
            value={gitUserEmail}
            disabled={busy || !git.installed}
            onChange={setGitUserEmail}
            placeholder='you@example.com'
          />
        )}
      />
      <Row
        key='key'
        title='Private key (.pem)'
        description={config.hasKey
          ? 'Key uploaded' + (config.keyFileName ? ' (' + config.keyFileName + ')' : '')
          : 'Upload the GitHub App private key'}
        control={(
          <FileInput
            accept='.pem'
            disabled={busy || !gh.installed || !git.installed}
            onChange={handleUpload}
          />
        )}
      />
      <Row
        key='actions'
        title='Connection'
        description={connDesc}
        badge={<Status state={connStateClass} label={connStateLabel} />}
        control={connectionControl}
      />
      {message ? <Notice kind={message.kind} text={message.text} /> : null}
    </div>
  )
}
