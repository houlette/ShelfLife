import type { ReactNode } from 'react'

interface Props {
  no?: string
  children: ReactNode
  sub?: string
  action?: ReactNode
}

export function SectionTitle({ no, children, sub, action }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
        {no && <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em' }}>{no}</div>}
        <div>
          <div className="serif" style={{ fontSize: 30, lineHeight: 1.05, color: 'var(--ink)', letterSpacing: '-0.015em' }}>
            {children}
          </div>
          {sub && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, maxWidth: 540 }}>{sub}</div>}
        </div>
      </div>
      {action}
    </div>
  )
}
