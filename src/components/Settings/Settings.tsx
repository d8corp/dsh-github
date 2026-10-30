import type * as ReactTypes from 'react'

import { MIN_PASSPHRASE_CHARS, TOKEN_TTL_SECONDS } from '../../constants'
import type { StatusAuth, StatusConfig, StatusPayload, ToolStatus } from '../../contracts'
import { passphraseError } from '../../passphrase'
import { Button } from '../../ui/Button'
import { Countdown } from '../../ui/Countdown'
import { FileInput } from '../../ui/FileInput'
import { Input } from '../../ui/Input'
import { Notice } from '../../ui/Notice'
import { Row } from '../../ui/Raw'
import { Status } from '../../ui/Status'
import { callApi, errorMessage, getReact, resolveTokenExpiry } from '../../utils'

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
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [appId, setAppId] = useState('')
  const [installationId, setInstallationId] = useState('')
  const [gitUserName, setGitUserName] = useState('')
  const [gitUserEmail, setGitUserEmail] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const loadedRef = useRef(false)

  async function refresh (): Promise<void> {
    try {
      const value = await callApi('status') as StatusPayload | null
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

  function requirePassphrase (): boolean {
    const problem = passphraseError(passphrase)

    if (problem === null) return true

    setMessage({ kind: 'error', text: problem })

    return false
  }

  async function handleUpload (event: ReactTypes.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files && event.target.files[0]
    if (!file) return

    if (!requirePassphrase()) {
      event.target.value = ''

      return
    }

    await withBusy(async () => {
      const base64 = await readFileAsBase64(file)

      await callApi('saveConfig', {
        appId,
        installationId,
        pemBase64: base64,
        pemFileName: file.name,
        passphrase,
      })

      setMessage({ kind: 'success', text: 'Private key uploaded and encrypted.' })
    })

    event.target.value = ''
  }

  async function handleConnect (): Promise<void> {
    if (!requirePassphrase()) return

    await withBusy(async () => {
      const result = await callApi('connect', { passphrase }) as { connect?: GithubActionResult } | null

      if (result && result.connect && result.connect.ok === false) {
        throw new Error(result.connect.error || 'Connect failed.')
      }

      setPassphrase('')
      setMessage({ kind: 'success', text: 'Connected.' })
    })
  }

  async function handleDisconnect (): Promise<void> {
    await withBusy(async () => {
      await callApi('disconnect')
      setPassphrase('')
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

  const gh: ToolStatus = status?.gh ?? { installed: false, version: null }
  const git: ToolStatus = status?.git ?? { installed: false, version: null }
  const config: StatusConfig = status?.config ?? { hasKey: false, keyFileName: null, appId: '', installationId: '', gitUserName: '', gitUserEmail: '' }
  const auth: StatusAuth = status?.auth ?? { loggedIn: false, gitConfigured: false }
  const token = status?.token ?? null
  const toolsReady = gh.installed && git.installed
  const formDisabled = busy || !toolsReady
  const gitFieldsDisabled = busy || !git.installed

  const ttlSeconds = token !== null && Number.isFinite(token.ttlSeconds)
    ? token.ttlSeconds
    : TOKEN_TTL_SECONDS

  const hostIssuedAt = token !== null && Number.isFinite(token.issuedAt) ? token.issuedAt : null
  const hostExpiresAt = token !== null && Number.isFinite(token.expiresAt) ? token.expiresAt : null

  const tokenExpiresAt = auth.loggedIn
    ? resolveTokenExpiry(hostExpiresAt, hostIssuedAt, ttlSeconds * 1000)
    : null

  // CLI status
  let cliStateLabel = 'Ready'
  let cliStateClass = 'connected'

  if (!toolsReady) {
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

  if (!toolsReady) {
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
        disabled={formDisabled || !config.hasKey || !appId || !installationId}
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
            disabled={formDisabled}
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
            disabled={formDisabled}
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
            disabled={gitFieldsDisabled}
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
            disabled={gitFieldsDisabled}
            onChange={setGitUserEmail}
            placeholder='you@example.com'
          />
        )}
      />
      <Row
        key='passphrase'
        title='Key passphrase'
        description='Encrypts the private key at rest. It is never stored and is required for upload and every connect.'
        control={(
          <Input
            type='password'
            value={passphrase}
            disabled={busy}
            onChange={setPassphrase}
            placeholder={'At least ' + MIN_PASSPHRASE_CHARS + ' characters'}
          />
        )}
      />
      <Row
        key='key'
        title='Private key (.pem)'
        description={!config.hasKey
          ? 'Upload the GitHub App private key'
          : 'Key uploaded and encrypted' + (config.keyFileName ? ' (' + config.keyFileName + ')' : '')}
        control={(
          <FileInput
            accept='.pem'
            disabled={formDisabled}
            onChange={handleUpload}
          />
        )}
      />
      <Row
        key='actions'
        title='Connection'
        description={connDesc}
        badge={<Status state={connStateClass} label={connStateLabel} />}
        control={(
          <>
            <Countdown expiresAt={tokenExpiresAt} onExpired={refresh} />
            {connectionControl}
          </>
        )}
      />
      {message ? <Notice kind={message.kind} text={message.text} /> : null}
    </div>
  )
}
