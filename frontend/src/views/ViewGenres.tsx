import { useMemo, useRef, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Book } from '../types'
import { api } from '../api'
import { nfmt, ratingColor, filterBooksByRange } from '../utils'
import type { Range } from '../utils'
import { SectionTitle, Card, Stat } from '../components'
import { RatingStars } from '../components/RatingStars'
import { HBar } from '../charts'

interface Props {
  books: Book[]
  range: Range
}

export function ViewGenres({ books, range }: Props) {
  const { data: genres = [] } = useQuery({
    queryKey: ['genres'],
    queryFn: () => api.genres(),
  })

  const readBooks = useMemo(() => books.filter(b => b.exclusive_shelf === 'read'), [books])
  const filtered = useMemo(() => filterBooksByRange(readBooks, range), [readBooks, range])
  const enriched = useMemo(() => filtered.filter(b => b.genre), [filtered])
  const unclassified = filtered.length - enriched.length

  const barData = useMemo(() =>
    genres.filter(g => g.genre !== 'Unclassified').map(g => ({
      label: g.genre,
      value: g.count,
      color: g.avg_rating != null ? ratingColor(Math.round(g.avg_rating)) : 'var(--accent)',
    })),
    [genres],
  )

  return (
    <div>
      <SectionTitle no="01" sub={`${nfmt(enriched.length)} classified · ${nfmt(unclassified)} unclassified`}>
        Genres
      </SectionTitle>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginBottom: 48 }}>
        <Stat label="Genres" value={nfmt(genres.filter(g => g.genre !== 'Unclassified').length)} size="lg" />
        <Stat
          label="Top genre"
          value={genres.find(g => g.genre !== 'Unclassified')?.genre ?? '—'}
          size="lg"
          sub={(() => {
            const top = genres.find(g => g.genre !== 'Unclassified')
            return top ? `${top.count} books` : undefined
          })()}
        />
        <Stat
          label="Highest rated genre"
          value={[...genres].filter(g => g.avg_rating != null && g.count >= 5).sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0))[0]?.genre ?? '—'}
          size="lg"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 48 }}>
        <Card title="Books by genre" eyebrow="Lifetime">
          <HBar items={barData} />
        </Card>

        <Card title="Avg rating by genre" eyebrow={`${genres.filter(g => g.avg_rating != null).length} rated genres`}>
          <div style={{ display: 'grid', gap: 1 }}>
            {genres
              .filter(g => g.avg_rating != null && g.count >= 3)
              .sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0))
              .map(g => (
                <div key={g.genre} style={{
                  display: 'grid', gridTemplateColumns: '1fr 100px 80px',
                  alignItems: 'center', padding: '8px 0',
                  borderBottom: '1px solid var(--line-soft)',
                }}>
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>{g.genre}</div>
                  <div><RatingStars rating={Math.round(g.avg_rating!)} size={10} /></div>
                  <div className="num" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                    {g.avg_rating!.toFixed(2)} ({g.count})
                  </div>
                </div>
              ))}
          </div>
        </Card>
      </div>

      <SectionTitle no="02" sub="How the genre mix of your reading has shifted year by year">
        Taste over time
      </SectionTitle>
      <Card title="Genre mix by year" eyebrow="Proportional · all-time · genre-classified books only" style={{ marginBottom: 48 }}>
        <GenreTimeline books={readBooks} />
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stacked bar chart: genre proportions by year
// ---------------------------------------------------------------------------

const GENRE_PALETTE = [
  '#5b8ed6', '#d65b8e', '#8e5bd6', '#d6904e',
  '#6ac86a', '#d4c94a', '#d65b5b', '#7ab8a0', '#a07ad6',
]

function GenreTimeline({ books }: { books: Book[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)

  useEffect(() => {
    const measure = () => { if (ref.current) setW(ref.current.clientWidth) }
    measure()
    const ro = new ResizeObserver(measure)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  // year → genre → count
  const yearGenreMap = useMemo(() => {
    const map: Record<number, Record<string, number>> = {}
    for (const b of books) {
      if (!b.date_read || !b.genre || b.genre === 'Unclassified') continue
      const year = new Date(b.date_read).getFullYear()
      if (!map[year]) map[year] = {}
      map[year][b.genre] = (map[year][b.genre] ?? 0) + 1
    }
    return map
  }, [books])

  // Top 8 genres by total count; everything else → "Other"
  const { topGenres, genreColor } = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const yd of Object.values(yearGenreMap))
      for (const [g, n] of Object.entries(yd))
        totals[g] = (totals[g] ?? 0) + n
    const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g]) => g)
    const color: Record<string, string> = {}
    top.forEach((g, i) => { color[g] = GENRE_PALETTE[i] })
    color['Other'] = GENRE_PALETTE[8]
    return { topGenres: top, genreColor: color }
  }, [yearGenreMap])

  const years = useMemo(() => Object.keys(yearGenreMap).map(Number).sort(), [yearGenreMap])

  // Normalised data per year
  const chartData = useMemo(() => years.map(year => {
    const yd = yearGenreMap[year]
    const total = Object.values(yd).reduce((s, v) => s + v, 0)
    let otherCount = 0
    const segs: Array<{ genre: string; pct: number; count: number }> = []
    for (const [g, n] of Object.entries(yd)) {
      if (topGenres.includes(g)) segs.push({ genre: g, pct: n / total, count: n })
      else otherCount += n
    }
    segs.sort((a, b) => topGenres.indexOf(a.genre) - topGenres.indexOf(b.genre))
    if (otherCount > 0) segs.push({ genre: 'Other', pct: otherCount / total, count: otherCount })
    return { year, total, segs }
  }), [years, yearGenreMap, topGenres])

  const hasOther = chartData.some(d => d.segs.some(s => s.genre === 'Other'))
  const legendGenres = [...topGenres, ...(hasOther ? ['Other'] : [])]

  if (years.length < 2) return (
    <div style={{ padding: '24px 0', fontSize: 13, color: 'var(--muted)' }}>
      Not enough years of data yet.
    </div>
  )

  const height = 260
  const padL = 30, padR = 8, padT = 20, padB = 28
  const innerH = height - padT - padB
  const innerW = w - padL - padR
  const step = innerW / years.length
  const barW = Math.max(4, step * 0.72)

  return (
    <div>
      <div ref={ref} style={{ width: '100%' }}>
        <svg width={w} height={height} style={{ display: 'block' }}>
          {/* Grid lines at 25 / 50 / 75 / 100 % */}
          {[0.25, 0.5, 0.75, 1].map(f => {
            const y = padT + (1 - f) * innerH
            return (
              <g key={f}>
                <line x1={padL} x2={w - padR} y1={y} y2={y}
                  stroke="var(--line-soft)" strokeWidth={0.5} />
                <text x={padL - 4} y={y + 3} textAnchor="end"
                  style={{ fontSize: 9, fill: 'var(--muted)' }} fontFamily="JetBrains Mono">
                  {Math.round(f * 100)}%
                </text>
              </g>
            )
          })}

          {/* Stacked bars */}
          {chartData.map((d, i) => {
            const x = padL + i * step + (step - barW) / 2
            // pre-compute rect positions bottom-up
            let curY = padT + innerH
            const rects = d.segs.map(seg => {
              const h = Math.max(0, seg.pct * innerH)
              curY -= h
              return { genre: seg.genre, y: curY, h, count: seg.count }
            })
            return (
              <g key={d.year}>
                {rects.map(r => (
                  <rect key={r.genre}
                    x={x} y={r.y} width={barW} height={r.h}
                    fill={genreColor[r.genre] ?? '#ccc'} opacity={0.85}
                  />
                ))}
                {/* Year label */}
                <text x={x + barW / 2} y={height - 8} textAnchor="middle"
                  style={{ fontSize: 9, fill: 'var(--muted)' }} fontFamily="JetBrains Mono">
                  {d.year}
                </text>
                {/* Total books count above bar */}
                <text x={x + barW / 2} y={padT - 5} textAnchor="middle"
                  style={{ fontSize: 8, fill: 'var(--muted)' }} fontFamily="JetBrains Mono">
                  {d.total}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 18px', marginTop: 10 }}>
        {legendGenres.map(g => (
          <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: genreColor[g], opacity: 0.85, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{g}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
