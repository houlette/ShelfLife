import type { ReactNode, CSSProperties } from 'react'

interface CardProps {
  children: ReactNode
  style?: CSSProperties
  padding?: number
  span?: number
  title?: string
  eyebrow?: string
  action?: ReactNode
  bare?: boolean
  [key: string]: unknown
}

export function Card({ children, style, padding = 20, span, title, eyebrow, action, bare, ...rest }: CardProps) {
  const s: CSSProperties = {
    background:   bare ? 'transparent' : 'var(--paper)',
    border:       bare ? 'none' : '1px solid var(--line)',
    borderRadius: 4,
    padding:      bare ? 0 : padding,
    ...(span && span > 1 ? { gridColumn: `span ${span}` } : {}),
    ...style,
  }
  return (
    <div style={s} {...rest}>
      {(title || eyebrow || action) && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            {eyebrow && <div className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>}
            {title && <div className="serif" style={{ fontSize: 20, lineHeight: 1.15, color: 'var(--ink)' }}>{title}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number | null
  sub?: string
  color?: string
}

export function StatCard({ label, value, sub, color = 'var(--accent)' }: StatCardProps) {
  return (
    <div style={{
      background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 4, padding: 20,
    }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{label}</div>
      <div className="num" style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>
        {value ?? '—'}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  )
}
