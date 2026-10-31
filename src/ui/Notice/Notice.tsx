export interface NoticeProps {
  kind: 'error' | 'success'
  text: string
}

export function Notice ({ kind, text }: NoticeProps) {
  return (
    <div className={'gh-notice gh-notice-' + kind} style={{ marginTop: '16px' }}>
      {text}
    </div>
  )
}
