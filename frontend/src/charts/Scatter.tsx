import { useRef, useState, useEffect } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DataPoint = Record<string, any>

interface Props {
  data: DataPoint[]
  x: string
  y: string
  height?: number
  xLabel?: string
  yLabel?: string
  dotColor?: string
  dotAlpha?: number
  regression?: boolean
  onHover?: (d: DataPoint | null, e?: React.MouseEvent) => void
}

export function Scatter({
  data, x, y, height = 320, xLabel, yLabel,
  dotColor = 'var(--ink)', dotAlpha = 0.18, regression = true, onHover,
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

  const padL = 44, padR = 12, padT = 14, padB = 32
  const innerW = w - padL - padR
  const innerH = height - padT - padB

  const valid = data.filter(d => d[x] != null && d[y] != null && !isNaN(d[x] as number) && !isNaN(d[y] as number))
  if (!valid.length) return null

  const xs = valid.map(d => d[x] as number)
  const ys = valid.map(d => d[y] as number)
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const yMin = Math.min(...ys), yMax = Math.max(...ys)

  const X = (v: number) => padL + ((v - xMin) / (xMax - xMin)) * innerW
  const Y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH

  let regLine: { m: number; b: number } | null = null
  if (regression && valid.length > 5) {
    const n = valid.length
    let sx = 0, sy = 0, sxx = 0, sxy = 0
    valid.forEach(d => { sx += d[x] as number; sy += d[y] as number; sxx += (d[x] as number) ** 2; sxy += (d[x] as number) * (d[y] as number) })
    const m = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    const b = (sy - m * sx) / n
    regLine = { m, b }
  }

  const xTicks: number[] = [], yTicks: number[] = []
  for (let i = 0; i <= 4; i++) {
    xTicks.push(xMin + (xMax - xMin) * (i / 4))
    yTicks.push(yMin + (yMax - yMin) * (i / 4))
  }

  return (
    <div ref={ref} style={{ width: '100%', height, overflow: 'hidden' }}>
      <svg width={w} height={height}>
        {yTicks.map((t, i) => (
          <g key={'y' + i}>
            <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} stroke="var(--line-soft)" strokeWidth={0.5} />
            <text x={padL - 6} y={Y(t) + 3} textAnchor="end"
              style={{ fontSize: 9.5, fill: 'var(--muted)' }} fontFamily="JetBrains Mono">
              {Math.round(t * 10) / 10}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={'x' + i} x={X(t)} y={height - 12} textAnchor="middle"
            style={{ fontSize: 9.5, fill: 'var(--muted)' }} fontFamily="JetBrains Mono">
            {Math.round(t * 10) / 10}
          </text>
        ))}
        {valid.map((d, i) => (
          <circle key={i}
            cx={X(d[x] as number)} cy={Y(d[y] as number)} r={2.4}
            fill={dotColor} fillOpacity={dotAlpha}
            onMouseEnter={e => onHover?.(d, e)}
            onMouseLeave={() => onHover?.(null)}
          />
        ))}
        {regLine && (
          <line
            x1={X(xMin)} y1={Y(regLine.m * xMin + regLine.b)}
            x2={X(xMax)} y2={Y(regLine.m * xMax + regLine.b)}
            stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="3 3"
          />
        )}
        {xLabel && <text x={padL + innerW / 2} y={height - 1} textAnchor="middle"
          style={{ fontSize: 10.5, fill: 'var(--ink-soft)' }} fontFamily="DM Sans">{xLabel}</text>}
        {yLabel && <text x={12} y={padT + innerH / 2}
          transform={`rotate(-90 12 ${padT + innerH / 2})`} textAnchor="middle"
          style={{ fontSize: 10.5, fill: 'var(--ink-soft)' }} fontFamily="DM Sans">{yLabel}</text>}
      </svg>
    </div>
  )
}
