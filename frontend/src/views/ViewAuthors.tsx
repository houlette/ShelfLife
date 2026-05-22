import { useMemo, useState } from 'react'
import type { Book } from '../types'
import { nfmt, filterBooksByRange } from '../utils'
import type { Range } from '../utils'
import { SectionTitle, Stat, Card } from '../components'
import { RatingStars } from '../components/RatingStars'
import { HBar } from '../charts'
import { api } from '../api'
import { useQueryClient } from '@tanstack/react-query'

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
        <div style={{ marginBottom: 48 }}>
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

      <DiversitySection books={readBooks} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diversity section
// ---------------------------------------------------------------------------

const GENDER_COLORS: Record<string, string> = {
  'Man':        '#5b8ed6',
  'Woman':      '#d65b8e',
  'Non-binary': '#8e5bd6',
  'Other':      '#7ab8a0',
  'Unknown':    'var(--line-soft)',
}

const ETHNICITY_COLORS: Record<string, string> = {
  'Black / African':   '#d6904e',
  'Asian':             '#d4c94a',
  'Hispanic / Latino': '#6ac86a',
  'Middle Eastern':    '#d65b5b',
  'Jewish':            '#c8a44a',
  'Indigenous':        '#a07ad6',
  'White / European':  '#7ab8d6',
  'Other':             '#8ab0b8',
  'Unknown':           'var(--line-soft)',
}

const ETHNICITY_ORDER = [
  'Black / African', 'Asian', 'Hispanic / Latino',
  'Middle Eastern', 'Jewish', 'Indigenous', 'White / European', 'Other', 'Unknown',
]

function groupEthnicity(raw: string | null): string {
  if (!raw) return 'Unknown'
  const l = raw.toLowerCase()
  // Exact match on stored group names first (fast path for enriched data)
  if (l === 'jewish') return 'Jewish'
  if (l === 'black / african') return 'Black / African'
  if (l === 'asian') return 'Asian'
  if (l === 'hispanic / latino') return 'Hispanic / Latino'
  if (l === 'middle eastern') return 'Middle Eastern'
  if (l === 'indigenous') return 'Indigenous'
  if (l === 'white / european') return 'White / European'
  // Regex fallback for legacy or partial strings
  if (/jewish/.test(l)) return 'Jewish'
  if (/white|european|british|english|irish|french|german|italian|polish|dutch|scandinavian|swedish|norwegian|danish|finnish|greek|spanish|portuguese|australian/.test(l)) return 'White / European'
  if (/black|african american|african|nigerian|ghanaian|kenyan|ugandan|jamaican|haitian|caribbean|cameroonian|senegalese|zimbabwean/.test(l)) return 'Black / African'
  if (/asian|chinese|japanese|korean|indian|south asian|pakistani|bangladeshi|vietnamese|thai|filipino|east asian|southeast asian|bengali|tamil/.test(l)) return 'Asian'
  if (/hispanic|latino|latina|mexican|cuban|puerto rican|colombian|argentinian|venezuelan|peruvian|chilean|brazilian|ecuadorian/.test(l)) return 'Hispanic / Latino'
  if (/arab|arabic|middle east|iranian|turkish|lebanese|israeli|moroccan|egyptian|persian|afghan|kurdish/.test(l)) return 'Middle Eastern'
  if (/native american|indigenous|first nations|aboriginal|cherokee|navajo|lakota|māori|inuit|ojibwe/.test(l)) return 'Indigenous'
  return 'Other'
}

const POLL_MS = 3000

function DiversitySection({ books }: { books: Book[] }) {
  const qc = useQueryClient()
  const [enriching, setEnriching] = useState(false)
  const [progress, setProgress] = useState<{
    authors_processed: number; authors_enriched: number; books_updated: number; errors: number
  } | null>(null)
  const [done, setDone] = useState(false)
  const [enrichError, setEnrichError] = useState<string | null>(null)

  // Compute per-author demographics from all read books
  const authorDemographics = useMemo(() => {
    const map: Record<string, { gender: string | null; ethnicity: string | null }> = {}
    for (const b of books) {
      if (!b.author) continue
      if (!map[b.author]) map[b.author] = { gender: null, ethnicity: null }
      if (!map[b.author].gender && b.author_gender) map[b.author].gender = b.author_gender
      if (!map[b.author].ethnicity && b.author_ethnicity) map[b.author].ethnicity = b.author_ethnicity
    }
    return map
  }, [books])

  const totalAuthors = Object.keys(authorDemographics).length
  const enrichedAuthors = Object.values(authorDemographics).filter(d => d.gender != null).length

  const genderBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const { gender } of Object.values(authorDemographics)) {
      const key = gender ?? 'Unknown'
      counts[key] = (counts[key] ?? 0) + 1
    }
    const order = ['Man', 'Woman', 'Non-binary', 'Other', 'Unknown']
    return order
      .filter(g => (counts[g] ?? 0) > 0)
      .map(g => ({ label: g, value: counts[g] ?? 0, color: GENDER_COLORS[g] }))
  }, [authorDemographics])

  const ethnicityBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const { ethnicity } of Object.values(authorDemographics)) {
      const key = groupEthnicity(ethnicity)
      counts[key] = (counts[key] ?? 0) + 1
    }
    return ETHNICITY_ORDER
      .filter(e => (counts[e] ?? 0) > 0)
      .map(e => ({ label: e, value: counts[e] ?? 0, color: ETHNICITY_COLORS[e] }))
  }, [authorDemographics])

  // Per-author average of rated books (my_rating > 0)
  const authorRatingMap = useMemo(() => {
    const byAuthor: Record<string, number[]> = {}
    for (const b of books) {
      if (!b.author || b.my_rating <= 0) continue
      ;(byAuthor[b.author] ??= []).push(b.my_rating)
    }
    const out: Record<string, number> = {}
    for (const [a, ratings] of Object.entries(byAuthor))
      out[a] = ratings.reduce((s, r) => s + r, 0) / ratings.length
    return out
  }, [books])

  // Average per-author rating grouped by gender (min 3 rated authors per group)
  const ratingByGender = useMemo(() => {
    const groups: Record<string, number[]> = {}
    for (const [author, data] of Object.entries(authorDemographics)) {
      const avg = authorRatingMap[author]
      if (avg == null) continue
      const key = data.gender ?? 'Unknown'
      ;(groups[key] ??= []).push(avg)
    }
    const order = ['Man', 'Woman', 'Non-binary', 'Other', 'Unknown']
    return order
      .filter(g => (groups[g]?.length ?? 0) >= 3)
      .map(g => ({ label: g, value: groups[g].reduce((s, v) => s + v, 0) / groups[g].length, color: GENDER_COLORS[g], count: groups[g].length }))
      .sort((a, b) => b.value - a.value)
  }, [authorDemographics, authorRatingMap])

  // Average per-author rating grouped by cultural origin (min 3 rated authors per group)
  const ratingByOrigin = useMemo(() => {
    const groups: Record<string, number[]> = {}
    for (const [author, data] of Object.entries(authorDemographics)) {
      const avg = authorRatingMap[author]
      if (avg == null) continue
      const key = groupEthnicity(data.ethnicity)
      ;(groups[key] ??= []).push(avg)
    }
    return ETHNICITY_ORDER
      .filter(e => (groups[e]?.length ?? 0) >= 3)
      .map(e => ({ label: e, value: groups[e].reduce((s, v) => s + v, 0) / groups[e].length, color: ETHNICITY_COLORS[e], count: groups[e].length }))
      .sort((a, b) => b.value - a.value)
  }, [authorDemographics, authorRatingMap])

  async function runEnrichmentPoll() {
    // Fire-and-forget POST — returns immediately, enrichment runs in background
    await api.diversityEnrich()
    // Poll until done
    while (true) {
      await new Promise(r => setTimeout(r, POLL_MS))
      const status = await api.diversityStatus()
      setProgress(status.task)
      qc.invalidateQueries({ queryKey: ['books'] })
      if (!status.task.running) break
    }
  }

  async function handleEnrich() {
    setEnriching(true)
    setDone(false)
    setProgress(null)
    setEnrichError(null)
    try {
      await runEnrichmentPoll()
    } catch (e) {
      setEnrichError(String(e))
    } finally {
      setEnriching(false)
      setDone(true)
    }
  }

  async function handleReclassify() {
    // Reset authors tagged Middle Eastern (Jewish fix) + those with no origin
    // found (enables the new P27 nationality fallback), then re-enrich.
    setEnriching(true)
    setDone(false)
    setProgress(null)
    setEnrichError(null)
    try {
      await api.diversityReset('middle_eastern')
      await api.diversityReset('unresolved')
      await runEnrichmentPoll()
    } catch (e) {
      setEnrichError(String(e))
    } finally {
      setEnriching(false)
      setDone(true)
    }
  }

  function handleStop() {
    api.diversityStop().catch(() => {/* ignore */})
  }

  const sectionNo = '03'

  return (
    <div>
      <SectionTitle
        no={sectionNo}
        sub={`${nfmt(enrichedAuthors)} of ${nfmt(totalAuthors)} unique authors enriched`}
      >
        Diversity
      </SectionTitle>

      {/* Enrich controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: progress ? 16 : 32, flexWrap: 'wrap' }}>
        {!enriching ? (
          <>
            <button
              onClick={handleEnrich}
              style={{
                padding: '8px 16px', fontSize: 12, cursor: 'pointer',
                background: 'var(--paper)', border: '1px solid var(--line)',
                borderRadius: 2, color: 'var(--ink)', fontFamily: 'inherit',
              }}
            >
              Enrich new authors
            </button>
            <button
              onClick={handleReclassify}
              style={{
                padding: '8px 16px', fontSize: 12, cursor: 'pointer',
                background: 'var(--paper)', border: '1px solid var(--line)',
                borderRadius: 2, color: 'var(--muted)', fontFamily: 'inherit',
              }}
              title="Resets Middle Eastern authors (Jewish fix) and previously-unresolved authors (P27 fallback), then re-enriches"
            >
              Re-classify existing
            </button>
          </>
        ) : (
          <button
            onClick={handleStop}
            style={{
              padding: '8px 16px', fontSize: 12, cursor: 'pointer',
              background: 'var(--paper)', border: '1px solid var(--line)',
              borderRadius: 2, color: 'var(--m2)', fontFamily: 'inherit',
            }}
          >
            Stop
          </button>
        )}
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {enriching
            ? `Searching… ${nfmt(totalAuthors - enrichedAuthors)} authors remaining`
            : `${nfmt(totalAuthors - enrichedAuthors)} authors not yet searched`}
        </div>
      </div>

      {enrichError && (
        <div style={{ marginBottom: 24, padding: '10px 14px', fontSize: 13, color: 'var(--m1)',
          background: 'color-mix(in srgb, var(--m1) 10%, transparent)',
          border: '1px solid var(--m1)', borderRadius: 4 }}>
          {enrichError}
        </div>
      )}

      {progress && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
          {[
            { label: 'Authors searched', value: progress.authors_processed },
            { label: 'Authors enriched', value: progress.authors_enriched },
            { label: 'Books updated', value: progress.books_updated },
            { label: 'Errors', value: progress.errors },
          ].map(s => (
            <div key={s.label} style={{ padding: '14px 16px', border: '1px solid var(--line)', borderRadius: 2 }}>
              <div className="num serif" style={{ fontSize: 24, color: 'var(--ink)', lineHeight: 1 }}>{s.value}</div>
              <div className="eyebrow" style={{ marginTop: 4 }}>
                {s.label}{!done && s.label === 'Authors searched' ? '…' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      {enrichedAuthors === 0 ? (
        <div style={{ padding: '32px 0', fontSize: 13, color: 'var(--muted)' }}>
          No demographic data yet. Click "Enrich from Wikidata" to start.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <Card title="Gender" eyebrow={`${nfmt(enrichedAuthors)} authors · all-time reads`} style={{ minWidth: 0 }}>
              <HBar
                items={genderBreakdown}
                format={v => `${v} (${totalAuthors ? Math.round(v / totalAuthors * 100) : 0}%)`}
              />
            </Card>
            <Card title="Geographic / Cultural Origin" eyebrow="Wikipedia categories · Wikidata P27 nationality" style={{ minWidth: 0 }}>
              <HBar
                items={ethnicityBreakdown}
                format={v => `${v} (${totalAuthors ? Math.round(v / totalAuthors * 100) : 0}%)`}
              />
            </Card>
          </div>

          {(ratingByGender.length > 0 || ratingByOrigin.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 24 }}>
              <Card title="Avg rating by gender" eyebrow="per-author avg · rated authors only · ≥3 per group" style={{ minWidth: 0 }}>
                <HBar
                  items={ratingByGender}
                  max={5}
                  format={v => v.toFixed(2)}
                />
              </Card>
              <Card title="Avg rating by origin" eyebrow="per-author avg · rated authors only · ≥3 per group" style={{ minWidth: 0 }}>
                <HBar
                  items={ratingByOrigin}
                  max={5}
                  format={v => v.toFixed(2)}
                />
              </Card>
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--muted-2)', lineHeight: 1.6 }}>
        Gender from Wikidata P21; origin from Wikipedia article categories with Wikidata P27
        nationality as fallback for authors outside the US/UK/Western Europe. "Unknown" is
        predominantly white American and British authors — Wikipedia treats this as the unmarked
        default and does not categorise it. Click "Re-classify existing" after updating to apply
        the Jewish bucket fix and P27 fallback to already-searched authors.
      </div>
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
