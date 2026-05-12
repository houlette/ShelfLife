import type { ReactNode } from 'react'

interface Props {
  content: ReactNode
  x: number
  y: number
  visible: boolean
}

export function Tooltip({ content, x, y, visible }: Props) {
  if (!visible) return null
  return (
    <div style={{
      position: 'fixed',
      left: x, top: y, transform: 'translate(-50%, -100%)',
      pointerEvents: 'none',
      background: 'var(--ink)',
      color: 'var(--paper)',
      padding: '8px 10px',
      borderRadius: 3,
      fontSize: 11,
      whiteSpace: 'nowrap',
      zIndex: 9999,
      boxShadow: '0 10px 24px -10px rgba(0,0,0,0.4)',
    }}>
      {content}
    </div>
  )
}
