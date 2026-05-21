import { useRef, useState, useEffect } from 'react'
import { rolling, mean } from '../utils'

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

  const padL = 32, padR = 8, padT = 12, padB = showAxis ? 24 : 8
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

  const yTicks: { v: number; y: number }[] = []
  for (let i = 0; i <= 4; i++) {
    const v = yMin + (yMax - yMin) * (i / 4)
    yTicks.push({ v, y: yPos(v) })
  }

  const xLabs: { i: number; label: number }[] = []
  let lastYear: number | null = null
  data.forEach((d, i) => {
    const yr = typeof d[x] === 'string' ? +String(d[x]).slice(0, 4) : null
    if (yr && yr !== lastYear) { xLabs.push({ i, label: yr }); lastYear = yr }
  })

  return (
    <div ref={ref} style={{ width: '100%', height, overflow: 'hidden' }}>
      <svg width={w} height={height}>
        {showAxis && yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={t.y} y2={t.y} stroke="var(--line-soft)" strokeWidth={0.5} />
            <text x={padL - 6} y={t.y + 3} textAnchor="end"
              style={{ fontSize: 9.5, fill: 'var(--muted)' }} fontFamily="JetBrains Mono">
              {Math.round(t.v * 10) / 10}
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
