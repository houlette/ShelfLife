import { useRef, useState, useEffect } from 'react'

function niceStep(range: number): number {
  if (range <= 0) return 1
  const raw  = range / 4
  const mag  = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const nice = norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10
  return Math.max(1, nice * mag)
}

function fmtTick(v: number): string {
  if (v >= 1000) return `${Math.round(v / 1000)}k`
  return String(v)
}

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

  const padL = 44, padR = 8, padT = 12, padB = showAxis ? 32 : 8
  const innerW = w - padL - padR
  const innerH = height - padT - padB

  const maxVal = Math.max(...data.map(d => d.value), 1)
  const barGap = 1
  const barW = Math.max(2, (innerW - barGap * (data.length - 1)) / data.length)

  const step = niceStep(maxVal)
  const yTicks: { v: number; label: string; y: number }[] = []
  if (showAxis) {
    for (let v = 0; v <= maxVal + step * 0.001; v += step) {
      const rv = Math.round(v)
      if (rv > maxVal) break
      yTicks.push({ v: rv, label: fmtTick(rv), y: padT + (1 - rv / maxVal) * innerH })
    }
  }

  // Pre-compute which x-labels to show, enforcing a minimum pixel gap so
  // labels never overlap regardless of bar density or labelFilter.
  const MIN_LABEL_GAP = 28
  const visibleLabelIdx = new Set<number>()
  if (showAxis) {
    let lastLabelX = -Infinity
    data.forEach((d, i) => {
      const passes = labelFilter ? labelFilter(d.label, i) : barW > 18
      if (passes) {
        const cx = padL + i * (barW + barGap) + barW / 2
        if (cx - lastLabelX >= MIN_LABEL_GAP) {
          visibleLabelIdx.add(i)
          lastLabelX = cx
        }
      }
    })
  }

  return (
    <div ref={ref} style={{ width: '100%', height, overflow: 'hidden' }}>
      <svg width={w} height={height}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={t.y} y2={t.y} stroke="var(--line-soft)" strokeWidth={0.5} />
            <text x={padL - 6} y={t.y + 3} textAnchor="end"
              style={{ fontSize: 9.5, fill: 'var(--muted)' }} fontFamily="JetBrains Mono">
              {t.label}
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
              {visibleLabelIdx.has(i) && (
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
