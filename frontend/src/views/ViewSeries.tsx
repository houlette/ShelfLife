import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { SeriesStat, SeriesEntry } from '../types'
import { SectionTitle, Card, StatCard } from '../components'

type StatusFilter = 'all' | 'in-progress' | 'complete' | 'unstarted'

function seriesStatus(s: SeriesStat): 'complete' | 'in-progress' | 'unstarted' {
  const owned = s.entries.filter(e => e.owned)
  const readCount = owned.filter(e => e.shelf === 'read').length
  if (readCount === 0) return 'unstarted'
  if (readCount === owned.length && owned.length > 0) return 'complete'
  return 'in-progress'
}

const STATUS_COLORS: Record<string, string> = {
  complete:    'var(--accent)',
  'in-progress': 'var(--accent-3)',
  unstarted:   'var(--muted)',
}

const STATUS_LABELS: Record<string, string> = {
  complete:    'Complete',
  'in-progress': 'In Progress',
  unstarted:   'Unstarted',
}

const SHELF_COLOR: Record<string, string> = {
  'read':              'var(--accent)',
  'currently-reading': 'var(--accent-3)',
  'to-read':           'var(--muted-2)',
}

function PositionPip({ entry }: { entry: SeriesEntry }) {
  const isOwned = entry.owned
  const color = isOwned ? (SHELF_COLOR[entry.shelf ?? ''] ?? 'var(--muted-2)') : 'transparent'
  const borderColor = isOwned ? color : 'var(--line)'

  return (
    <div title={entry.title ?? `Book ${entry.position}`} style={{
      width: 24, height: 24,
      borderRadius: '50%',
      border: `2px solid ${borderColor}`,
      background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <span style={{
        fontSize: 9,
        fontFamily: 'var(--font-mono)',
        color: isOwned ? 'var(--paper)' : 'var(--muted)',
        lineHeight: 1,
      }}>
        {entry.position}
      </span>
    </div>
  )
}

function SeriesCard({ series }: { series: SeriesStat }) {
  const status = seriesStatus(series)
  const ownedCount = series.entries.filter(e => e.owned).length
  const readCount = series.entries.filter(e => e.shelf === 'read').length
  const missingCount = series.entries.filter(e => !e.owned).length

  return (
    <div style={{
      padding: '16px 20px',
      background: 'var(--surface)',
      border: '1px solid var(--line-soft)',
      borderRadius: 4,
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 12,
      alignItems: 'start',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <span className="serif" style={{ fontSize: 15, color: 'var(--ink)', fontWeight: 500 }}>
            {series.name}
          </span>
          <span style={{
            fontSize: 10, padding: '1px 7px',
            borderRadius: 10,
            background: `color-mix(in srgb, ${STATUS_COLORS[status]} 15%, transparent)`,
            color: STATUS_COLORS[status],
          }}>
            {STATUS_LABELS[status]}
          </span>
        </div>
        {series.author && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            {series.author}
          </div>
        )}

        {/* Position pips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {series.entries.map(e => (
            <PositionPip key={e.position} entry={e} />
          ))}
          {!series.catalog_fetched && (
            <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center', marginLeft: 4 }}>
              fetch for full list
            </span>
          )}
        </div>
      </div>

      {/* Right: counts */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="mono" style={{ fontSize: 13, color: 'var(--ink)' }}>
          {readCount}/{ownedCount}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>read / owned</div>
        {missingCount > 0 && (
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
            {missingCount} not owned
          </div>
        )}
      </div>
    </div>
  )
}

export function ViewSeries() {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [enriching, setEnriching] = useState(false)

  const { data: allSeries = [], isLoading, refetch } = useQuery({
    queryKey: ['series'],
    queryFn: () => api.series(),
  })

  const { data: enrichStatus } = useQuery({
    queryKey: ['series-enrich-status'],
    queryFn: () => api.seriesEnrichStatus(),
    refetchInterval: enriching ? 2000 : false,
  })

  const totalSeries = allSeries.length
  const completedCount = useMemo(() => allSeries.filter(s => seriesStatus(s) === 'complete').length, [allSeries])
  const inProgressCount = useMemo(() => allSeries.filter(s => seriesStatus(s) === 'in-progress').length, [allSeries])

  const filtered = useMemo(() => {
    if (filter === 'all') return allSeries
    return allSeries.filter(s => seriesStatus(s) === filter)
  }, [allSeries, filter])

  async function startEnrich() {
    setEnriching(true)
    await api.enrichSeries()
  }

  // Drive enriching flag from polled status so it resets when task finishes
  useEffect(() => {
    if (!enrichStatus) return
    if (enrichStatus.running) {
      setEnriching(true)
    } else if (enriching) {
      setEnriching(false)
      refetch()
    }
  }, [enrichStatus])

  const FILTERS: { id: StatusFilter; label: string }[] = [
    { id: 'all',         label: 'All' },
    { id: 'in-progress', label: 'In Progress' },
    { id: 'complete',    label: 'Complete' },
    { id: 'unstarted',   label: 'Unstarted' },
  ]

  return (
    <div>
      <SectionTitle no="11" sub="Track your progress through multi-book series.">
        Series
      </SectionTitle>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
        <StatCard label="Series in library" value={totalSeries} />
        <StatCard label="Complete" value={completedCount} />
        <StatCard label="In progress" value={inProgressCount} />
      </div>

      {/* Enrich button */}
      <Card style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 4 }}>
              Fetch complete series data from Open Library
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Shows all books in each series — including entries you don't own yet.
              {enriching && enrichStatus && (
                <span> Fetching… {enrichStatus.processed}/{enrichStatus.total}
                  {enrichStatus.current && ` — ${enrichStatus.current}`}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={startEnrich}
            disabled={enriching}
            style={{
              padding: '8px 18px', fontSize: 13, borderRadius: 4,
              background: enriching ? 'var(--surface)' : 'var(--ink)',
              color:      enriching ? 'var(--muted)'   : 'var(--paper)',
              border: '1px solid var(--line)',
              cursor: enriching ? 'default' : 'pointer',
              fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >
            {enriching ? 'Fetching…' : 'Fetch series data'}
          </button>
        </div>
      </Card>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '5px 14px', fontSize: 12, borderRadius: 12, cursor: 'pointer',
            fontFamily: 'inherit',
            background: filter === f.id ? 'var(--ink)' : 'transparent',
            color:      filter === f.id ? 'var(--paper)' : 'var(--ink-soft)',
            border: '1px solid ' + (filter === f.id ? 'var(--ink)' : 'var(--line)'),
            transition: 'all 120ms ease',
          }}>{f.label}</button>
        ))}
        <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
          {filtered.length} series
        </span>
      </div>

      {/* Series list */}
      {isLoading ? (
        <div className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>No series found.</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {filtered.map(s => <SeriesCard key={s.key} series={s} />)}
        </div>
      )}

      {/* Pip legend */}
      <div style={{ marginTop: 28, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[
          { color: 'var(--accent)',    label: 'Read' },
          { color: 'var(--accent-3)',  label: 'Currently reading' },
          { color: 'var(--muted-2)',   label: 'To read' },
          { color: 'transparent',      label: 'Not owned', border: 'var(--line)' },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%',
              background: item.color,
              border: `2px solid ${item.border ?? item.color}`,
            }} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
