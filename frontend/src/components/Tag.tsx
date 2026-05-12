import type { ReactNode } from 'react'

type Tone = 'neutral' | 'pos' | 'neg' | 'accent'
type Size = 'xs' | 'sm'

const TONES: Record<Tone, { bg: string; border: string; color: string }> = {
  neutral: { bg: 'transparent', border: 'var(--line)', color: 'var(--ink-soft)' },
  pos:     { bg: 'color-mix(in srgb, var(--m5) 14%, transparent)', border: 'color-mix(in srgb, var(--m5) 30%, var(--line))', color: 'var(--m5)' },
  neg:     { bg: 'color-mix(in srgb, var(--m1) 14%, transparent)', border: 'color-mix(in srgb, var(--m1) 30%, var(--line))', color: 'var(--m1)' },
  accent:  { bg: 'color-mix(in srgb, var(--accent) 14%, transparent)', border: 'color-mix(in srgb, var(--accent) 30%, var(--line))', color: 'var(--accent)' },
}

interface Props {
  children: ReactNode
  tone?: Tone
  size?: Size
}

export function Tag({ children, tone = 'neutral', size = 'sm' }: Props) {
  const t = TONES[tone] ?? TONES.neutral
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: size === 'xs' ? '1px 6px' : '2px 8px',
      borderRadius: 999,
      border: '1px solid ' + t.border,
      background: t.bg,
      color: t.color,
      fontSize: size === 'xs' ? 10.5 : 11.5,
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}
