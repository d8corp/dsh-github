import type * as ReactTypes from 'react'

import { getReact } from '../../utils'

export interface ButtonProps {
  children: ReactTypes.ReactNode
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  onClick?: () => void
}

export function Button ({ children, variant = 'primary', disabled, onClick }: ButtonProps) {
  const React = getReact()

  return (
    <button
      className={'gh-button gh-' + variant}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
