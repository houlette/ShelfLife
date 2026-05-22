import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { BooklistPendingEntry } from '../types'
import { SectionTitle, Card, StatCard, BookCover } from '../components'
import { nfmt } from '../utils'

export function ViewImport() {
  return (
    <div>
      <SectionTitle no="01" sub="Upload your library exports to get started.">
        Import data
      </SectionTitle>
      <GoodreadsSection />
      <BooklistSection />
      <BooklistPendingSection />
      <EnrichmentSection />
      <CFSection />
    </div>
  )
}

function DropZone({ label, sublabel, loading, dragging, onDragOver, onDragLeave, onDrop, onClick }: {
  label: string
  sublabel: string
  loading: boolean
  dragging: boolean
  onDragOver: React.DragEventHandler
  onDragLeave: React.DragEventHandler
  onDrop: React.DragEventHandler
  onClick: () => void
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      style={{
        border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--line)'}`,
        borderRadius: 4,
        padding: '40px 24px',
        textAlign: 'center',
        cursor: 'pointer',
        background: dragging ? 'color-mix(in srgb, var(--accent) 5%, transparent)' : 'transparent',
        transition: 'all 150ms ease',
      }}
    >
      {loading ? (
        <div className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>Importing…</div>
      ) : (
        <>
          <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sublabel}</div>
        </>
      )}
    </div>
  )
}

function GoodreadsSection() {
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<{ total_rows: number; inserted: number; errors: string[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) { setError('Please upload a .csv file'); return }
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await api.uploadGoodreads(file)
      setResult(res)
      qc.invalidateQueries({ queryKey: ['books'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [qc])

  return (
    <Card style={{ marginBottom: 24 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Goodreads CSV export</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
        Go to <strong style={{ color: 'var(--ink)' }}>goodreads.com/review/import</strong> and click
        <strong style={{ color: 'var(--ink)' }}> Export Library</strong>.
        Goodreads will email you a link to download the CSV. Upload that file here.
      </div>
      <DropZone
        label="Drop your goodreads_library_export.csv here"
        sublabel="or click to browse"
        loading={loading}
        dragging={dragging}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.csv'; i.onchange = () => { if (i.files?.[0]) handleFile(i.files[0]) }; i.click() }}
      />
      {error && <ErrorBanner message={error} />}
      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 20 }}>
          <StatCard label="Rows processed" value={result.total_rows} />
          <StatCard label="Books imported" value={result.inserted} />
          <StatCard label="Errors" value={result.errors.length} color={result.errors.length ? 'var(--m1)' : 'var(--accent)'} />
        </div>
      )}
      {result?.errors && result.errors.length > 0 && <ErrorList errors={result.errors} />}
    </Card>
  )
}

function BooklistSection() {
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<{ total_rows: number; matched: number; inserted: number; pending: number; errors: string[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) { setError('Please upload a .csv file'); return }
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await api.uploadBooklist(file)
      setResult(res)
      qc.invalidateQueries({ queryKey: ['books'] })
      qc.invalidateQueries({ queryKey: ['booklist-pending'] })
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [qc])

  return (
    <Card style={{ marginBottom: 24 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Personal book list</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
        Upload a CSV with columns: <strong style={{ color: 'var(--ink)' }}>Index, Author Last, Author First, Title, Read?, Category, Subcategory, Year Acquired, Status, From</strong>.
        Books already in your Goodreads library are matched by title and marked as owned.
        Books not in Goodreads are added as new entries. Goodreads data takes precedence on all fields.
      </div>
      <DropZone
        label="Drop your booklist CSV here"
        sublabel="or click to browse"
        loading={loading}
        dragging={dragging}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.csv'; i.onchange = () => { if (i.files?.[0]) handleFile(i.files[0]) }; i.click() }}
      />
      {error && <ErrorBanner message={error} />}
      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginTop: 20 }}>
          <StatCard label="Rows processed" value={result.total_rows} />
          <StatCard label="Matched (owned)" value={result.matched} />
          <StatCard label="New books added" value={result.inserted} />
          <StatCard label="Needs review" value={result.pending ?? 0} color={(result.pending ?? 0) > 0 ? 'var(--accent-3)' : undefined} />
          <StatCard label="Errors" value={result.errors.length} color={result.errors.length ? 'var(--m1)' : 'var(--accent)'} />
        </div>
      )}
      {result?.errors && result.errors.length > 0 && <ErrorList errors={result.errors} />}
    </Card>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{ marginTop: 16, padding: '10px 14px', background: 'color-mix(in srgb, var(--m1) 10%, transparent)', border: '1px solid var(--m1)', borderRadius: 4, fontSize: 13, color: 'var(--m1)' }}>
      {message}
    </div>
  )
}

function ErrorList({ errors }: { errors: string[] }) {
  return (
    <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--surface)', borderRadius: 4 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Errors</div>
      {errors.map((e, i) => (
        <div key={i} style={{ fontSize: 12, color: 'var(--m2)', padding: '4px 0', borderTop: i ? '1px solid var(--line-soft)' : 'none' }}>
          {e}
        </div>
      ))}
    </div>
  )
}

function BooklistPendingSection() {
  const qc = useQueryClient()
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['booklist-pending'],
    queryFn: () => api.booklistPending(),
  })

  const resolveMut = useMutation({
    mutationFn: ({ id, action, bookId }: { id: number; action: string; bookId?: number }) =>
      api.resolvePending(id, action, bookId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['booklist-pending'] })
      qc.invalidateQueries({ queryKey: ['books'] })
      qc.invalidateQueries({ queryKey: ['enrich-status'] })
    },
  })

  if (isLoading || entries.length === 0) return null

  return (
    <Card
      title={`Possible duplicates — ${entries.length} to review`}
      eyebrow="Needs attention"
      style={{ marginBottom: 24, borderLeft: '3px solid var(--accent-3)' }}
    >
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
        These sheet entries matched a title in your library but the author didn't match exactly.
        Merge each one with the right book, add it as a new entry, or dismiss it.
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {entries.map(entry => (
          <PendingEntryCard key={entry.id} entry={entry} onResolve={(action, bookId) =>
            resolveMut.mutate({ id: entry.id, action, bookId })
          } />
        ))}
      </div>
    </Card>
  )
}

function PendingEntryCard({ entry, onResolve }: {
  entry: BooklistPendingEntry
  onResolve: (action: string, bookId?: number) => void
}) {
  const shelfLabel = entry.read_flag?.toLowerCase() === 'yes' ? 'read' : 'to-read'

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr',
      gap: 16, padding: 16,
      background: 'var(--surface)', borderRadius: 4,
      border: '1px solid var(--line-soft)',
    }}>
      {/* Left: sheet data */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>From your sheet</div>
        <div className="serif" style={{ fontSize: 15, color: 'var(--ink)', lineHeight: 1.3, marginBottom: 4 }}>
          {entry.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{entry.author ?? '—'}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {entry.category && (
            <span style={{ fontSize: 10.5, padding: '2px 8px', background: 'var(--line-soft)', borderRadius: 10, color: 'var(--muted)' }}>
              {entry.category}
            </span>
          )}
          <span style={{ fontSize: 10.5, padding: '2px 8px', background: 'var(--line-soft)', borderRadius: 10, color: 'var(--muted)' }}>
            {shelfLabel}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => onResolve('insert')} style={{
            padding: '5px 12px', fontSize: 11.5, fontFamily: 'inherit',
            border: '1px solid var(--line)', borderRadius: 2, cursor: 'pointer',
            background: 'var(--paper)', color: 'var(--ink)',
          }}>
            Add as new book
          </button>
          <button onClick={() => onResolve('dismiss')} style={{
            padding: '5px 12px', fontSize: 11.5, fontFamily: 'inherit',
            border: '1px solid var(--line)', borderRadius: 2, cursor: 'pointer',
            background: 'transparent', color: 'var(--muted)',
          }}>
            Dismiss
          </button>
        </div>
      </div>

      {/* Right: candidate books */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Possible match{entry.candidates.length !== 1 ? 'es' : ''} in library</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {entry.candidates.map(c => (
            <div key={c.id} style={{
              display: 'grid', gridTemplateColumns: '40px 1fr auto',
              gap: 10, alignItems: 'center',
              padding: '8px 10px', background: 'var(--paper)',
              borderRadius: 3, border: '1px solid var(--line-soft)',
            }}>
              <BookCover src={c.cover_url} title={c.title} width={32} height={48} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.3 }}>{c.title}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {c.author ?? '—'}
                  {c.original_pub_year && <span style={{ color: 'var(--muted-2)' }}> · {c.original_pub_year}</span>}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted-2)', marginTop: 2 }}>{c.exclusive_shelf ?? ''}</div>
              </div>
              <button onClick={() => onResolve('merge', c.id)} style={{
                padding: '5px 10px', fontSize: 11, fontFamily: 'inherit',
                border: 'none', borderRadius: 2, cursor: 'pointer',
                background: 'var(--accent)', color: 'var(--paper)', whiteSpace: 'nowrap',
              }}>
                Merge →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CFSection() {
  const qc = useQueryClient()
  const { data: status, refetch } = useQuery({
    queryKey: ['cf-status'],
    queryFn: () => api.cfStatus(),
  })
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function start() {
    setRunning(true)
    setResult(null)
    try {
      const r = await api.cfRebuild()
      setResult(`Ingested ${nfmt(r.ingest.resolved_rows)} ratings; built ${nfmt(r.similarity.pairs_stored)} similarity pairs across ${nfmt(r.similarity.books_covered)} books.`)
      qc.invalidateQueries({ queryKey: ['recommendations'] })
      refetch()
    } catch (e) {
      setResult(`Error: ${e}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card title="Collaborative filtering" eyebrow="External rating datasets" style={{ marginTop: 32 }}>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
        Loads the UCSD Goodreads dataset (Wan &amp; McAuley, RecSys 2018) — ~228M ratings from 800K users
        on 1.5M books — and computes item-item similarity. The recommender uses this to predict your rating
        from readers with similar taste. Reviews from the same dataset are wired in as a phase-2 signal.
      </div>

      {status && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          <StatCard label="Ratings loaded" value={nfmt(status.ratings_loaded)} />
          <StatCard label="Books covered" value={nfmt(status.books_covered)} sub="overlap with your library" />
          <StatCard label="Similarity pairs" value={nfmt(status.similarity_pairs)} />
        </div>
      )}

      <button
        onClick={start}
        disabled={running}
        style={{
          padding: '10px 20px', fontSize: 13, borderRadius: 4,
          background: 'var(--ink)', color: 'var(--paper)',
          border: '1px solid var(--line)', cursor: running ? 'default' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {running ? 'Rebuilding…' : 'Rebuild CF data'}
      </button>

      {result && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>{result}</div>
      )}
    </Card>
  )
}

function EnrichmentSection() {
  const qc = useQueryClient()
  const { data: status } = useQuery({
    queryKey: ['enrich-status'],
    queryFn: () => api.enrichStatus(),
    refetchInterval: 3000,
  })

  if (!status) return null

  const task = status.enrich_task
  const isRunning = task?.running ?? false
  const job = task?.job ?? null

  const remaining = status.total - status.enriched
  const pct = status.total ? Math.round((status.enriched / status.total) * 100) : 0

  async function startEnrich() {
    await api.enrichLibrary()
    qc.invalidateQueries({ queryKey: ['enrich-status'] })
  }

  async function startCovers() {
    await api.enrichCovers()
    qc.invalidateQueries({ queryKey: ['enrich-status'] })
  }

  // Progress label shown while a task runs
  function progressLine() {
    if (!isRunning || !task) return null
    const label = job === 'covers' ? 'Fetching covers' : 'Enriching'
    return (
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
        {label}… {nfmt(task.processed)} processed · {nfmt(task.enriched)} updated
        {task.not_found > 0 && ` · ${nfmt(task.not_found)} not found`}
      </div>
    )
  }

  return (
    <Card title="Enrich from Open Library" eyebrow="Add covers, genres, and ratings" style={{ marginTop: 32 }}>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
        Fetches cover art, subjects (normalized to genres), and community ratings from
        Open Library for each book with an ISBN. Books without an ISBN are looked up by
        title and author. Rate-limited to ~5 books/sec.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard label="With ISBN" value={nfmt(status.with_isbn)} sub={`of ${nfmt(status.total)} total`} />
        <StatCard label="Enriched" value={nfmt(status.enriched)} sub={`${pct}% complete`} />
        <StatCard label="With cover" value={nfmt(status.with_cover)} />
        <StatCard label="With genre" value={nfmt(status.with_genre)} />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={startEnrich}
          disabled={isRunning || remaining <= 0}
          style={{
            padding: '10px 20px', fontSize: 13, borderRadius: 4,
            background: remaining > 0 && !isRunning ? 'var(--ink)' : 'var(--surface)',
            color: remaining > 0 && !isRunning ? 'var(--paper)' : 'var(--muted)',
            border: '1px solid var(--line)',
            cursor: remaining > 0 && !isRunning ? 'pointer' : 'default',
            fontFamily: 'inherit',
          }}
        >
          {isRunning && job === 'enrich' ? 'Enriching…' : remaining > 0 ? `Enrich ${nfmt(remaining)} books` : 'All enriched'}
        </button>

        {status.missing_covers > 0 && (
          <button
            onClick={startCovers}
            disabled={isRunning}
            style={{
              padding: '10px 20px', fontSize: 13, borderRadius: 4,
              background: 'transparent',
              color: isRunning ? 'var(--muted)' : 'var(--ink)',
              border: '1px solid var(--line)',
              cursor: isRunning ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {isRunning && job === 'covers' ? 'Fetching covers…' : `Backfill ${nfmt(status.missing_covers)} missing covers`}
          </button>
        )}
      </div>

      {progressLine()}
    </Card>
  )
}
