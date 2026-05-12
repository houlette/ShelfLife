import { useMemo } from 'react'
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
                  display: 'grid', gridTemplateColumns: '1fr 100px 60px',
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
    </div>
  )
}
