import { useState, useEffect } from 'react'
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from './api'
import type { Book } from './types'
import { nfmt } from './utils'
import type { Range, Granularity } from './utils'
import { ViewOverview }  from './views/ViewOverview'
import { ViewTimeline }  from './views/ViewTimeline'
import { ViewShelves }   from './views/ViewShelves'
import { ViewAuthors }   from './views/ViewAuthors'
import { ViewGenres }    from './views/ViewGenres'
import { ViewRatings }   from './views/ViewRatings'
import { ViewRecommend } from './views/ViewRecommend'
import { ViewDiscover }  from './views/ViewDiscover'
import { ViewBooks }     from './views/ViewBooks'
import { ViewImport }    from './views/ViewImport'
import { ViewInsights }  from './views/ViewInsights'
import { ViewSettings }  from './views/ViewSettings'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 1 } },
})

type ViewId = 'overview' | 'timeline' | 'shelves' | 'authors' | 'genres' | 'ratings' | 'books' | 'recommend' | 'discover' | 'insights' | 'import' | 'settings'
type Theme  = 'paper' | 'midnight' | 'clinic'

const NAV: { id: ViewId; label: string; no: string }[] = [
  { id: 'overview', label: 'Overview',  no: '01' },
  { id: 'timeline', label: 'Timeline',  no: '02' },
  { id: 'shelves',  label: 'Shelves',   no: '03' },
  { id: 'authors',  label: 'Authors',   no: '04' },
  { id: 'genres',   label: 'Genres',    no: '05' },
  { id: 'ratings',  label: 'Ratings',   no: '06' },
  { id: 'books',    label: 'Books',     no: '07' },
  { id: 'recommend', label: 'Recommend', no: '08' },
  { id: 'discover',  label: 'Discover',  no: '09' },
  { id: 'insights',  label: 'Insights',  no: '10' },
]

const RANGE_OPTIONS: { id: Range; label: string }[] = [
  { id: '1y',  label: '1 year'   },
  { id: '3y',  label: '3 years'  },
  { id: '5y',  label: '5 years'  },
  { id: 'all', label: 'All time' },
]

const GRAN_OPTIONS: { id: Granularity; label: string }[] = [
  { id: 'month', label: 'Monthly' },
  { id: 'year',  label: 'Yearly'  },
]

function SideNav({ view, setView, books, theme, setTheme }: {
  view: ViewId
  setView: (v: ViewId) => void
  books: Book[]
  theme: Theme
  setTheme: (t: Theme) => void
}) {
  const readCount = books.filter(b => b.exclusive_shelf === 'read').length

  return (
    <aside style={{
      borderRight: '1px solid var(--line)', background: 'var(--paper)',
      padding: '32px 24px 32px', position: 'sticky', top: 0,
      height: '100vh', display: 'flex', flexDirection: 'column', flexShrink: 0,
      width: 220, overflow: 'hidden',
    }}>
      <div style={{ paddingBottom: 28, borderBottom: '1px solid var(--line)', position: 'relative' }}>
        {/* Mini book-spine motif */}
        <div style={{ display: 'flex', gap: 2, height: 20, marginBottom: 10, alignItems: 'flex-end' }}>
          {[
            { h: 18, c: 'var(--accent)',    w: 4 },
            { h: 14, c: 'var(--accent-3)',  w: 3 },
            { h: 20, c: 'var(--accent-2)',  w: 5 },
            { h: 12, c: 'var(--hi)',        w: 3 },
            { h: 16, c: 'var(--accent)',    w: 4 },
            { h: 19, c: 'var(--accent-2)',  w: 3 },
            { h: 13, c: 'var(--accent-3)',  w: 4 },
          ].map((s, i) => (
            <div key={i} style={{ width: s.w, height: s.h, background: s.c, opacity: 0.85 }} />
          ))}
        </div>
        <div className="serif" style={{ fontSize: 26, lineHeight: 1, color: 'var(--ink)', letterSpacing: '-0.02em', fontWeight: 600 }}>
          ShelfLife
        </div>
        <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 8, fontStyle: 'italic', letterSpacing: '0.01em' }}>
          a reader's almanac
        </div>
      </div>

      <nav style={{ flex: 1, paddingTop: 24 }}>
        {NAV.map(item => (
          <button key={item.id} onClick={() => setView(item.id)} style={{
            display: 'grid', gridTemplateColumns: '22px 1fr',
            width: '100%', textAlign: 'left',
            padding: '10px 4px', border: 'none',
            background: 'transparent', cursor: 'pointer',
            fontFamily: 'inherit',
            borderBottom: '1px solid var(--line-soft)',
            color: view === item.id ? 'var(--ink)' : 'var(--muted)',
            fontWeight: view === item.id ? 500 : 400,
          }}>
            <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--muted)', paddingTop: 3 }}>
              {item.no}
            </span>
            <span style={{ fontSize: 13.5 }}>{item.label}</span>
          </button>
        ))}
        <button onClick={() => setView('import')} style={{
          display: 'grid', gridTemplateColumns: '22px 1fr',
          width: '100%', textAlign: 'left',
          padding: '10px 4px', border: 'none',
          background: 'transparent', cursor: 'pointer',
          fontFamily: 'inherit', marginTop: 8,
          color: view === 'import' ? 'var(--ink)' : 'var(--muted)',
        }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--muted)', paddingTop: 3 }}>⊕</span>
          <span style={{ fontSize: 13.5 }}>Import data</span>
        </button>
        <button onClick={() => setView('settings')} style={{
          display: 'grid', gridTemplateColumns: '22px 1fr',
          width: '100%', textAlign: 'left',
          padding: '10px 4px', border: 'none',
          background: 'transparent', cursor: 'pointer',
          fontFamily: 'inherit', marginTop: 2,
          color: view === 'settings' ? 'var(--ink)' : 'var(--muted)',
        }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--muted)', paddingTop: 3 }}>⚙</span>
          <span style={{ fontSize: 13.5 }}>Settings</span>
        </button>
      </nav>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 20 }}>
        <div style={{ marginBottom: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Library</div>
          <div className="num" style={{ fontSize: 13, color: 'var(--ink)' }}>
            {nfmt(readCount)} books read
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['paper', 'midnight', 'clinic'] as Theme[]).map(t => (
            <button key={t} onClick={() => setTheme(t)} style={{
              padding: '4px 8px', fontSize: 10, borderRadius: 2, cursor: 'pointer', fontFamily: 'inherit',
              background: theme === t ? 'var(--ink)' : 'transparent',
              color:      theme === t ? 'var(--paper)' : 'var(--muted)',
              border: '1px solid ' + (theme === t ? 'var(--ink)' : 'var(--line)'),
            }}>{t}</button>
          ))}
        </div>
      </div>
    </aside>
  )
}

function Header({ range, setRange, granularity, setGranularity }: {
  range: Range
  setRange: (r: Range) => void
  granularity: Granularity
  setGranularity: (g: Granularity) => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 48, paddingBottom: 20, borderBottom: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGE_OPTIONS.map(o => (
            <button key={o.id} onClick={() => setRange(o.id)} style={{
              padding: '5px 10px', fontSize: 12, borderRadius: 2,
              fontFamily: 'inherit', cursor: 'pointer',
              background: range === o.id ? 'var(--ink)' : 'transparent',
              color:      range === o.id ? 'var(--paper)' : 'var(--ink-soft)',
              border: '1px solid ' + (range === o.id ? 'var(--ink)' : 'var(--line)'),
              transition: 'all 120ms ease',
            }}>{o.label}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 18, background: 'var(--line)' }} />

        <div style={{ display: 'flex', gap: 4 }}>
          {GRAN_OPTIONS.map(o => (
            <button key={o.id} onClick={() => setGranularity(o.id)} style={{
              padding: '5px 10px', fontSize: 12, borderRadius: 2,
              fontFamily: 'inherit', cursor: 'pointer',
              background: granularity === o.id ? 'var(--ink)' : 'transparent',
              color:      granularity === o.id ? 'var(--paper)' : 'var(--ink-soft)',
              border: '1px solid ' + (granularity === o.id ? 'var(--ink)' : 'var(--line)'),
              transition: 'all 120ms ease',
            }}>{o.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function AppShell() {
  const [view,        setView]        = useState<ViewId>('overview')
  const [range,       setRange]       = useState<Range>('all')
  const [granularity, setGranularity] = useState<Granularity>('year')
  const [theme,       setTheme]       = useState<Theme>('paper')

  useEffect(() => { window.scrollTo(0, 0) }, [view])
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])

  const { data: books = [], isLoading, error } = useQuery({
    queryKey: ['books'],
    queryFn: () => api.books(),
  })

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--muted)' }}>
        <div className="mono" style={{ fontSize: 13 }}>Loading library…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ color: 'var(--m2)', fontSize: 14 }}>Failed to load data. Is the backend running?</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh' }}>
      <SideNav view={view} setView={setView} books={books} theme={theme} setTheme={setTheme} />

      <main style={{ padding: '36px 56px 120px', maxWidth: 1480, overflow: 'hidden' }}>
        <Header range={range} setRange={setRange} granularity={granularity} setGranularity={setGranularity} />

        {view === 'overview'  && <ViewOverview  books={books} range={range} granularity={granularity} />}
        {view === 'timeline'  && <ViewTimeline  books={books} range={range} granularity={granularity} />}
        {view === 'shelves'   && <ViewShelves   books={books} />}
        {view === 'authors'   && <ViewAuthors   books={books} range={range} />}
        {view === 'genres'    && <ViewGenres    books={books} range={range} />}
        {view === 'ratings'   && <ViewRatings   books={books} range={range} granularity={granularity} />}
        {view === 'books'     && <ViewBooks     books={books} />}
        {view === 'recommend' && <ViewRecommend />}
        {view === 'discover'  && <ViewDiscover />}
        {view === 'insights'  && <ViewInsights />}
        {view === 'import'    && <ViewImport />}
        {view === 'settings'  && <ViewSettings  theme={theme} setTheme={setTheme} />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  )
}
