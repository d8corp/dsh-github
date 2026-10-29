/** Time left before the token is considered "about to expire". */
export const TOKEN_SOON_MS = 5 * 60 * 1000

export type TokenLevel = 'unknown' | 'valid' | 'soon' | 'expired'

function pad2 (value: number): string {
  return value < 10 ? '0' + value : String(value)
}

/**
 * Formats the remaining lifetime as `mm:ss`, or `h:mm:ss` for an hour and more.
 * Non-positive and unreadable values render as `00:00`.
 */
export function formatRemaining (remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60

  if (totalSeconds >= 3600) {
    return Math.floor(totalSeconds / 3600) + ':' + pad2(minutes) + ':' + pad2(seconds)
  }

  return pad2(minutes) + ':' + pad2(seconds)
}

/** Classifies the remaining lifetime for styling and copy. */
export function tokenLevel (remainingMs: number | null | undefined): TokenLevel {
  if (remainingMs === null || remainingMs === undefined || !Number.isFinite(remainingMs)) {
    return 'unknown'
  }

  if (remainingMs <= 0) {
    return 'expired'
  }

  if (remainingMs < TOKEN_SOON_MS) {
    return 'soon'
  }

  return 'valid'
}

/**
 * Picks the expiry instant to count down to: the host-provided expiry wins,
 * otherwise the host-recorded issue time plus the known TTL.
 */
export function resolveTokenExpiry (
  hostExpiresAt: number | null | undefined,
  issuedAt: number | null | undefined,
  ttlMs: number,
): number | null {
  if (typeof hostExpiresAt === 'number' && Number.isFinite(hostExpiresAt) && hostExpiresAt > 0) {
    return hostExpiresAt
  }

  if (typeof issuedAt === 'number' && Number.isFinite(issuedAt) && issuedAt > 0) {
    return issuedAt + ttlMs
  }

  return null
}
