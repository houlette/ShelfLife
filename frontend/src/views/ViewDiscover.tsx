import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { DiscoveryCandidate } from '../types'
import { nfmt, ratingColor, goodreadsSearchUrl } from '../utils'
import { SectionTitle, Card, Pill, BookCover } from '../components'

export function ViewDiscover() {
  const [source, setSource] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState<{ generated: number; scored: number; elapsed_s: number } | null>(null)
  const qc = useQueryClient()

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['discover', source],
    queryFn: () => api.discover.list(source ?? undefined),
  })

  async function handleRefresh() {
    setRefreshing(true)
    setRefreshResult(null)
    try {
      const res = await api.discover.refresh()
      setRefreshResult(res)
      qc.invalidateQueries({ queryKey: ['discover'] })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div>
      <SectionTitle
        no="09"
        sub="Books outside your shelf that match your taste — sourced from authors you love and subjects you rate highly."
      >
        Discover
      </SectionTitle>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
          <span className="eyebrow" style={{ marginRight: 8 }}>Source</span>
          <Pill active={source === null} onClick={() => setSource(null)}>All</Pill>
          <Pill active={source === 'author'} onClick={() => setSource('author')}>Authors you love</Pill>
          <Pill active={source === 'subject'} onClick={() => setSource('subject')}>Subjects you rate high</Pill>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            padding: '6px 14px', fontSize: 12, fontFamily: 'inherit',
            border: '1px solid var(--line)', borderRadius: 2,
            background: refreshing ? 'var(--line)' : 'var(--ink)',
            color: refreshing ? 'var(--muted)' : 'var(--paper)',
            cursor: refreshing ? 'default' : 'pointer',
            transition: 'all 120ms ease',
          }}
        >
          {refreshing ? 'Searching…' : 'Refresh discoveries'}
        </button>
      </div>

      {refreshResult && (
        <div style={{
          marginBottom: 20, padding: '10px 16px',
          background: 'var(--hi)', borderRadius: 3,
          fontSize: 12, color: 'var(--ink)',
        }}>
          Found <strong>{refreshResult.generated}</strong> candidates, scored <strong>{refreshResult.scored}</strong> in {refreshResult.elapsed_s}s.
        </div>
      )}

      {isLoading && (
        <div className="mono" style={{ fontSize: 13, color: 'var(--muted)', padding: 32, textAlign: 'center' }}>
          Loading…
        </div>
      )}

      {!isLoading && candidates.length === 0 && (
        <Card>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            No discoveries yet. Click <strong>Refresh discoveries</strong> to find books from authors and subjects you rate highly.
            This queries Open Library and may take 30–120 seconds.
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {candidates.map(c => (
          <DiscoverCard key={c.id} candidate={c} />
        ))}
      </div>
    </div>
  )
}

function DiscoverCard({ candidate: c }: { candidate: DiscoveryCandidate }) {
  const qc = useQueryClient()
  const [dismissed, setDismissed] = useState(false)
  const [added, setAdded] = useState(false)

  const dismissMut = useMutation({
    mutationFn: () => api.discover.dismiss(c.id),
    onSuccess: () => {
      setDismissed(true)
      qc.invalidateQueries({ queryKey: ['discover'] })
    },
  })

  const addMut = useMutation({
    mutationFn: () => api.discover.addToShelf(c.id),
    onSuccess: () => {
      setAdded(true)
      qc.invalidateQueries({ queryKey: ['discover'] })
      qc.invalidateQueries({ queryKey: ['books'] })
    },
  })

  if (dismissed || added) return null

  const scoreColor = c.score != null ? ratingColor(Math.round(c.score)) : 'var(--muted)'
  const evidence = c.source_evidence as Record<string, string | number>
  const evidenceLabel = _evidenceLabel(c.source, evidence)

  return (
    <Card padding={16}>
      <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 120px 160px', gap: 16, alignItems: 'center' }}>
        <BookCover src={c.cover_url} title={c.title} width={56} height={84} />

        <div style={{ minWidth: 0 }}>
          <div className="serif" style={{ fontSize: 17, color: 'var(--ink)', lineHeight: 1.25, marginBottom: 4 }}>
            <a className="book-link" href={goodreadsSearchUrl(c.title, c.author)} target="_blank" rel="noreferrer">{c.title}</a>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {c.author}
            {c.original_pub_year && (
              <span style={{ color: 'var(--muted-2)' }}> · {c.original_pub_year}</span>
            )}
            {c.genre && (
              <span style={{ color: 'var(--muted-2)' }}> · {c.genre}</span>
            )}
          </div>
          {c.reason && (
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 6 }}>{c.reason}</div>
          )}
          {evidenceLabel && (
            <div style={{
              marginTop: 8, display: 'inline-block',
              fontSize: 10.5, color: 'var(--accent)',
              background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
              padding: '2px 8px', borderRadius: 10,
            }}>
              {evidenceLabel}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center' }}>
          {c.score != null ? (
            <>
              <div className="num serif" style={{ fontSize: 32, color: scoreColor, lineHeight: 1, letterSpacing: '-0.02em' }}>
                {c.score.toFixed(2)}
              </div>
              <div className="eyebrow" style={{ marginTop: 4, fontSize: 9.5 }}>predicted</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>—</div>
          )}
          {c.ol_avg_rating != null && (
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>
              OL {c.ol_avg_rating.toFixed(2)}
            </div>
          )}
          {c.ol_ratings_count != null && (
            <div style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 2 }}>
              {nfmt(c.ol_ratings_count)} ratings
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <button
            onClick={() => addMut.mutate()}
            disabled={addMut.isPending}
            style={{
              width: '100%', padding: '6px 10px',
              background: 'var(--accent)', color: 'var(--paper)',
              border: 'none', borderRadius: 2, cursor: 'pointer',
              fontSize: 11.5, fontFamily: 'inherit',
            }}
          >
            {addMut.isPending ? '…' : '+ Add to to-read'}
          </button>
          <button
            onClick={() => dismissMut.mutate()}
            disabled={dismissMut.isPending}
            style={{
              width: '100%', padding: '6px 10px',
              background: 'none', color: 'var(--muted)',
              border: '1px solid var(--line)', borderRadius: 2, cursor: 'pointer',
              fontSize: 11.5, fontFamily: 'inherit',
            }}
          >
            {dismissMut.isPending ? '…' : 'Dismiss'}
          </button>
        </div>
      </div>
    </Card>
  )
}

function _evidenceLabel(source: string, ev: Record<string, string | number>): string {
  if (source === 'author' && ev.author) {
    return `because you love ${ev.author} (${ev.your_avg}★ avg)`
  }
  if (source === 'subject' && ev.subject) {
    const sub = String(ev.subject)
    const cap = sub.charAt(0).toUpperCase() + sub.slice(1)
    return `you rate "${cap}" books ${ev.your_avg}★ avg`
  }
  return ''
}
