import { useMemo } from 'react'
import type { Book } from '../types'
import { nfmt, mean, filterBooksByRange, aggregateBooks, ratingColor, goodreadsUrl } from '../utils'
import type { Range, Granularity } from '../utils'
import { SectionTitle, Card, Stat, AuthorLink } from '../components'
import { RatingStars } from '../components/RatingStars'
import { HBar, Scatter, LineChart } from '../charts'

interface Props {
  books: Book[]
  range: Range
  granularity: Granularity
}

export function ViewRatings({ books, range, granularity }: Props) {
  const readBooks = useMemo(() => books.filter(b => b.exclusive_shelf === 'read'), [books])
  const filtered = useMemo(() => filterBooksByRange(readBooks, range), [readBooks, range])
  const rated = useMemo(() => filtered.filter(b => b.my_rating > 0), [filtered])
  const unrated = useMemo(() => filtered.filter(b => !b.my_rating || b.my_rating === 0), [filtered])

  const avgMine = useMemo(() => mean(rated.map(b => b.my_rating)), [rated])
  const hasExternalAvg = useMemo(() => rated.some(b => b.ol_avg_rating != null), [rated])
  const avgGR = useMemo(() => mean(rated.map(b => b.ol_avg_rating)), [rated])

  const ratingDist = useMemo(() => {
    const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const b of rated) dist[b.my_rating] = (dist[b.my_rating] ?? 0) + 1
    return [5, 4, 3, 2, 1].map(r => ({
      label: `${r} ★`,
      value: dist[r],
      color: ratingColor(r),
    }))
  }, [rated])

  const fivers = useMemo(() => rated.filter(b => b.my_rating === 5), [rated])
  const oneStars = useMemo(() => rated.filter(b => b.my_rating === 1), [rated])

  const scatterData = useMemo(() =>
    rated
      .filter(b => b.ol_avg_rating != null)
      .map(b => ({ x: b.ol_avg_rating!, y: b.my_rating, title: b.title, author: b.author })),
    [rated],
  )

  const hiddenGems = useMemo(() =>
    rated
      .filter(b => b.ol_avg_rating != null && b.my_rating - b.ol_avg_rating! >= 1.5)
      .sort((a, b) => (b.my_rating - b.ol_avg_rating!) - (a.my_rating - a.ol_avg_rating!)),
    [rated],
  )

  const unpopular = useMemo(() =>
    rated
      .filter(b => b.ol_avg_rating != null && b.ol_avg_rating! - b.my_rating >= 1.5)
      .sort((a, b) => (b.ol_avg_rating! - b.my_rating) - (a.ol_avg_rating! - a.my_rating)),
    [rated],
  )

  const ratingTrend = useMemo(() => {
    const periods = aggregateBooks(rated, granularity)
    return periods.filter(p => p.avgRating != null).map(p => ({
      date: p.period,
      avgRating: p.avgRating,
    }))
  }, [rated, granularity])

  return (
    <div>
      <SectionTitle no="01" sub={`${nfmt(rated.length)} rated · ${nfmt(unrated.length)} unrated`}>
        Ratings
      </SectionTitle>

      <div style={{ display: 'grid', gridTemplateColumns: hasExternalAvg ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)', gap: 24, marginBottom: 48 }}>
        <Stat label="Your average" value={avgMine != null ? avgMine.toFixed(2) : null} unit="/5" size="xl" />
        <Stat label="5-star books" value={nfmt(fivers.length)} size="xl" sub={rated.length ? `${Math.round(fivers.length / rated.length * 100)}% of rated` : undefined} />
        <Stat label="1-star books" value={nfmt(oneStars.length)} size="xl" sub={rated.length ? `${Math.round(oneStars.length / rated.length * 100)}% of rated` : undefined} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, marginBottom: 48 }}>
        <Card title="Your rating distribution" eyebrow="How you rate">
          <HBar items={ratingDist} />
        </Card>

        {/* Rating trend */}
        {ratingTrend.length > 3 ? (
          <Card title="Rating trend" eyebrow={`Average per ${granularity}`}>
            <LineChart data={ratingTrend} y="avgRating" height={200} color="var(--accent)" smoothWindow={3} yDomain={[1, 5]} />
          </Card>
        ) : (
          <Card title="Rating trend" eyebrow="Need more data">
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Not enough rated books with read dates to show a trend.
            </div>
          </Card>
        )}
      </div>

      {/* External rating comparison — only if data available */}
      {hasExternalAvg && (
        <Card title="Your rating vs Open Library average" eyebrow="Scatter plot" style={{ marginBottom: 48 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 24, alignItems: 'center' }}>
            <div>
              <Stat label="OL avg" value={avgGR != null ? avgGR.toFixed(2) : null} unit="/5" size="md" />
              <div style={{ marginTop: 16 }}>
                <Stat
                  label="Difference"
                  value={avgMine != null && avgGR != null ? (avgMine - avgGR > 0 ? '+' : '') + (avgMine - avgGR).toFixed(2) : null}
                  size="md"
                />
              </div>
            </div>
            <Scatter
              data={scatterData}
              x="x" y="y"
              height={280}
              xLabel="Open Library avg"
              yLabel="Your rating"
              dotColor="var(--accent)"
              dotAlpha={0.35}
            />
          </div>
        </Card>
      )}

      {/* Hidden gems / Unpopular opinions */}
      {(hiddenGems.length > 0 || unpopular.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
          {hiddenGems.length > 0 && (
            <Card title="Hidden gems" eyebrow={`${hiddenGems.length} books you rated 1.5+ above OL`}>
              <div style={{ display: 'grid', gap: 1 }}>
                {hiddenGems.slice(0, 12).map(b => (
                  <div key={b.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr 70px 70px',
                    alignItems: 'center', gap: 12, padding: '8px 0',
                    borderBottom: '1px solid var(--line-soft)',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.3 }}>
                        <a className="book-link" href={goodreadsUrl(b.goodreads_book_id)} target="_blank" rel="noreferrer">{b.title}</a>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}><AuthorLink author={b.author} /></div>
                    </div>
                    <div style={{ textAlign: 'center' }}><RatingStars rating={b.my_rating} size={10} /></div>
                    <div className="num" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                      OL {b.ol_avg_rating?.toFixed(1)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {unpopular.length > 0 && (
            <Card title="Unpopular opinions" eyebrow={`${unpopular.length} books you rated 1.5+ below OL`}>
              <div style={{ display: 'grid', gap: 1 }}>
                {unpopular.slice(0, 12).map(b => (
                  <div key={b.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr 70px 70px',
                    alignItems: 'center', gap: 12, padding: '8px 0',
                    borderBottom: '1px solid var(--line-soft)',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.3 }}>
                        <a className="book-link" href={goodreadsUrl(b.goodreads_book_id)} target="_blank" rel="noreferrer">{b.title}</a>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}><AuthorLink author={b.author} /></div>
                    </div>
                    <div style={{ textAlign: 'center' }}><RatingStars rating={b.my_rating} size={10} /></div>
                    <div className="num" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                      OL {b.ol_avg_rating?.toFixed(1)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* 5-star books */}
      {fivers.length > 0 && (
        <Card title="Your 5-star books" eyebrow={`${fivers.length} all-time favorites`} style={{ marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
            {fivers.slice(0, 30).map(b => (
              <div key={b.id} style={{
                padding: '8px 0',
                borderBottom: '1px solid var(--line-soft)',
              }}>
                <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.3 }}>
                  <a className="book-link" href={goodreadsUrl(b.goodreads_book_id)} target="_blank" rel="noreferrer">{b.title}</a>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{b.author}</div>
              </div>
            ))}
          </div>
          {fivers.length > 30 && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
              + {fivers.length - 30} more
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
