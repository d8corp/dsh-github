export interface InputProps {
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'password'
  placeholder?: string
  disabled?: boolean
}

export function Input ({ value, onChange, type = 'text', placeholder, disabled }: InputProps) {
  return (
    <input
      className='gh-input'
      type={type}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
  )
}
