import { useMemo } from 'react'
import type { Book } from '../types'
import { filterBooksByRange, aggregateBooks, nfmt, MONTH_NAMES } from '../utils'
import type { Range, Granularity } from '../utils'
import { SectionTitle, Card } from '../components'
import { BarChart, LineChart, PubYearScatter } from '../charts'

interface Props {
  books: Book[]
  range: Range
  granularity: Granularity
}

export function ViewTimeline({ books, range, granularity }: Props) {
  const readBooks = useMemo(() => books.filter(b => b.exclusive_shelf === 'read'), [books])
  const filtered = useMemo(() => filterBooksByRange(readBooks, range), [readBooks, range])
  const periods = useMemo(() => aggregateBooks(filtered, granularity), [filtered, granularity])

  const byPubYear = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const b of readBooks) {
      const y = b.original_pub_year ?? b.year_published
      if (y && y > 0) counts[y] = (counts[y] ?? 0) + 1
    }
    const allYears = Object.keys(counts).map(Number).sort((a, b) => a - b)
    // Drop outlier years: any year more than 300 years before the median
    // (handles e.g. a single ancient text creating a huge blank gap)
    const cutoff = allYears.length
      ? allYears[Math.floor(allYears.length / 2)] - 300
      : 0
    return Object.entries(counts)
      .filter(([year]) => Number(year) >= cutoff)
      .map(([year, count]) => ({ label: year, value: count }))
      .sort((a, b) => Number(a.label) - Number(b.label))
  }, [readBooks])

  const acquiredByYear = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const b of books) {
      if (b.year_acquired) counts[b.year_acquired] = (counts[b.year_acquired] ?? 0) + 1
    }
    return Object.entries(counts)
      .map(([year, count]) => ({ label: year, value: count }))
      .sort((a, b) => Number(a.label) - Number(b.label))
  }, [books])

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

  const datedCount = cumulativeData[cumulativeData.length - 1]?.cumulative ?? 0
  const undatedCount = filtered.length - datedCount

  const BUCKET = 50
  const MAX_BUCKET = 700
  const byPageCount = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const b of filtered) {
      if (!b.num_pages || b.num_pages <= 0) continue
      const bucket = b.num_pages > MAX_BUCKET
        ? MAX_BUCKET + BUCKET       // overflow bin
        : Math.ceil(b.num_pages / BUCKET) * BUCKET
      counts[bucket] = (counts[bucket] ?? 0) + 1
    }
    const bins = []
    for (let upper = BUCKET; upper <= MAX_BUCKET; upper += BUCKET) {
      bins.push({ label: String(upper), value: counts[upper] ?? 0 })
    }
    bins.push({ label: '500+', value: counts[MAX_BUCKET + BUCKET] ?? 0 })
    return bins
  }, [filtered])

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

      {acquiredByYear.length > 0 && (
        <Card title="Books acquired by year" eyebrow="Lifetime · from booklist" style={{ marginBottom: 32 }}>
          <BarChart data={acquiredByYear} height={180} color="var(--accent-2)" />
        </Card>
      )}

      {byPubYear.length > 0 && (
        <Card title="Books read by publication year" eyebrow="All time" style={{ marginBottom: 32 }}>
          <BarChart data={byPubYear} height={180} color="var(--accent-3)"
            labelFilter={l => Number(l) % 10 === 0} />
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 48 }}>
        {/* Cumulative */}
        <Card title="Cumulative books read" eyebrow={undatedCount > 0 ? `${nfmt(datedCount)} of ${nfmt(filtered.length)} have a read date` : 'Running total'} style={{ minWidth: 0 }}>
          <LineChart data={cumulativeData} y="cumulative" height={200} color="var(--accent)" area smoothWindow={1} />
        </Card>

        {/* Pages per period */}
        <Card title={`Pages per ${granularity}`} eyebrow="Volume" style={{ minWidth: 0 }}>
          <LineChart data={pagesData} y="pages" height={200} color="var(--accent-2)" smoothWindow={3} />
        </Card>
      </div>

      {byPageCount.some(b => b.value > 0) && (
        <Card title="Book length distribution" eyebrow="Pages per book" style={{ marginBottom: 32 }}>
          <BarChart
            data={byPageCount}
            height={180}
            color="var(--accent-2)"
            labelFilter={l => Number(l.replace('+', '')) % 100 === 0 || l === '500+'}
          />
        </Card>
      )}

      <Card
        title="When were the books you read published?"
        eyebrow="Publication age"
        style={{ marginBottom: 48 }}
      >
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
          Each dot is a book: x = publication year, y = year you read it.
          The dashed diagonal marks books read in their publication year.
          Dot size reflects your rating; colour reflects genre.
          Click a genre to hide it.
        </div>
        <PubYearScatter books={readBooks} />
      </Card>
    </div>
  )
}
