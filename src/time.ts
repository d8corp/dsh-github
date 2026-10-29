/**
 * Parse an ISO-8601 timestamp (or epoch milliseconds) into epoch milliseconds.
 *
 * @param value candidate timestamp.
 * @returns epoch milliseconds, or null when missing, unparsable or negative.
 */
export function parseTimestamp (value: unknown): number | null {
  let ms: number

  if (typeof value === 'number') {
    ms = value
  } else if (typeof value === 'string' && value.trim() !== '') {
    ms = Date.parse(value)
  } else {
    return null
  }

  return Number.isFinite(ms) && ms >= 0 ? ms : null
}
