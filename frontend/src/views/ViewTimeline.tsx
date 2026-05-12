import { useMemo } from 'react'
import type { Book } from '../types'
import { filterBooksByRange, aggregateBooks, nfmt, MONTH_NAMES } from '../utils'
import type { Range, Granularity } from '../utils'
import { SectionTitle, Card } from '../components'
import { BarChart, LineChart } from '../charts'

interface Props {
  books: Book[]
  range: Range
  granularity: Granularity
}

export function ViewTimeline({ books, range, granularity }: Props) {
  const readBooks = useMemo(() => books.filter(b => b.exclusive_shelf === 'read'), [books])
  const filtered = useMemo(() => filterBooksByRange(readBooks, range), [readBooks, range])
  const periods = useMemo(() => aggregateBooks(filtered, granularity), [filtered, granularity])

  const barData = useMemo(() =>
    periods.map(p => ({
      label: granularity === 'month' && p.month
        ? MONTH_NAMES[p.month - 1] + ' ' + String(p.year).slice(2)
        : String(p.year),
      value: p.books,
    })),
    [periods, granularity],
  )

  const cumulativeData = useMemo(() => {
    let total = 0
    return periods.map(p => {
      total += p.books
      return { date: p.period, cumulative: total, books: p.books, pages: p.pages }
    })
  }, [periods])

  const pagesData = useMemo(() =>
    periods.map(p => ({ date: p.period, pages: p.pages })),
    [periods],
  )

  return (
    <div>
      <SectionTitle no="01" sub={`${nfmt(filtered.length)} books across ${periods.length} ${granularity === 'month' ? 'months' : 'years'}`}>
        Timeline
      </SectionTitle>

      {/* Books per period */}
      <Card title={`Books per ${granularity}`} eyebrow="Reading volume" style={{ marginBottom: 32 }}>
        <BarChart data={barData} height={220} color="var(--accent)" />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 48 }}>
        {/* Cumulative */}
        <Card title="Cumulative books" eyebrow="Running total">
          <LineChart data={cumulativeData} y="cumulative" height={200} color="var(--accent)" area smoothWindow={1} />
        </Card>

        {/* Pages per period */}
        <Card title={`Pages per ${granularity}`} eyebrow="Volume">
          <LineChart data={pagesData} y="pages" height={200} color="var(--accent-2)" smoothWindow={3} />
        </Card>
      </div>
    </div>
  )
}
