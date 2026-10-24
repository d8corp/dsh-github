import { getReact } from '../../utils'

export interface NoticeProps {
  kind: 'error' | 'success'
  text: string
}

export function Notice ({ kind, text }: NoticeProps) {
  const React = getReact()

  return (
    <div className={'gh-notice gh-notice-' + kind} style={{ marginTop: '16px' }}>
      {text}
    </div>
  )
}
