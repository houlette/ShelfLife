import type { CSSProperties, ReactNode } from 'react'

interface Props {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  mono?: boolean
  style?: CSSProperties
}

export function Pill({ children, active, onClick, mono, style }: Props) {
  return (
    <button
      onClick={onClick}
      className={mono ? 'mono' : undefined}
      style={{
        background:  active ? 'var(--ink)' : 'transparent',
        color:       active ? 'var(--paper)' : 'var(--ink-soft)',
        border:      '1px solid ' + (active ? 'var(--ink)' : 'var(--line)'),
        padding:     '5px 10px',
        fontSize:    12,
        cursor:      'pointer',
        borderRadius: 2,
        letterSpacing: mono ? '-0.02em' : '0',
        transition:  'all 120ms ease',
        fontFamily:  'inherit',
        ...style,
      }}
    >
      {children}
    </button>
  )
}
