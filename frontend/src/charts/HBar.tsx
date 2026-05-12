interface BarItem {
  label: string
  value: number
  color?: string
  suffix?: string
}

interface Props {
  items: BarItem[]
  max?: number
  color?: string
  height?: number
  format?: (v: number) => string | number
}

export function HBar({ items, max, color = 'var(--ink)', height = 18, format = (v) => v }: Props) {
  const m = max ?? Math.max(...items.map(i => Math.abs(i.value)))
  return (
    <div>
      {items.map((it, i) => {
        const w   = Math.abs(it.value) / m * 100
        const neg = it.value < 0
        const c   = it.color ?? (neg ? 'var(--m2)' : color)
        return (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '140px 1fr 60px',
            alignItems: 'center', gap: 12, padding: '6px 0',
            borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
          }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>{it.label}</div>
            <div style={{ position: 'relative', height }}>
              <div style={{
                position: 'absolute',
                left: 0,
                top: 0, height, width: `${w}%`,
                background: c, opacity: 0.85,
              }} />
            </div>
            <div className="num" style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'right' }}>
              {format(it.value)}{it.suffix ?? ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}
