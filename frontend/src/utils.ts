import type { Book, ReadingPeriod } from './types'

export const MS_DAY = 86_400_000
export const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
export const MONTH_LONG  = ["January","February","March","April","May","June","July","August","September","October","November","December"]
export const DOW_SHORT   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]

// ─── Formatting ──────────────────────────────────────────────────────────────

export function fmtDate(d: string | Date, kind?: "long" | "month" | "md"): string {
  const dt = typeof d === "string" ? new Date(d + "T00:00:00Z") : d
  const y   = dt.getUTCFullYear()
  const m   = dt.getUTCMonth()
  const day = dt.getUTCDate()
  const dow = dt.getUTCDay()
  if (kind === "long")  return `${DOW_SHORT[dow]}, ${MONTH_LONG[m]} ${day}, ${y}`
  if (kind === "month") return `${MONTH_NAMES[m]} ${y}`
  if (kind === "md")    return `${MONTH_NAMES[m]} ${day}`
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function nfmt(n: number | null | undefined, d = 0): string {
  if (n == null || isNaN(n)) return "—"
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function pct(n: number | null | undefined): string {
  return n == null ? "—" : Math.round(n * 100) + "%"
}

// ─── Statistics ──────────────────────────────────────────────────────────────

function _clean(arr: (number | null | undefined)[]): number[] {
  return arr.filter((v): v is number => v != null && !isNaN(v))
}

export function mean(arr: (number | null | undefined)[]): number | null {
  const xs = _clean(arr)
  if (!xs.length) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

export function median(arr: (number | null | undefined)[]): number | null {
  const xs = _clean(arr).slice().sort((a, b) => a - b)
  if (!xs.length) return null
  const m = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2
}

export function rolling(
  arr: (number | null | undefined)[],
  n: number,
  fn: (window: (number | null | undefined)[]) => number | null = mean,
): (number | null)[] {
  return arr.map((_, i) => {
    const start = Math.max(0, i - n + 1)
    return fn(arr.slice(start, i + 1))
  })
}

// ─── Date helpers ────────────────────────────────────────────────────────────

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ─── Color: rating ──────────────────────────────────────────────────────────

export function ratingColor(rating: number | null | undefined): string {
  if (rating == null || rating === 0) return "var(--line)"
  if (rating <= 1) return "var(--m1)"
  if (rating <= 2) return "var(--m2)"
  if (rating <= 3) return "var(--m3)"
  if (rating <= 4) return "var(--m4)"
  return "var(--m5)"
}

// ─── Book helpers ───────────────────────────────────────────────────────────

export function goodreadsUrl(goodreads_book_id: number): string {
  return `https://www.goodreads.com/book/show/${goodreads_book_id}`
}

export function goodreadsSearchUrl(title: string, author?: string | null): string {
  const q = encodeURIComponent(author ? `${title} ${author}` : title)
  return `https://www.goodreads.com/search?q=${q}`
}

export function effectiveDate(book: Book): string | null {
  return book.date_read ?? null
}

export type Range = '1y' | '3y' | '5y' | 'all'
export type Granularity = 'month' | 'year'

export function filterBooksByRange(books: Book[], range: Range): Book[] {
  if (range === 'all') return books
  const days = range === '1y' ? 365 : range === '3y' ? 365 * 3 : 365 * 5
  const cutoff = Date.now() - days * MS_DAY
  return books.filter(b => {
    const d = effectiveDate(b)
    if (!d) return false
    return new Date(d + 'T00:00:00Z').getTime() >= cutoff
  })
}

export function aggregateBooks(books: Book[], granularity: Granularity): ReadingPeriod[] {
  const readBooks = books.filter(b => b.exclusive_shelf === 'read')
  const groups = new Map<string, Book[]>()

  for (const b of readBooks) {
    const d = effectiveDate(b)
    if (!d) continue
    const dt = new Date(d + 'T00:00:00Z')
    const key = granularity === 'month'
      ? `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
      : `${dt.getUTCFullYear()}`
    ;(groups.get(key) ?? (groups.set(key, []), groups.get(key)!)).push(b)
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const rated = group.filter(b => b.my_rating > 0)
      const parts = key.split('-')
      return {
        period: key,
        year: +parts[0],
        month: parts[1] ? +parts[1] : undefined,
        books: group.length,
        pages: group.reduce((s, b) => s + (b.num_pages ?? 0), 0),
        avgRating: rated.length ? rated.reduce((s, b) => s + b.my_rating, 0) / rated.length : null,
        titles: group.map(b => b.title),
      }
    })
}
