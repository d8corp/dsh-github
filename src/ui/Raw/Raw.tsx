import type * as ReactTypes from 'react'

export interface RowProps {
  title: string
  description?: string
  control: ReactTypes.ReactNode
  badge?: ReactTypes.ReactNode
}

export function Row ({ title, description, control, badge }: RowProps) {
  return (
    <div className='gh-row'>
      <div className='gh-text'>
        <div className='gh-titleRow'>
          <span className='gh-title'>{title}</span>
          {badge || null}
        </div>
        {description ? <div className='gh-desc'>{description}</div> : null}
      </div>
      <div className='gh-control'>{control}</div>
    </div>
  )
}
