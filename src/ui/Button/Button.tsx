import type * as ReactTypes from 'react'

export interface ButtonProps {
  children: ReactTypes.ReactNode
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  onClick?: () => void
}

export function Button ({ children, variant = 'primary', disabled, onClick }: ButtonProps) {
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
