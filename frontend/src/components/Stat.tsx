interface Props {
  label: string
  value: string | number | null | undefined
  unit?: string
  sub?: string
  align?: 'left' | 'center' | 'right'
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const SIZES = { sm: 24, md: 36, lg: 52, xl: 80 }

export function Stat({ label, value, unit, sub, align = 'left', size = 'lg' }: Props) {
  const fs = SIZES[size]
  return (
    <div style={{ textAlign: align }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="serif num" style={{ fontSize: fs, lineHeight: 0.95, color: 'var(--ink)', letterSpacing: '-0.03em' }}>
        {value ?? '—'}
        {unit && (
          <span style={{ fontSize: fs * 0.32, marginLeft: 4, color: 'var(--muted)', fontFamily: 'DM Sans', letterSpacing: 'normal' }}>
            {unit}
          </span>
        )}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{sub}</div>}
    </div>
  )
}
