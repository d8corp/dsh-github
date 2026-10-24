import { API_PREFIX } from '../constants'

export async function callApi (action: string, extra?: Record<string, unknown>): Promise<unknown> {
  const body = Object.assign({ action }, extra || {})

  const response = await fetch(API_PREFIX, {
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
