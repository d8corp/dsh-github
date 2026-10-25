/**
 * @jest-environment node
 */
import {
  formatRemaining,
  resolveTokenExpiry,
  TOKEN_SOON_MS,
  tokenLevel,
} from '../src/utils/countdown'
import {
  readStoredIssuedAt,
  STORAGE_KEY,
  type StorageLike,
  storeIssuedAt,
} from '../src/utils/tokenStorage'

function createStorage (initial?: Record<string, string>): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>(Object.entries(initial || {}))

  return {
    values,
    getItem: (key: string) => (values.has(key) ? values.get(key) as string : null),
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

function createThrowingStorage (): StorageLike {
  const fail = (): never => {
    throw new Error('storage unavailable')
  }

  return {
    getItem: fail,
    setItem: fail,
    removeItem: fail,
  }
}

describe('formatRemaining', () => {
  it('formats a full hour as h:mm:ss', () => {
    expect(formatRemaining(3_600_000)).toBe('1:00:00')
  })

  it('formats just under an hour as mm:ss', () => {
    expect(formatRemaining(3_599_000)).toBe('59:59')
  })

  it('zero-pads minutes and seconds', () => {
    expect(formatRemaining(61_000)).toBe('01:01')
  })

  it('clamps zero and negative values to 00:00', () => {
    expect(formatRemaining(0)).toBe('00:00')
    expect(formatRemaining(-1)).toBe('00:00')
    expect(formatRemaining(-90_000)).toBe('00:00')
  })

  it('rounds partial seconds up', () => {
    expect(formatRemaining(999)).toBe('00:01')
    expect(formatRemaining(1)).toBe('00:01')
  })

  it('keeps the hour form past one hour', () => {
    expect(formatRemaining(3_661_000)).toBe('1:01:01')
    expect(formatRemaining(7_200_000)).toBe('2:00:00')
  })
})

describe('tokenLevel', () => {
  it('reports unknown for missing or unreadable remaining time', () => {
    expect(tokenLevel(null)).toBe('unknown')
    expect(tokenLevel(undefined)).toBe('unknown')
    expect(tokenLevel(Number.NaN)).toBe('unknown')
  })

  it('reports expired at and below zero', () => {
    expect(tokenLevel(0)).toBe('expired')
    expect(tokenLevel(-1)).toBe('expired')
  })

  it('reports soon below the threshold only', () => {
    expect(tokenLevel(TOKEN_SOON_MS)).toBe('valid')
    expect(tokenLevel(TOKEN_SOON_MS - 1)).toBe('soon')
    expect(tokenLevel(1)).toBe('soon')
  })

  it('reports valid above the threshold', () => {
    expect(tokenLevel(60 * 60 * 1000)).toBe('valid')
  })
})

describe('resolveTokenExpiry', () => {
  it('prefers the host expiry', () => {
    expect(resolveTokenExpiry(1_700_000_000_000, 1_600_000_000_000, 3_600_000)).toBe(1_700_000_000_000)
  })

  it('ignores a non-positive host expiry in favour of the local issue time', () => {
    expect(resolveTokenExpiry(0, 1_600_000_000_000, 3_600_000)).toBe(1_600_003_600_000)
    expect(resolveTokenExpiry(Number.NaN, 1_600_000_000_000, 3_600_000)).toBe(1_600_003_600_000)
  })

  it('falls back to the issue time plus ttl', () => {
    expect(resolveTokenExpiry(null, 1_600_000_000_000, 3_600_000)).toBe(1_600_003_600_000)
  })

  it('returns null when neither source is usable', () => {
    expect(resolveTokenExpiry(null, null, 3_600_000)).toBeNull()
    expect(resolveTokenExpiry(undefined, undefined, 3_600_000)).toBeNull()
    expect(resolveTokenExpiry(0, 0, 3_600_000)).toBeNull()
  })
})

describe('tokenStorage', () => {
  it('round-trips the issue time', () => {
    const storage = createStorage()
    const now = 1_600_000_000_000

    storeIssuedAt(now - 1000, storage)

    expect(storage.values.get(STORAGE_KEY)).toBe(String(now - 1000))
    expect(readStoredIssuedAt(storage, now)).toBe(now - 1000)
  })

  it('floors fractional values', () => {
    const storage = createStorage()

    storeIssuedAt(1234.9, storage)

    expect(readStoredIssuedAt(storage, 10_000)).toBe(1234)
  })

  it('rejects corrupt text without throwing', () => {
    const storage = createStorage({ [STORAGE_KEY]: 'not-a-number' })

    expect(readStoredIssuedAt(storage, 1_600_000_000_000)).toBeNull()
  })

  it('rejects a future timestamp beyond the clock skew slack', () => {
    const now = 1_600_000_000_000
    const storage = createStorage({ [STORAGE_KEY]: String(now + 120_000) })

    expect(readStoredIssuedAt(storage, now)).toBeNull()
  })

  it('accepts a timestamp within the clock skew slack', () => {
    const now = 1_600_000_000_000
    const storage = createStorage({ [STORAGE_KEY]: String(now + 30_000) })

    expect(readStoredIssuedAt(storage, now)).toBe(now + 30_000)
  })

  it('rejects non-positive timestamps', () => {
    const storage = createStorage({ [STORAGE_KEY]: '0' })

    expect(readStoredIssuedAt(storage, Date.now())).toBeNull()
  })

  it('reads null when the key is missing', () => {
    expect(readStoredIssuedAt(createStorage(), Date.now())).toBeNull()
  })

  it('clears the key on null', () => {
    const storage = createStorage({ [STORAGE_KEY]: '1234' })

    storeIssuedAt(null, storage)

    expect(storage.values.has(STORAGE_KEY)).toBe(false)
    expect(readStoredIssuedAt(storage, Date.now())).toBeNull()
  })

  it('tolerates a throwing storage', () => {
    const storage = createThrowingStorage()

    expect(readStoredIssuedAt(storage, Date.now())).toBeNull()
    expect(() => storeIssuedAt(1234, storage)).not.toThrow()
    expect(() => storeIssuedAt(null, storage)).not.toThrow()
  })

  it('returns null when no storage is available', () => {
    expect(readStoredIssuedAt(null, Date.now())).toBeNull()
    expect(() => storeIssuedAt(1234, null)).not.toThrow()
  })
})
