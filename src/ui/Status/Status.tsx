export interface StatusProps {
  state: string
  label: string
}

export function Status ({ state, label }: StatusProps) {
  return (
    <span className={'gh-badge gh-badge-' + state}>
      <span className='gh-dot' />
      {label}
    </span>
  )
}
