import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { Recommendation } from '../types'
import { nfmt, ratingColor, goodreadsUrl } from '../utils'
import { SectionTitle, Card, Pill, BookCover } from '../components'

export function ViewRecommend() {
  const [genre, setGenre] = useState<string | null>(null)
  const [showWhy, setShowWhy] = useState<number | null>(null)

  const { data: recs = [], isLoading } = useQuery({
    queryKey: ['recommendations'],
    queryFn: () => api.recommendations(100),
  })

  const genres = useMemo(() => {
    const set = new Set<string>()
    for (const r of recs) if (r.book.genre) set.add(r.book.genre)
    return Array.from(set).sort()
  }, [recs])

  const filtered = useMemo(
    () => (genre ? recs.filter(r => r.book.genre === genre) : recs),
    [recs, genre],
  )

  return (
    <div>
      <SectionTitle no="01" sub="Top picks from your to-read shelf, calibrated to your taste and corrected for fan-community rating inflation.">
        Recommend
      </SectionTitle>

      {genres.length > 0 && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
          <span className="eyebrow" style={{ marginRight: 8 }}>Genre</span>
          <Pill active={genre === null} onClick={() => setGenre(null)}>All</Pill>
          {genres.map(g => (
            <Pill key={g} active={genre === g} onClick={() => setGenre(g)}>{g}</Pill>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="mono" style={{ fontSize: 13, color: 'var(--muted)', padding: 32, textAlign: 'center' }}>
          Computing recommendations…
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            No recommendations yet. Books on your to-read shelf need to be enriched (have a genre and OL rating) before they can be scored.
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {filtered.map((r, i) => (
          <RecCard
            key={r.book.id}
            rec={r}
            rank={i + 1}
            expanded={showWhy === r.book.id}
            onToggle={() => setShowWhy(showWhy === r.book.id ? null : r.book.id)}
          />
        ))}
      </div>
    </div>
  )
}

function RecCard({ rec, rank, expanded, onToggle }: {
  rec: Recommendation
  rank: number
  expanded: boolean
  onToggle: () => void
}) {
  const { book, score, breakdown, raw, reason } = rec
  const scoreColor = ratingColor(Math.round(score))

  return (
    <Card padding={16}>
      <div style={{ display: 'grid', gridTemplateColumns: '32px 64px 1fr 120px 90px', gap: 16, alignItems: 'center' }}>
        <div className="num" style={{ fontSize: 18, color: 'var(--muted-2)', textAlign: 'right' }}>
          {rank}
        </div>
        <BookCover src={book.cover_url} title={book.title} width={56} height={84} />
        <div style={{ minWidth: 0 }}>
          <div className="serif" style={{ fontSize: 17, color: 'var(--ink)', lineHeight: 1.25, marginBottom: 4 }}>
            <a className="book-link" href={goodreadsUrl(book.goodreads_book_id)} target="_blank" rel="noreferrer">{book.title}</a>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {book.author}
            {book.original_pub_year && (
              <span style={{ color: 'var(--muted-2)' }}> · {book.original_pub_year}</span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 6 }}>
            {reason}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="num serif" style={{ fontSize: 32, color: scoreColor, lineHeight: 1, letterSpacing: '-0.02em' }}>
            {score.toFixed(2)}
          </div>
          <div className="eyebrow" style={{ marginTop: 4, fontSize: 9.5 }}>predicted</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
            OL {book.ol_avg_rating?.toFixed(2)}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>
            {nfmt(raw.ratings_count)} ratings
          </div>
          <button onClick={onToggle} style={{
            background: 'none', border: '1px solid var(--line)',
            padding: '3px 8px', marginTop: 6, borderRadius: 2,
            fontSize: 10.5, color: 'var(--muted)', cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
            {expanded ? 'hide' : 'why'}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{
          marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line-soft)',
          display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 10,
        }}>
          <BreakdownCell label="Genre baseline" value={breakdown.genre_baseline} suffix={`(${book.genre})`} />
          <BreakdownCell label="Author offset" value={breakdown.author_offset} suffix={raw.author_user_avg != null ? `you avg ${raw.author_user_avg.toFixed(2)}` : 'no prior'} />
          <BreakdownCell label="OL z-bonus" value={breakdown.ol_z_bonus} suffix={`z=${raw.ol_z.toFixed(2)}`} />
          <BreakdownCell label="Subject" value={breakdown.subject_offset ?? 0} suffix={raw.subject_pred != null ? `pred ${raw.subject_pred.toFixed(2)} (n=${raw.subject_overlap})` : `n=${raw.subject_overlap ?? 0}, no signal`} />
          <BreakdownCell label="Coll. filter" value={breakdown.cf_offset ?? 0} suffix={raw.cf_pred != null ? `pred ${raw.cf_pred.toFixed(2)} (n=${raw.cf_neighbors})` : 'no overlap'} />
          <BreakdownCell label="Text content" value={breakdown.text_offset ?? 0} suffix={raw.text_pred != null ? `pred ${raw.text_pred.toFixed(2)} (sim ${(raw.text_sim ?? 0).toFixed(2)})` : 'no reviews'} />
          <BreakdownCell label="Popularity" value={breakdown.popularity_penalty} suffix={`${nfmt(raw.ratings_count)} ratings`} />
          <BreakdownCell label="Series" value={breakdown.series_penalty} suffix={raw.is_sequel ? 'sequel' : '—'} />
        </div>
      )}
    </Card>
  )
}

function BreakdownCell({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  const isNeg = value < 0
  const isZero = value === 0
  const color = isZero ? 'var(--muted-2)' : isNeg ? 'var(--m1)' : 'var(--m5)'
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div className="num" style={{ fontSize: 16, color, fontWeight: 600 }}>
        {value > 0 ? '+' : ''}{value.toFixed(2)}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{suffix}</div>
    </div>
  )
}
