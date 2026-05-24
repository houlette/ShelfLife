import type { Book } from '../types'

const CELL = 11
const GAP = 2
const STEP = CELL + GAP

const DAY_ABBR = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** Parse a YYYY-MM-DD string as a local-timezone Date to avoid UTC-shift issues. */
function parseLocal(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function cellBg(count: number): string {
  if (count === 0) return 'color-mix(in srgb, var(--ink) 7%, transparent)'
  if (count === 1) return 'color-mix(in srgb, var(--accent) 45%, var(--surface))'
  if (count === 2) return 'color-mix(in srgb, var(--accent) 72%, var(--surface))'
  return 'var(--accent)'
}

interface YearRowProps {
  year: number
  dateCounts: Map<string, number>
}

function YearRow({ year, dateCounts }: YearRowProps) {
  const jan1 = new Date(year, 0, 1)
  const dec31 = new Date(year, 11, 31)

  // Start from the Sunday on or before Jan 1
  const start = new Date(jan1)
  start.setDate(start.getDate() - start.getDay())

  // Build week columns
  const weeks: Date[][] = []
  const cur = new Date(start)
  while (cur <= dec31) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cur))
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }

  // Month label x-positions (column where the 1st of each month lands)
  const monthLabels: { label: string; x: number }[] = []
  weeks.forEach((week, wi) => {
    week.forEach(day => {
      if (day.getFullYear() === year && day.getDate() === 1) {
        monthLabels.push({ label: MONTH_ABBR[day.getMonth()], x: wi * STEP })
      }
    })
  })

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14 }}>
      {/* Year label */}
      <div style={{
        fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)',
        width: 34, paddingTop: 20, textAlign: 'right', flexShrink: 0,
      }}>
        {year}
      </div>

      <div>
        {/* Month labels */}
        <div style={{ position: 'relative', height: 16, marginBottom: 3 }}>
          {monthLabels.map(({ label, x }) => (
            <span key={label} style={{
              position: 'absolute', left: x,
              fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
            }}>
              {label}
            </span>
          ))}
        </div>

        {/* Day-of-week labels + week grid */}
        <div style={{ display: 'flex', gap: GAP }}>
          {/* Day labels */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, marginRight: 3 }}>
            {DAY_ABBR.map((d, i) => (
              <div key={i} style={{
                height: CELL, width: 8, fontSize: 8, lineHeight: `${CELL}px`,
                color: [1, 3, 5].includes(i) ? 'var(--muted)' : 'transparent',
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Week columns */}
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
              {week.map((day, di) => {
                const inYear = day.getFullYear() === year
                const count = inYear ? (dateCounts.get(toKey(day)) ?? 0) : 0
                const key = toKey(day)
                return (
                  <div
                    key={di}
                    title={inYear && count > 0 ? `${key} — ${count} book${count > 1 ? 's' : ''}` : undefined}
                    style={{
                      width: CELL, height: CELL, borderRadius: 2,
                      background: inYear ? cellBg(count) : 'transparent',
                      cursor: count > 0 ? 'default' : undefined,
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface Props {
  books: Book[]
}

export function CalendarHeatmap({ books }: Props) {
  const dateCounts = new Map<string, number>()
  for (const book of books) {
    if (book.date_read) {
      const key = toKey(parseLocal(book.date_read))
      dateCounts.set(key, (dateCounts.get(key) ?? 0) + 1)
    }
  }

  if (dateCounts.size === 0) return null

  const years = [...dateCounts.keys()].map(k => parseInt(k))
  const minYear = Math.min(...years)
  const maxYear = Math.max(...years)
  const yearList = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      {yearList.map(year => (
        <YearRow key={year} year={year} dateCounts={dateCounts} />
      ))}

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, paddingLeft: 42 }}>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>Less</span>
        {[0, 1, 2, 3].map(n => (
          <div key={n} style={{
            width: CELL, height: CELL, borderRadius: 2, background: cellBg(n),
          }} />
        ))}
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>More</span>
      </div>
    </div>
  )
}
