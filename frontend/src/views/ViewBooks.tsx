import { useMemo, useState, useEffect } from 'react'
import type { Book } from '../types'
import { nfmt, effectiveDate, goodreadsUrl } from '../utils'
import { SectionTitle, Pill, BookCover, AuthorLink } from '../components'
import { RatingStars } from '../components/RatingStars'

interface Props {
  books: Book[]
  initialSearch?: string
  onSearchClear?: () => void
}

type SortKey = 'title' | 'author' | 'rating' | 'pages' | 'date' | 'year'
type SortDir = 'asc' | 'desc'

export function ViewBooks({ books, initialSearch, onSearchClear }: Props) {
  const [search, setSearch] = useState(initialSearch ?? '')

  // Sync when navigating here from another tab with a pre-set filter
  useEffect(() => {
    if (initialSearch != null) setSearch(initialSearch)
  }, [initialSearch])
  const [shelf, setShelf] = useState<string | null>(null)
  const [genre, setGenre] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const PER_PAGE = 50

  const genres = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const b of books) {
      if (b.genre) counts[b.genre] = (counts[b.genre] ?? 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([g]) => g)
  }, [books])

  const filtered = useMemo(() => {
    let list = books
    if (shelf) list = list.filter(b => b.exclusive_shelf === shelf)
    if (genre) list = list.filter(b => b.genre === genre)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(b =>
        b.title.toLowerCase().includes(q) ||
        (b.author ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [books, shelf, genre, search])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'title': return dir * a.title.localeCompare(b.title)
        case 'author': return dir * (a.author ?? '').localeCompare(b.author ?? '')
        case 'rating': return dir * ((a.my_rating ?? 0) - (b.my_rating ?? 0))
        case 'pages': return dir * ((a.num_pages ?? 0) - (b.num_pages ?? 0))
        case 'year': return dir * ((a.original_pub_year ?? a.year_published ?? 0) - (b.original_pub_year ?? b.year_published ?? 0))
        case 'date': {
          const da = effectiveDate(a) ?? ''
          const db = effectiveDate(b) ?? ''
          return dir * da.localeCompare(db)
        }
      }
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const paged = sorted.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const totalPages = Math.ceil(sorted.length / PER_PAGE)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
    setPage(0)
  }

  const colHead = (label: string, key: SortKey, style?: React.CSSProperties) => (
    <button onClick={() => toggleSort(key)} style={{
      background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
      fontSize: 10.5, textTransform: 'uppercase' as const, letterSpacing: '0.1em',
      color: sortKey === key ? 'var(--ink)' : 'var(--muted)',
      fontWeight: sortKey === key ? 600 : 400,
      padding: 0, textAlign: 'left' as const,
      ...style,
    }}>
      {label} {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </button>
  )

  return (
    <div>
      <SectionTitle no="01" sub={`${nfmt(sorted.length)} books`}>
        Books
      </SectionTitle>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); if (e.target.value === '') onSearchClear?.() }}
          placeholder="Search title or author…"
          style={{
            padding: '8px 12px', fontSize: 13, border: '1px solid var(--line)',
            borderRadius: 2, background: 'var(--paper)', color: 'var(--ink)',
            width: 260, fontFamily: 'inherit', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {[null, 'read', 'currently-reading', 'to-read'].map(s => (
            <Pill key={s ?? 'all'} active={shelf === s} onClick={() => { setShelf(s); setPage(0) }}>
              {s ?? 'All'}
            </Pill>
          ))}
        </div>
      </div>
      {genres.length > 0 && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
          <span className="eyebrow" style={{ marginRight: 8 }}>Genre</span>
          <Pill active={genre === null} onClick={() => { setGenre(null); setPage(0) }}>All</Pill>
          {genres.map(g => (
            <Pill key={g} active={genre === g} onClick={() => { setGenre(g); setPage(0) }}>{g}</Pill>
          ))}
        </div>
      )}

      {/* Wide table — wrap in a horizontal scroll container for narrow viewports */}
      <div style={{ overflowX: 'auto', marginInline: -4 }}>
        <div style={{ minWidth: 680, paddingInline: 4 }}>
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '44px 1fr 140px 110px 90px 60px 70px 90px',
            gap: 12, padding: '8px 0', borderBottom: '2px solid var(--line)',
            alignItems: 'end',
          }}>
            <span></span>
            {colHead('Title', 'title')}
            {colHead('Author', 'author')}
            <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>Genre</span>
            {colHead('Rating', 'rating')}
            {colHead('Published', 'year', { textAlign: 'right' })}
            {colHead('Pages', 'pages', { textAlign: 'right' })}
            {colHead('Read', 'date', { textAlign: 'right' })}
          </div>

          {/* Rows */}
          {paged.map(b => (
            <div key={b.id} style={{
              display: 'grid', gridTemplateColumns: '44px 1fr 140px 110px 90px 60px 70px 90px',
              gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line-soft)',
              alignItems: 'center',
            }}>
              <BookCover src={b.cover_url} title={b.title} width={32} height={48} />
              <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.3 }}>
                <a className="book-link" href={goodreadsUrl(b.goodreads_book_id)} target="_blank" rel="noreferrer">{b.title}</a>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}><AuthorLink author={b.author} /></div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{b.genre ?? '—'}</div>
              <div><RatingStars rating={b.my_rating} size={10} /></div>
              <div className="num" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                {b.original_pub_year ?? b.year_published ?? '—'}
              </div>
              <div className="num" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                {b.num_pages ? nfmt(b.num_pages) : '—'}
              </div>
              <div className="num" style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                {effectiveDate(b) ?? '—'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24 }}>
          <Pill onClick={() => setPage(p => Math.max(0, p - 1))} style={{ visibility: page > 0 ? 'visible' : 'hidden' }}>
            ← Prev
          </Pill>
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 12px' }}>
            {page + 1} / {totalPages}
          </span>
          <Pill onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} style={{ visibility: page < totalPages - 1 ? 'visible' : 'hidden' }}>
            Next →
          </Pill>
        </div>
      )}
    </div>
  )
}
