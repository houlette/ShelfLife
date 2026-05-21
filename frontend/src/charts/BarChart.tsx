import { useRef, useState, useEffect } from 'react'

interface BarData {
  label: string
  value: number
  color?: string
}

interface Props {
  data: BarData[]
  height?: number
  color?: string
  showAxis?: boolean
  labelFilter?: (label: string, index: number) => boolean
}

export function BarChart({ data, height = 200, color = 'var(--accent)', showAxis = true, labelFilter }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)

  useEffect(() => {
    const measure = () => { if (ref.current) setW(ref.current.clientWidth) }
    measure()
    const ro = new ResizeObserver(measure)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  if (!data.length) return null

  const padL = 32, padR = 8, padT = 12, padB = showAxis ? 32 : 8
  const innerW = w - padL - padR
  const innerH = height - padT - padB

  const maxVal = Math.max(...data.map(d => d.value), 1)
  const barGap = 1
  const barW = Math.max(2, (innerW - barGap * (data.length - 1)) / data.length)

  const yTicks: { v: number; y: number }[] = []
  if (showAxis) {
    for (let i = 0; i <= 4; i++) {
      const v = maxVal * (i / 4)
      yTicks.push({ v, y: padT + (1 - i / 4) * innerH })
    }
  }

  return (
    <div ref={ref} style={{ width: '100%', height, overflow: 'hidden' }}>
      <svg width={w} height={height}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={t.y} y2={t.y} stroke="var(--line-soft)" strokeWidth={0.5} />
            <text x={padL - 6} y={t.y + 3} textAnchor="end"
              style={{ fontSize: 9.5, fill: 'var(--muted)' }} fontFamily="JetBrains Mono">
              {Math.round(t.v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * (barW + barGap)
          const h = (d.value / maxVal) * innerH
          return (
            <g key={i}>
              <rect
                x={x} y={padT + innerH - h}
                width={barW} height={h}
                fill={d.color ?? color} opacity={0.85}
              />
              {showAxis && (labelFilter ? labelFilter(d.label, i) : barW > 18) && (
                <text
                  x={x + barW / 2} y={height - 8}
                  textAnchor="middle"
                  style={{ fontSize: 9, fill: 'var(--muted)' }}
                  fontFamily="JetBrains Mono"
                >
                  {d.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
