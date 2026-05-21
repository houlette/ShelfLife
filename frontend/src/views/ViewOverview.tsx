import { useMemo } from 'react'
import type { Book } from '../types'
import { nfmt, mean, effectiveDate, filterBooksByRange, aggregateBooks, ratingColor, goodreadsUrl } from '../utils'
import type { Range, Granularity } from '../utils'
import { SectionTitle, Stat, Card, BookCover } from '../components'
import { RatingStars } from '../components/RatingStars'
import { Sparkline, HBar, BarChart } from '../charts'

interface Props {
  books: Book[]
  range: Range
  granularity: Granularity
}

export function ViewOverview({ books, range, granularity }: Props) {
  const readBooks = useMemo(() => books.filter(b => b.exclusive_shelf === 'read'), [books])
  const filtered = useMemo(() => filterBooksByRange(readBooks, range), [readBooks, range])
  const periods = useMemo(() => aggregateBooks(filtered, granularity), [filtered, granularity])

  const totalPages = useMemo(() => filtered.reduce((s, b) => s + (b.num_pages ?? 0), 0), [filtered])
  const uniqueAuthors = useMemo(() => new Set(filtered.map(b => b.author).filter(Boolean)).size, [filtered])
  const rated = useMemo(() => filtered.filter(b => b.my_rating > 0), [filtered])
  const avgRating = useMemo(() => mean(rated.map(b => b.my_rating)), [rated])

  const currentlyReading = useMemo(() => books.filter(b => b.exclusive_shelf === 'currently-reading'), [books])
  const toRead = useMemo(() => books.filter(b => b.exclusive_shelf === 'to-read'), [books])

  const ratingDist = useMemo(() => {
    const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const b of rated) dist[b.my_rating] = (dist[b.my_rating] ?? 0) + 1
    return [5, 4, 3, 2, 1].map(r => ({ label: `${'★'.repeat(r)}`, value: dist[r], color: ratingColor(r) }))
  }, [rated])

  const booksPerYear = useMemo(() => aggregateBooks(readBooks, 'year'), [readBooks])

  return (
    <div>
      <SectionTitle no="01" sub={`${nfmt(filtered.length)} books in this period`}>
        Overview
      </SectionTitle>

      {/* Hero stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24, marginBottom: 48 }}>
        <Stat label="Books read" value={nfmt(filtered.length)} size="lg" />
        <Stat label="Pages" value={nfmt(totalPages)} size="lg" />
        <Stat label="Authors" value={nfmt(uniqueAuthors)} size="lg" />
        <Stat label="Avg rating" value={avgRating != null ? avgRating.toFixed(1) : null} unit="/5" size="lg" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 48 }}>
        {/* Rating distribution */}
        <Card title="Rating distribution" eyebrow="Your ratings" style={{ minWidth: 0 }}>
          <HBar items={ratingDist} />
        </Card>

        {/* Books per year sparkline */}
        <Card title="Books per year" eyebrow="Lifetime" style={{ minWidth: 0 }}>
          <div style={{ marginBottom: 12 }}>
            <Sparkline values={booksPerYear.map(p => p.books)} height={48} width={320} color="var(--accent)" />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
            {booksPerYear.map(p => (
              <div key={p.period} style={{ fontSize: 11, color: 'var(--muted)' }}>
                <span className="num" style={{ color: 'var(--ink)' }}>{p.books}</span> in {p.period}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Currently reading */}
      {currentlyReading.length > 0 && (
        <div style={{ marginBottom: 48 }}>
          <SectionTitle no="02">Currently reading</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {currentlyReading.map(b => (
              <Card key={b.id} padding={16}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  <BookCover src={b.cover_url} title={b.title} width={56} height={84} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="serif" style={{ fontSize: 16, color: 'var(--ink)', marginBottom: 4, lineHeight: 1.3 }}>
                      <a className="book-link" href={goodreadsUrl(b.goodreads_book_id)} target="_blank" rel="noreferrer">{b.title}</a>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.author}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 6 }}>
                      {b.num_pages && `${nfmt(b.num_pages)} pages`}
                      {b.genre && b.num_pages && ' · '}
                      {b.genre && b.genre}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Period breakdown */}
      {periods.length > 0 && (
        <div style={{ marginBottom: 48 }}>
          <SectionTitle no="03" sub={`${granularity === 'month' ? 'Monthly' : 'Yearly'} reading pace`}>
            Reading pace
          </SectionTitle>
          <Card title="Pages per year" eyebrow={granularity === 'month' ? 'Monthly' : 'Yearly'} style={{ marginBottom: 24 }}>
            <BarChart
              data={periods.map(p => ({ label: p.period, value: p.pages }))}
              height={140}
              color="var(--accent)"
            />
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
            {periods.slice(-12).map(p => (
              <Card key={p.period} padding={14}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>{p.period}</div>
                <div className="num serif" style={{ fontSize: 28, color: 'var(--ink)', lineHeight: 1 }}>{p.books}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  {nfmt(p.pages)} pp{p.avgRating != null ? ` · ${p.avgRating.toFixed(1)}★` : ''}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Recent reads */}
      <SectionTitle no="04">Recent reads</SectionTitle>
      <div style={{ display: 'grid', gap: 1 }}>
        {filtered.slice(0, 10).map(b => (
          <div key={b.id} style={{
            display: 'grid', gridTemplateColumns: '40px 1fr 100px 110px 80px',
            alignItems: 'center', gap: 14, padding: '12px 0',
            borderBottom: '1px solid var(--line-soft)',
          }}>
            <BookCover src={b.cover_url} title={b.title} width={32} height={48} />
            <div>
              <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.3 }}>
                <a className="book-link" href={goodreadsUrl(b.goodreads_book_id)} target="_blank" rel="noreferrer">{b.title}</a>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.author}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{b.genre ?? ''}</div>
            <RatingStars rating={b.my_rating} size={12} />
            <div className="num" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
              {effectiveDate(b)?.slice(0, 7) ?? '—'}
            </div>
          </div>
        ))}
      </div>

      {/* To-read count */}
      {toRead.length > 0 && (
        <div style={{ marginTop: 48, padding: '20px 0', borderTop: '1px solid var(--line)' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            <span className="num" style={{ color: 'var(--ink)', fontSize: 15 }}>{toRead.length}</span> books on your to-read shelf
          </div>
        </div>
      )}
    </div>
  )
}
