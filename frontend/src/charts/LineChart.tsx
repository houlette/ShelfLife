import { useRef, useState, useEffect } from 'react'
import { rolling, mean } from '../utils'

/** Round up to a "nice" whole-number step for axis ticks. */
function niceStep(range: number): number {
  if (range <= 0) return 1
  const raw  = range / 4
  const mag  = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const nice = norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10
  return Math.max(1, nice * mag)
}

/** Compact axis label: 50000 → "50k", 1500000 → "1500k", 500 → "500". */
function fmtTick(v: number): string {
  if (v >= 1000) return `${Math.round(v / 1000)}k`
  return String(v)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DataPoint = Record<string, any>

interface Props {
  data: DataPoint[]
  x?: string
  y: string
  height?: number
  color?: string
  area?: boolean
  fill?: string
  smoothWindow?: number
  showAxis?: boolean
  yDomain?: [number, number]
  xLabels?: boolean
}

export function LineChart({
  data,
  x = 'date',
  y,
  height = 180,
  color = 'var(--ink)',
  area = false,
  fill = 'rgba(0,0,0,0.05)',
  smoothWindow = 14,
  showAxis = true,
  yDomain,
  xLabels = true,
}: Props) {
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

  const padL = 44, padR = 8, padT = 12, padB = showAxis ? 24 : 8
  const innerW = w - padL - padR
  const innerH = height - padT - padB

  const rawY = data.map(d => d[y] as number | null)
  const ys   = rawY.filter((v): v is number => v != null && !isNaN(v))
  const yMin = yDomain ? yDomain[0] : Math.min(...ys)
  const yMax = yDomain ? yDomain[1] : Math.max(...ys)

  const xPos = (i: number) => padL + (i / (data.length - 1)) * innerW
  const yPos = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH

  const smoothed = smoothWindow > 1 ? rolling(rawY, smoothWindow, mean) : rawY

  let path = '', areaPath = ''
  let lastValid: number | null = null
  smoothed.forEach((v, i) => {
    if (v == null || isNaN(v)) return
    const X = xPos(i), Y = yPos(v)
    if (lastValid == null) {
      path     += `M${X},${Y}`
      areaPath += `M${X},${padT + innerH}L${X},${Y}`
    } else {
      path     += `L${X},${Y}`
      areaPath += `L${X},${Y}`
    }
    lastValid = i
  })
  if (lastValid != null) areaPath += `L${xPos(lastValid)},${padT + innerH}Z`

  // Nice integer ticks: step is a round number; start from 0 (or yDomain min).
  // Skip any tick that falls outside the data range so no line renders off-chart.
  const tickOrigin = yDomain ? yDomain[0] : 0
  const step = niceStep(yMax - tickOrigin)
  const yTicks: { v: number; y: number; label: string }[] = []
  for (let v = tickOrigin; v <= yMax + step * 0.001; v += step) {
    const rv = Math.round(v)
    if (rv > yMax) break
    if (rv < yMin) continue   // off the bottom of the chart — skip
    yTicks.push({ v: rv, y: yPos(rv), label: fmtTick(rv) })
  }

  const xLabs: { i: number; label: number }[] = []
  if (data.length > 1) {
    let lastYear: number | null = null
    let lastLabelX = -Infinity
    const MIN_GAP = 38  // px between label centres — keeps 4-digit years readable
    data.forEach((d, i) => {
      const yr = typeof d[x] === 'string' ? +String(d[x]).slice(0, 4) : null
      if (yr && yr !== lastYear) {
        lastYear = yr
        const xi = xPos(i)
        if (xi - lastLabelX >= MIN_GAP) {
          xLabs.push({ i, label: yr })
          lastLabelX = xi
        }
      }
    })
  }

  return (
    <div ref={ref} style={{ width: '100%', height, overflow: 'hidden' }}>
      <svg width={w} height={height}>
        {showAxis && yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={t.y} y2={t.y} stroke="var(--line-soft)" strokeWidth={0.5} />
            <text x={padL - 6} y={t.y + 3} textAnchor="end"
              style={{ fontSize: 9.5, fill: 'var(--muted)' }} fontFamily="JetBrains Mono">
              {t.label}
            </text>
          </g>
        ))}
        {showAxis && xLabels && xLabs.map((l, i) => (
          <text key={i} x={xPos(l.i)} y={height - 6}
            style={{ fontSize: 9.5, fill: 'var(--muted)' }} fontFamily="JetBrains Mono">
            {l.label}
          </text>
        ))}
        {area && <path d={areaPath} fill={fill} stroke="none" />}
        <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}
