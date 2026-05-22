import { useRef, useState, useEffect } from 'react'

export interface StackedSegment {
  key: string
  value: number
  color: string
}

export interface StackedBarDatum {
  label: string
  segments: StackedSegment[]
}

interface Props {
  data: StackedBarDatum[]
  height?: number
  /** Show as percentages (default true) */
  percent?: boolean
}

export function StackedBarChart({ data, height = 200, percent = true }: Props) {
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

  const padL = 36, padR = 8, padT = 12, padB = 32
  const innerW = w - padL - padR
  const innerH = height - padT - padB

  const barGap = 2
  const barW = Math.max(2, (innerW - barGap * (data.length - 1)) / data.length)

  const yTicks = percent
    ? [0, 25, 50, 75, 100]
    : (() => {
        const maxVal = Math.max(...data.map(d => d.segments.reduce((s, seg) => s + seg.value, 0)), 1)
        const step = Math.ceil(maxVal / 4 / 10) * 10 || 1
        const ticks = []
        for (let v = 0; v <= maxVal; v += step) ticks.push(v)
        return ticks
      })()

  const maxY = percent ? 100 : Math.max(...data.map(d => d.segments.reduce((s, seg) => s + seg.value, 0)), 1)

  // Enforce minimum pixel gap so labels never overlap
  const MIN_LABEL_GAP = 28
  const visibleLabelIdx = new Set<number>()
  let lastLabelX = -Infinity
  data.forEach((d, i) => {
    const cx = padL + i * (barW + barGap) + barW / 2
    if (cx - lastLabelX >= MIN_LABEL_GAP) {
      visibleLabelIdx.add(i)
      lastLabelX = cx
    }
  })

  return (
    <div ref={ref} style={{ width: '100%', height, overflow: 'hidden' }}>
      <svg width={w} height={height}>
        {/* Grid lines */}
        {yTicks.map(v => {
          const y = padT + (1 - v / maxY) * innerH
          return (
            <g key={v}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="var(--line-soft)" strokeWidth={0.5} />
              <text x={padL - 4} y={y + 3} textAnchor="end"
                style={{ fontSize: 9.5, fill: 'var(--muted)' }} fontFamily="JetBrains Mono">
                {percent ? `${v}%` : String(v)}
              </text>
            </g>
          )
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const total = d.segments.reduce((s, seg) => s + seg.value, 0)
          const scale = percent ? 100 / (total || 1) : 1
          const x = padL + i * (barW + barGap)
          const cx = x + barW / 2
          let yOffset = padT + innerH

          return (
            <g key={d.label}>
              {d.segments.map(seg => {
                const segH = (seg.value * scale / maxY) * innerH
                yOffset -= segH
                return (
                  <rect
                    key={seg.key}
                    x={x} y={yOffset}
                    width={barW} height={segH}
                    fill={seg.color} opacity={0.85}
                  />
                )
              })}
              {visibleLabelIdx.has(i) && (
                <text
                  x={cx} y={height - 8}
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
