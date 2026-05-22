import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import type { Book } from '../types'

// ── Genre colour palette ──────────────────────────────────────────────────────
// Fixed hex values so they stay legible across all three themes.
const GENRE_COLORS: Record<string, string> = {
  'Fiction':           '#5b8dd9',
  'Sci-Fi':            '#9b72cf',
  'Mystery/Thriller':  '#d97b5b',
  'Biography/Memoir':  '#c8920a',
  'Non-fiction':       '#5fa888',
  'History':           '#c26b6b',
  'Science':           '#3bb0b0',
  'Business':          '#d4845a',
  'Fantasy':           '#7a9fd4',
  'Cookbooks':         '#d4a040',
  'Self-Help':         '#7ab87a',
  'Politics':          '#cd7474',
  'Philosophy':        '#9d85c2',
  'Horror':            '#a04040',
  'Historical Fiction':'#6a9ec8',
  'Romance':           '#c87878',
  'Poetry':            '#b89050',
  'Art':               '#78a870',
  "Children's":        '#e8a830',
  'Graphic Novel':     '#9870c0',
  'Essays':            '#60a8a8',
  'Drama':             '#b07850',
  'Religion':          '#a89860',
  'Travel':            '#60b090',
  'Other':             '#aaa49c',
}

function gc(genre: string): string {
  return GENRE_COLORS[genre] ?? GENRE_COLORS['Other']
}

// Seeded jitter — same seed always produces same offset, no layout shift on rerender
function jitter(seed: number): number {
  return (Math.sin(seed * 113.3) * 0.5 + Math.cos(seed * 337.7) * 0.5) * 3.5
}

function dotRadius(rating: number): number {
  return rating >= 5 ? 5.8 : rating >= 4 ? 4.5 : rating >= 3 ? 3.2 : 2.2
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Dot {
  title:     string
  author:    string | null
  pubYear:   number
  yearRead:  number
  rating:    number
  genre:     string
  idx:       number
}

interface Tip { dot: Dot; clientX: number; clientY: number }

interface Props { books: Book[] }

// ── Component ─────────────────────────────────────────────────────────────────

export function PubYearScatter({ books }: Props) {
  const wrapRef     = useRef<HTMLDivElement>(null)
  const [w, setW]   = useState(800)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [tip, setTip]       = useState<Tip | null>(null)

  // Responsive width
  useEffect(() => {
    const measure = () => { if (wrapRef.current) setW(wrapRef.current.clientWidth) }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  // ── Data ────────────────────────────────────────────────────────────────────
  const dots = useMemo<Dot[]>(() =>
    books
      .filter(b => b.exclusive_shelf === 'read' && b.date_read && b.original_pub_year)
      .map((b, idx) => ({
        title:    b.title,
        author:   b.author ?? null,
        pubYear:  b.original_pub_year!,
        yearRead: parseInt(b.date_read!.slice(0, 4), 10),
        rating:   b.my_rating ?? 0,
        genre:    b.genre ?? 'Other',
        idx,
      })),
    [books],
  )

  const genres = useMemo(() =>
    [...new Set(dots.map(d => d.genre))].sort(),
    [dots],
  )

  const genreCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of dots) m[d.genre] = (m[d.genre] ?? 0) + 1
    return m
  }, [dots])

  // ── Scales ──────────────────────────────────────────────────────────────────
  const PUB_LO  = 1970
  const PUB_HI  = useMemo(() => Math.max(...dots.map(d => d.pubYear),  new Date().getFullYear()), [dots])
  const READ_LO = useMemo(() => Math.min(...dots.map(d => d.yearRead)), [dots])
  const READ_HI = useMemo(() => Math.max(...dots.map(d => d.yearRead), new Date().getFullYear()) + 1, [dots])

  const PAD  = { t: 18, r: 20, b: 44, l: 52 }
  const H    = Math.round(w * 0.5)
  const IW   = w - PAD.l - PAD.r
  const IH   = H - PAD.t - PAD.b

  const sx = useCallback((v: number) => ((v - PUB_LO) / (PUB_HI - PUB_LO)) * IW,  [IW, PUB_LO, PUB_HI])
  const sy = useCallback((v: number) => IH - ((v - READ_LO) / (READ_HI - READ_LO)) * IH, [IH, READ_LO, READ_HI])

  const clippedCount = useMemo(() => dots.filter(d => d.pubYear < PUB_LO).length, [dots, PUB_LO])

  // ── Grid ticks ──────────────────────────────────────────────────────────────
  const xTicks: number[] = []
  for (let yr = Math.ceil(PUB_LO / 5) * 5; yr <= PUB_HI; yr += 5) xTicks.push(yr)

  const yTicks: number[] = []
  for (let yr = READ_LO; yr <= READ_HI; yr++) yTicks.push(yr)

  // ── Legend interaction ───────────────────────────────────────────────────────
  function toggleGenre(g: string) {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g); else next.add(g)
      return next
    })
  }

  // ── Tooltip helpers ──────────────────────────────────────────────────────────
  const TIP_W = 220
  function tipLeft(cx: number) { return cx + 16 + TIP_W > window.innerWidth - 8 ? cx - TIP_W - 16 : cx + 16 }
  function tipTop(cy: number, tipH = 110) { return cy - 10 + tipH > window.innerHeight - 8 ? cy - tipH - 10 : cy - 10 }

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!dots.length) return null

  return (
    <div>
      {/* Genre legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 16 }}>
        {genres.map(g => (
          <button
            key={g}
            onClick={() => toggleGenre(g)}
            style={{
              display:     'flex',
              alignItems:  'center',
              gap:         5,
              border:      'none',
              background:  'none',
              cursor:      'pointer',
              padding:     '2px 6px 2px 4px',
              borderRadius: 3,
              opacity:     hidden.has(g) ? 0.22 : 1,
              fontFamily:  'inherit',
              fontSize:    11,
              color:       'var(--muted)',
              transition:  'opacity 120ms',
            }}
          >
            <span style={{
              display:      'inline-block',
              width:        8,
              height:       8,
              borderRadius: '50%',
              background:   gc(g),
              flexShrink:   0,
            }} />
            {g}
            <span style={{ color: 'var(--muted-2)', fontSize: 10 }}>
              {genreCounts[g]}
            </span>
          </button>
        ))}
      </div>

      {/* Chart */}
      <div ref={wrapRef} style={{ position: 'relative', width: '100%', userSelect: 'none' }}>
        <svg
          width={w}
          height={H}
          style={{ overflow: 'visible', display: 'block' }}
          onMouseLeave={() => setTip(null)}
        >
          <defs>
            <clipPath id="pys-clip">
              <rect x={0} y={0} width={IW} height={IH} />
            </clipPath>
          </defs>

          <g transform={`translate(${PAD.l},${PAD.t})`}>

            {/* Horizontal grid + y-axis labels */}
            {yTicks.map(yr => (
              <g key={yr}>
                <line
                  x1={0} x2={IW} y1={sy(yr)} y2={sy(yr)}
                  stroke="var(--line-soft)" strokeWidth={0.5}
                />
                {yr % 2 === 0 && (
                  <text
                    x={-7} y={sy(yr) + 3.5}
                    textAnchor="end"
                    fill="var(--muted)"
                    fontFamily="JetBrains Mono"
                    style={{ fontSize: 9.5 }}
                  >{yr}</text>
                )}
              </g>
            ))}

            {/* Vertical grid + x-axis labels */}
            {xTicks.map(yr => (
              <g key={yr}>
                <line
                  x1={sx(yr)} x2={sx(yr)} y1={0} y2={IH}
                  stroke="var(--line-soft)" strokeWidth={0.5}
                />
                <text
                  x={sx(yr)} y={IH + 14}
                  textAnchor="middle"
                  fill="var(--muted)"
                  fontFamily="JetBrains Mono"
                  style={{ fontSize: 9.5 }}
                >{yr % 10 === 0 ? yr : '·'}</text>
              </g>
            ))}

            {/* Diagonal reference: pub year = read year */}
            {(() => {
              const d0 = Math.max(PUB_LO, READ_LO)
              const d1 = Math.min(PUB_HI, READ_HI)
              if (d0 >= d1) return null
              return (
                <line
                  x1={sx(d0)} y1={sy(d0)} x2={sx(d1)} y2={sy(d1)}
                  stroke="var(--line)" strokeWidth={1} strokeDasharray="4 4" opacity={0.9}
                />
              )
            })()}

            {/* Axis labels */}
            <text
              x={IW / 2} y={IH + 36}
              textAnchor="middle"
              fill="var(--muted)"
              fontFamily="DM Sans"
              style={{ fontSize: 10.5 }}
            >Publication year</text>
            <text
              x={-IH / 2} y={-38}
              textAnchor="middle"
              transform={`rotate(-90)`}
              fill="var(--muted)"
              fontFamily="DM Sans"
              style={{ fontSize: 10.5 }}
            >Year read</text>

            {/* Clipped-book note */}
            {clippedCount > 0 && (
              <text
                x={4} y={IH - 4}
                fill="var(--muted-2)"
                fontFamily="DM Sans"
                style={{ fontSize: 10, fontStyle: 'italic' }}
              >← {clippedCount} pre-{PUB_LO} book{clippedCount !== 1 ? 's' : ''} not shown</text>
            )}

            {/* Dots */}
            <g clipPath="url(#pys-clip)">
              {dots.map(d => {
                if (hidden.has(d.genre)) return null
                if (d.pubYear < PUB_LO || d.pubYear > PUB_HI) return null
                const cx  = sx(d.pubYear)  + jitter(d.idx * 3.7)
                const cy  = sy(d.yearRead) + jitter(d.idx * 5.3)
                const r   = dotRadius(d.rating)
                const hot = tip?.dot === d
                return (
                  <circle
                    key={d.idx}
                    cx={cx} cy={cy} r={hot ? r + 2.5 : r}
                    fill={gc(d.genre)}
                    fillOpacity={hot ? 1 : 0.68}
                    stroke={hot ? 'var(--ink)' : 'none'}
                    strokeWidth={1.2}
                    style={{ cursor: 'crosshair', transition: 'r 60ms ease' }}
                    onMouseEnter={e  => setTip({ dot: d, clientX: e.clientX, clientY: e.clientY })}
                    onMouseMove={e   => setTip(t => t ? { ...t, clientX: e.clientX, clientY: e.clientY } : null)}
                    onMouseLeave={() => setTip(null)}
                  />
                )
              })}
            </g>

          </g>
        </svg>

        {/* Tooltip */}
        {tip && (
          <div
            style={{
              position:     'fixed',
              left:         tipLeft(tip.clientX),
              top:          tipTop(tip.clientY),
              background:   'var(--ink)',
              color:        'var(--paper)',
              padding:      '9px 13px',
              borderRadius: 3,
              fontSize:     12,
              lineHeight:   1.6,
              maxWidth:     TIP_W,
              pointerEvents:'none',
              zIndex:       200,
              fontFamily:   'system-ui, sans-serif',
              boxShadow:    '0 4px 16px rgba(0,0,0,.25)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, lineHeight: 1.3 }}>
              {tip.dot.title}
            </div>
            {tip.dot.author && (
              <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 5 }}>
                {tip.dot.author}
              </div>
            )}
            <div>
              Published <strong>{tip.dot.pubYear}</strong>
              {' · '}read <strong>{tip.dot.yearRead}</strong>
            </div>
            <div style={{ color: 'var(--muted-2)', fontSize: 10.5, marginTop: 1 }}>
              {tip.dot.yearRead === tip.dot.pubYear
                ? 'read same year as published'
                : tip.dot.yearRead - tip.dot.pubYear === 1
                  ? '1 year after publication'
                  : `${tip.dot.yearRead - tip.dot.pubYear} years after publication`}
            </div>
            {tip.dot.rating > 0 && (
              <div style={{ marginTop: 4, color: 'var(--accent-3)', fontSize: 12 }}>
                {'★'.repeat(tip.dot.rating)}
                <span style={{ opacity: 0.35 }}>{'★'.repeat(5 - tip.dot.rating)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
