import type * as ReactTypes from 'react'

import { getReact } from '../../utils'

export interface FileInputProps {
  onChange: (event: ReactTypes.ChangeEvent<HTMLInputElement>) => void
  accept?: string
  disabled?: boolean
}

export function FileInput ({ onChange, accept, disabled }: FileInputProps) {
  const React = getReact()

  return (
    <input
      className='gh-fileInput'
      type='file'
      accept={accept}
      disabled={disabled}
      onChange={onChange}
    />
  )
}
