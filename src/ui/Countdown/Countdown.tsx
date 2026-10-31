import { useEffect, useRef, useState } from 'react'

import { formatRemaining, tokenLevel } from '../../utils'

export interface CountdownProps {
  expiresAt: number | null
  onExpired?: () => void
}

/** Live `mm:ss` / `h:mm:ss` timer for the installation token lifetime. */
export function Countdown ({ expiresAt, onExpired }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now())
  const expiredRef = useRef<number | null>(null)

  useEffect(() => {
    setNow(Date.now())

    if (expiresAt === null) return

    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [expiresAt])

  const remaining = expiresAt === null ? null : expiresAt - now

  useEffect(() => {
    if (remaining === null || remaining > 0) return
    if (expiredRef.current === expiresAt) return

    expiredRef.current = expiresAt

    if (onExpired) onExpired()
  }, [expiresAt, remaining])

  if (remaining === null) return null

  const level = tokenLevel(remaining)
  const levelClass = level === 'soon' ? 'gh-timer-soon' : level === 'expired' ? 'gh-timer-expired' : 'gh-timer-valid'

  return <span className={'gh-timer ' + levelClass}>{formatRemaining(remaining)}</span>
}
