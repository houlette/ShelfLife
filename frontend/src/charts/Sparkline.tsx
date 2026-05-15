interface Props {
  values: (number | null | undefined)[]
  height?: number
  color?: string
  area?: boolean
  width?: number
}

export function Sparkline({ values, height = 28, color = 'var(--ink)', area = true, width = 120 }: Props) {
  if (!values?.length) return null
  const valid = values.filter((v): v is number => v != null && !isNaN(v))
  if (!valid.length) return null

  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const range = (max - min) || 1

  const Y = (v: number) => (1 - (v - min) / range) * (height - 4) + 2

  let path = '', areaPath = ''
  let started = false
  values.forEach((v, i) => {
    if (v == null || isNaN(v)) return
    const x = (i / (values.length - 1)) * (width - 2) + 1
    const y = Y(v)
    if (!started) {
      path     += `M${x},${y}`
      areaPath += `M${x},${height}L${x},${y}`
      started = true
    } else {
      path     += `L${x},${y}`
      areaPath += `L${x},${y}`
    }
  })
  areaPath += `L${width - 1},${height}Z`

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      {area && <path d={areaPath} fill={color} fillOpacity={0.10} />}
      <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
