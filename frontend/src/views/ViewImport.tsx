import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { SectionTitle, Card, StatCard } from '../components'
import { nfmt } from '../utils'

export function ViewImport() {
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<{ total_rows: number; inserted: number; errors: string[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setError('Please upload a .csv file')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
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
    <div>
      <SectionTitle no="01" sub="Upload your Goodreads library export to get started.">
        Import data
      </SectionTitle>

      <Card style={{ marginBottom: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Goodreads CSV export</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
          Go to <strong style={{ color: 'var(--ink)' }}>goodreads.com/review/import</strong> and click
          <strong style={{ color: 'var(--ink)' }}> Export Library</strong>.
          Goodreads will email you a link to download the CSV. Upload that file here.
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) handleFile(file)
          }}
          onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.csv'
            input.onchange = () => { if (input.files?.[0]) handleFile(input.files[0]) }
            input.click()
          }}
          style={{
            border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--line)'}`,
            borderRadius: 4,
            padding: '48px 24px',
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
              <div style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>
                Drop your goodreads_library_export.csv here
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>or click to browse</div>
            </>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 16, padding: '10px 14px', background: 'color-mix(in srgb, var(--m1) 10%, transparent)', border: '1px solid var(--m1)', borderRadius: 4, fontSize: 13, color: 'var(--m1)' }}>
            {error}
          </div>
        )}
      </Card>

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
          <StatCard label="Rows processed" value={result.total_rows} />
          <StatCard label="Books imported" value={result.inserted} />
          <StatCard label="Errors" value={result.errors.length} color={result.errors.length ? 'var(--m1)' : 'var(--accent)'} />
        </div>
      )}

      {result && result.errors.length > 0 && (
        <Card title="Import errors" style={{ marginBottom: 32 }}>
          {result.errors.map((e, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--m2)', padding: '4px 0', borderTop: i ? '1px solid var(--line-soft)' : 'none' }}>
              {e}
            </div>
          ))}
        </Card>
      )}

      <EnrichmentSection />
      <CFSection />
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
  const { data: status, refetch } = useQuery({
    queryKey: ['enrich-status'],
    queryFn: () => api.enrichStatus(),
    refetchInterval: 5000,
  })
  const [running, setRunning] = useState(false)

  async function startEnrich() {
    setRunning(true)
    try {
      await api.enrichLibrary()
      qc.invalidateQueries({ queryKey: ['books'] })
      qc.invalidateQueries({ queryKey: ['genres'] })
      refetch()
    } finally {
      setRunning(false)
    }
  }

  if (!status) return null

  const remaining = status.with_isbn - status.enriched
  const pct = status.with_isbn ? Math.round((status.enriched / status.with_isbn) * 100) : 0

  return (
    <Card title="Enrich from Open Library" eyebrow="Add covers, genres, and ratings" style={{ marginTop: 32 }}>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
        Fetches cover art, subjects (normalized to genres), and community ratings from
        Open Library for each book with an ISBN. Rate-limited to ~5 books/sec.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard label="With ISBN" value={nfmt(status.with_isbn)} sub={`of ${nfmt(status.total)} total`} />
        <StatCard label="Enriched" value={nfmt(status.enriched)} sub={`${pct}% complete`} />
        <StatCard label="With cover" value={nfmt(status.with_cover)} />
        <StatCard label="With genre" value={nfmt(status.with_genre)} />
      </div>

      <button
        onClick={startEnrich}
        disabled={running || remaining <= 0}
        style={{
          padding: '10px 20px', fontSize: 13, borderRadius: 4,
          background: remaining > 0 ? 'var(--ink)' : 'var(--surface)',
          color: remaining > 0 ? 'var(--paper)' : 'var(--muted)',
          border: '1px solid var(--line)',
          cursor: remaining > 0 && !running ? 'pointer' : 'default',
          fontFamily: 'inherit',
        }}
      >
        {running ? 'Enriching…' : remaining > 0 ? `Enrich ${nfmt(remaining)} books` : 'All caught up'}
      </button>
    </Card>
  )
}
