import { useMemo } from 'react'
import type { Book } from '../types'
import { nfmt } from '../utils'
import { SectionTitle, Stat, Card, Tag } from '../components'
import { HBar } from '../charts'

interface Props {
  books: Book[]
}

export function ViewShelves({ books }: Props) {
  const readCount = useMemo(() => books.filter(b => b.exclusive_shelf === 'read').length, [books])
  const crCount = useMemo(() => books.filter(b => b.exclusive_shelf === 'currently-reading').length, [books])
  const trCount = useMemo(() => books.filter(b => b.exclusive_shelf === 'to-read').length, [books])

  const customShelves = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const b of books) {
      for (const s of b.bookshelves) {
        counts[s] = (counts[s] ?? 0) + 1
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([shelf, count]) => ({ shelf, count }))
  }, [books])

  const shelfBarData = useMemo(() =>
    customShelves.slice(0, 20).map(s => ({
      label: s.shelf,
      value: s.count,
    })),
    [customShelves],
  )

  return (
    <div>
      <SectionTitle no="01" sub={`${nfmt(books.length)} total books across all shelves`}>
        Shelves
      </SectionTitle>

      {/* Main shelf counts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24, marginBottom: 48 }}>
        <Stat label="Read" value={nfmt(readCount)} size="xl" />
        <Stat label="Currently reading" value={nfmt(crCount)} size="xl" />
        <Stat label="To read" value={nfmt(trCount)} size="xl" />
      </div>

      {/* Custom shelves */}
      {customShelves.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, marginBottom: 48 }}>
          <Card title="Custom shelves" eyebrow="Top 20">
            <HBar items={shelfBarData} color="var(--accent-2)" />
          </Card>

          <Card title="All shelves" eyebrow={`${customShelves.length} custom shelves`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {customShelves.map(s => (
                <Tag key={s.shelf}>
                  {s.shelf} <span className="num" style={{ fontSize: 10 }}>{s.count}</span>
                </Tag>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
