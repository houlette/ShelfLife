import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
    <div style={{
      width: 22, height: 22,
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

// ── Edit-mode entry row ───────────────────────────────────────────────────────

interface DraftEntry {
  position: number
  title: string
  has_catalog_row: boolean
  owned: boolean
  shelf: string | null
}

function EditEntryRow({
  entry,
  seriesKey,
  onSaved,
  onDeleted,
}: {
  entry: DraftEntry
  seriesKey: string
  onSaved: () => void
  onDeleted: () => void
}) {
  const [pos, setPos] = useState(String(entry.position))
  const [title, setTitle] = useState(entry.title)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = pos !== String(entry.position) || title !== entry.title

  async function save() {
    if (!dirty) return
    setSaving(true)
    setError(null)
    try {
      const body: { position?: number; title?: string } = {}
      const newPos = parseInt(pos)
      if (!isNaN(newPos) && newPos !== entry.position) body.position = newPos
      if (title !== entry.title) body.title = title
      await api.seriesCatalog.updateEntry(seriesKey, entry.position, body)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!entry.has_catalog_row) return
    setSaving(true)
    setError(null)
    try {
      await api.seriesCatalog.deleteEntry(seriesKey, entry.position)
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Position input */}
        <input
          type="number"
          value={pos}
          onChange={e => setPos(e.target.value)}
          onBlur={save}
          disabled={saving || !entry.has_catalog_row}
          style={{
            width: 42, padding: '3px 5px', fontSize: 12,
            fontFamily: 'var(--font-mono)',
            border: '1px solid var(--line)',
            borderRadius: 3,
            background: entry.has_catalog_row ? 'var(--paper)' : 'var(--surface)',
            color: 'var(--ink)',
            textAlign: 'center',
          }}
        />
        {/* Title input */}
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={save}
          onKeyDown={e => e.key === 'Enter' && save()}
          disabled={saving || !entry.has_catalog_row}
          placeholder={entry.owned ? '(title from your library)' : 'Title'}
          style={{
            flex: 1, padding: '3px 7px', fontSize: 13,
            border: '1px solid var(--line)',
            borderRadius: 3,
            background: entry.has_catalog_row ? 'var(--paper)' : 'var(--surface)',
            color: 'var(--ink)',
            fontFamily: 'inherit',
          }}
        />
        {/* Pip showing read status */}
        <PositionPip entry={{ ...entry, position: parseInt(pos) || entry.position } as SeriesEntry} />
        {/* Delete button */}
        {entry.has_catalog_row ? (
          <button
            onClick={remove}
            disabled={saving}
            title="Remove from catalog"
            style={{
              width: 22, height: 22, padding: 0, border: 'none',
              borderRadius: 3, cursor: saving ? 'default' : 'pointer',
              background: 'transparent', color: 'var(--muted)',
              fontSize: 16, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        ) : (
          <div style={{ width: 22 }} title="Owned book — edit series info on the book itself">
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>📚</span>
          </div>
        )}
      </div>
      {error && <div style={{ fontSize: 11, color: 'var(--accent-2, red)', marginTop: 3, paddingLeft: 52 }}>{error}</div>}
    </div>
  )
}

// ── Add-entry form ────────────────────────────────────────────────────────────

function AddEntryRow({ seriesKey, onAdded }: { seriesKey: string; onAdded: () => void }) {
  const [pos, setPos] = useState('')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    const posNum = parseInt(pos)
    if (isNaN(posNum) || !title.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.seriesCatalog.addEntry(seriesKey, { position: posNum, title: title.trim() })
      setPos('')
      setTitle('')
      onAdded()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={pos}
          onChange={e => setPos(e.target.value)}
          placeholder="#"
          style={{
            width: 42, padding: '3px 5px', fontSize: 12,
            fontFamily: 'var(--font-mono)',
            border: '1px solid var(--line)',
            borderRadius: 3, textAlign: 'center',
            background: 'var(--paper)', color: 'var(--ink)',
          }}
        />
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add entry…"
          style={{
            flex: 1, padding: '3px 7px', fontSize: 13,
            border: '1px solid var(--line)',
            borderRadius: 3,
            background: 'var(--paper)', color: 'var(--ink)',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={add}
          disabled={saving || !pos || !title.trim()}
          style={{
            padding: '3px 10px', fontSize: 12, borderRadius: 3,
            border: '1px solid var(--line)',
            background: saving ? 'var(--surface)' : 'var(--ink)',
            color: saving ? 'var(--muted)' : 'var(--paper)',
            cursor: (saving || !pos || !title.trim()) ? 'default' : 'pointer',
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}
        >Add</button>
      </div>
      {error && <div style={{ fontSize: 11, color: 'var(--accent-2, red)', marginTop: 3, paddingLeft: 52 }}>{error}</div>}
    </div>
  )
}

// ── Series card ───────────────────────────────────────────────────────────────

function SeriesCard({
  series,
  editing,
  onEditToggle,
  onRefresh,
}: {
  series: SeriesStat
  editing: boolean
  onEditToggle: () => void
  onRefresh: () => void
}) {
  const status = seriesStatus(series)
  const ownedCount = series.entries.filter(e => e.owned).length
  const readCount = series.entries.filter(e => e.shelf === 'read').length
  const missingCount = series.entries.filter(e => !e.owned).length
  const [unlocking, setUnlocking] = useState(false)

  async function unlock() {
    setUnlocking(true)
    await api.seriesCatalog.unlock(series.key)
    setUnlocking(false)
    onRefresh()
    if (editing) onEditToggle()
  }

  return (
    <div style={{
      padding: '16px 20px',
      background: 'var(--surface)',
      border: '1px solid var(--line-soft)',
      borderRadius: 4,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: series.author ? 2 : 12 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
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
          {series.curated && (
            <span title="Manually curated — won't be overwritten by re-fetch" style={{ fontSize: 11, color: 'var(--muted)' }}>
              ✎ curated
            </span>
          )}
        </div>

        {/* Counts + edit toggle */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="mono" style={{ fontSize: 13, color: 'var(--ink)' }}>
              {readCount}/{ownedCount}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>read / owned</div>
            {missingCount > 0 && (
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                {missingCount} not owned
              </div>
            )}
          </div>
          <button
            onClick={onEditToggle}
            title={editing ? 'Done editing' : 'Edit series'}
            style={{
              padding: '3px 8px', fontSize: 12, borderRadius: 3,
              border: '1px solid var(--line)',
              background: editing ? 'var(--ink)' : 'transparent',
              color: editing ? 'var(--paper)' : 'var(--muted)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {series.author && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          {series.author}
        </div>
      )}

      {/* Entry list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: editing ? 8 : 5 }}>
        {editing ? (
          series.entries.map(e => (
            <EditEntryRow
              key={e.position}
              entry={{ position: e.position, title: e.title ?? '', has_catalog_row: e.has_catalog_row, owned: e.owned, shelf: e.shelf }}
              seriesKey={series.key}
              onSaved={onRefresh}
              onDeleted={onRefresh}
            />
          ))
        ) : (
          series.entries.map(e => (
            <div key={e.position} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <PositionPip entry={e} />
              <span style={{
                fontSize: 13,
                color: e.owned ? 'var(--ink)' : 'var(--muted)',
                fontStyle: e.owned ? 'normal' : 'italic',
                lineHeight: 1.3,
              }}>
                {e.title ?? `Book ${e.position}`}
              </span>
            </div>
          ))
        )}

        {editing && <AddEntryRow seriesKey={series.key} onAdded={onRefresh} />}

        {!series.catalog_fetched && !editing && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, paddingLeft: 32 }}>
            Fetch series data for the full list
          </div>
        )}
      </div>

      {/* Edit-mode footer actions */}
      {editing && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line-soft)', display: 'flex', gap: 12, alignItems: 'center' }}>
          {series.curated ? (
            <button
              onClick={unlock}
              disabled={unlocking}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 3,
                border: '1px solid var(--line)',
                background: 'transparent', color: 'var(--muted)',
                cursor: unlocking ? 'default' : 'pointer', fontFamily: 'inherit',
              }}
            >
              {unlocking ? 'Unlocking…' : 'Unlock & re-fetch from OL'}
            </button>
          ) : null}
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            Changes save automatically. Edits lock this series against re-fetch.
          </span>
        </div>
      )}
    </div>
  )
}

// ── View ──────────────────────────────────────────────────────────────────────

export function ViewSeries() {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [enriching, setEnriching] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: allSeries = [], isLoading } = useQuery({
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

  function refresh() {
    qc.invalidateQueries({ queryKey: ['series'] })
  }

  useEffect(() => {
    if (!enrichStatus) return
    if (enrichStatus.running) {
      setEnriching(true)
    } else if (enriching) {
      setEnriching(false)
      refresh()
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 32 }}>
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
          {filtered.map(s => (
            <SeriesCard
              key={s.key}
              series={s}
              editing={editingKey === s.key}
              onEditToggle={() => setEditingKey(prev => prev === s.key ? null : s.key)}
              onRefresh={refresh}
            />
          ))}
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
