/** Minimal storage surface, satisfied by `localStorage` and by test fakes. */
export interface StorageLike {
  getItem (key: string): string | null
  setItem (key: string, value: string): void
  removeItem (key: string): void
}

export const STORAGE_KEY = 'dsh-github:token-issued-at'

/** Slack allowed for a clock that is slightly ahead of the stored timestamp. */
const CLOCK_SKEW_MS = 60 * 1000

function defaultStorage (): StorageLike | null {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

function resolveStorage (storage: StorageLike | null | undefined): StorageLike | null {
  return storage === undefined ? defaultStorage() : storage
}

/**
 * Reads the locally recorded issue time of the installation token.
 * Corrupt, missing, non-positive and future timestamps read as `null`.
 */
export function readStoredIssuedAt (storage?: StorageLike | null, now = Date.now()): number | null {
  const target = resolveStorage(storage)

  if (!target) return null

  try {
    const raw = target.getItem(STORAGE_KEY)

    if (raw === null) return null

    const value = Number(raw)

    if (!Number.isFinite(value) || value <= 0 || value > now + CLOCK_SKEW_MS) return null

    return value
  } catch {
    return null
  }
}

/** Records the issue time of the installation token; `null` clears it. */
export function storeIssuedAt (value: number | null, storage?: StorageLike | null): void {
  const target = resolveStorage(storage)

  if (!target) return

  try {
    if (value === null) {
      target.removeItem(STORAGE_KEY)

      return
    }

    target.setItem(STORAGE_KEY, String(Math.floor(value)))
  } catch {
    // storage can be unavailable (private mode, quota) — the timer degrades gracefully
  }
}
