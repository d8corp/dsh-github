/**
 * Shapes shared by the host API and the browser settings UI.
 *
 * Type-only: importing this module never adds runtime code to either bundle.
 */

export interface ToolStatus {
  installed: boolean
  version: string | null
}

export interface GitIdentity {
  name: string
  email: string
}

export interface StatusAuth {
  loggedIn: boolean
  gitConfigured: boolean
  error?: string
}

export interface StatusConfig {
  appId: string
  installationId: string
  gitUserName: string
  gitUserEmail: string
  keyFileName: string | null
  hasKey: boolean
}

export interface StatusToken {
  issuedAt: number | null
  expiresAt: number | null
  ttlSeconds: number
  active: boolean
}

export interface StatusPayload {
  gh: ToolStatus
  git: ToolStatus
  config: StatusConfig
  auth: StatusAuth
  token: StatusToken
  gitIdentity: GitIdentity
}
