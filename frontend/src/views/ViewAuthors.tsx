import { useMemo } from 'react'
import type { Book } from '../types'
import { nfmt, filterBooksByRange } from '../utils'
import type { Range } from '../utils'
import { SectionTitle, Stat, Card } from '../components'
import { RatingStars } from '../components/RatingStars'
import { HBar } from '../charts'

interface Props {
  books: Book[]
  range: Range
}

export function ViewAuthors({ books, range }: Props) {
  const readBooks = useMemo(() => books.filter(b => b.exclusive_shelf === 'read'), [books])
  const filtered = useMemo(() => filterBooksByRange(readBooks, range), [readBooks, range])

  const byAuthor = useMemo(() => {
    const map: Record<string, Book[]> = {}
    for (const b of filtered) {
      if (b.author) (map[b.author] ??= []).push(b)
    }
    return Object.entries(map)
      .map(([author, authorBooks]) => {
        const rated = authorBooks.filter(b => b.my_rating > 0)
        const withOl = authorBooks.filter(b => b.ol_avg_rating != null)
        const avgMine = rated.length ? rated.reduce((s, b) => s + b.my_rating, 0) / rated.length : null
        const avgOl = withOl.length ? withOl.reduce((s, b) => s + (b.ol_avg_rating ?? 0), 0) / withOl.length : null
        return {
          author,
          count: authorBooks.length,
          avgRating: avgMine,
          avgOl,
          diff: avgMine != null && avgOl != null ? avgMine - avgOl : null,
          ratedCount: rated.length,
          totalPages: authorBooks.reduce((s, b) => s + (b.num_pages ?? 0), 0),
          books: authorBooks,
        }
      })
      .sort((a, b) => b.count - a.count)
  }, [filtered])

  // Author-level rating disagreements: at least 3 books with both your rating and OL rating
  const ratingComparable = useMemo(
    () => byAuthor.filter(a => a.diff != null && a.ratedCount >= 3),
    [byAuthor],
  )

  const overrated = useMemo(
    () => [...ratingComparable].filter(a => a.diff! < -0.5).sort((a, b) => a.diff! - b.diff!),
    [ratingComparable],
  )

  const underrated = useMemo(
    () => [...ratingComparable].filter(a => a.diff! > 0.5).sort((a, b) => b.diff! - a.diff!),
    [ratingComparable],
  )

  const uniqueAuthors = byAuthor.length
  const repeatAuthors = byAuthor.filter(a => a.count >= 2)
  const oneBookWonders = byAuthor.filter(a => a.count === 1)

  const topBarData = useMemo(() =>
    byAuthor.slice(0, 15).map(a => ({
      label: a.author.length > 20 ? a.author.slice(0, 18) + '…' : a.author,
      value: a.count,
    })),
    [byAuthor],
  )

  return (
    <div>
      <SectionTitle no="01" sub={`${nfmt(uniqueAuthors)} unique authors in this period`}>
        Authors
      </SectionTitle>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginBottom: 48 }}>
        <Stat label="Unique authors" value={nfmt(uniqueAuthors)} size="xl" />
        <Stat label="Repeat authors" value={nfmt(repeatAuthors.length)} size="xl" sub={`${repeatAuthors.length ? Math.round(repeatAuthors.length / uniqueAuthors * 100) : 0}% of authors`} />
        <Stat label="One-book wonders" value={nfmt(oneBookWonders.length)} size="xl" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 48 }}>
        <Card title="Most-read authors" eyebrow="Top 15">
          <HBar items={topBarData} color="var(--accent)" />
        </Card>

        <Card title="Repeat authors" eyebrow={`${repeatAuthors.length} authors with 2+ books`}>
          <div style={{ display: 'grid', gap: 1 }}>
            {repeatAuthors.slice(0, 15).map(a => (
              <div key={a.author} style={{
                display: 'grid', gridTemplateColumns: '1fr 40px 80px',
                alignItems: 'center', gap: 12, padding: '8px 0',
                borderBottom: '1px solid var(--line-soft)',
              }}>
                <div style={{ fontSize: 13, color: 'var(--ink)' }}>{a.author}</div>
                <div className="num" style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>{a.count}</div>
                <div style={{ textAlign: 'right' }}>
                  {a.avgRating != null && <RatingStars rating={Math.round(a.avgRating)} size={10} />}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Author-level your rating vs OL */}
      {ratingComparable.length > 0 && (
        <div>
          <SectionTitle no="02" sub="Authors with 3+ rated books where your average diverges 0.5+ from Open Library">
            Where you disagree
          </SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <Card title="You rate higher" eyebrow={`${underrated.length} underrated authors`}>
              <AuthorDiffList authors={underrated} />
            </Card>
            <Card title="You rate lower" eyebrow={`${overrated.length} overrated authors`}>
              <AuthorDiffList authors={overrated} />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

interface AuthorRow {
  author: string
  count: number
  ratedCount: number
  avgRating: number | null
  avgOl: number | null
  diff: number | null
}

function AuthorDiffList({ authors }: { authors: AuthorRow[] }) {
  return (
    <div style={{
      display: 'grid', gap: 1,
      gridTemplateColumns: '1fr',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 50px 50px 50px',
        gap: 8, padding: '4px 0',
        fontSize: 10.5, color: 'var(--muted)',
        textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>
        <span>Author</span>
        <span style={{ textAlign: 'right' }}>You</span>
        <span style={{ textAlign: 'right' }}>OL</span>
        <span style={{ textAlign: 'right' }}>Δ</span>
      </div>
      {authors.slice(0, 12).map(a => (
        <div key={a.author} style={{
          display: 'grid', gridTemplateColumns: '1fr 50px 50px 50px',
          alignItems: 'center', gap: 8, padding: '8px 0',
          borderTop: '1px solid var(--line-soft)',
        }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.3 }}>{a.author}</div>
            <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{a.ratedCount} of {a.count} rated</div>
          </div>
          <div className="num" style={{ fontSize: 12, color: 'var(--ink)', textAlign: 'right' }}>{a.avgRating!.toFixed(2)}</div>
          <div className="num" style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right' }}>{a.avgOl!.toFixed(2)}</div>
          <div className="num" style={{
            fontSize: 12, fontWeight: 600, textAlign: 'right',
            color: a.diff! > 0 ? 'var(--m5)' : 'var(--m1)',
          }}>
            {a.diff! > 0 ? '+' : ''}{a.diff!.toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  )
}
