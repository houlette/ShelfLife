import { useState, useEffect } from 'react'
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from './api'
import { AuthProvider, useAuth } from './auth'
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
import { ViewSeries }    from './views/ViewSeries'
import { ViewSettings }  from './views/ViewSettings'
import { ViewLogin }     from './views/ViewLogin'
import { ViewAdmin }     from './views/ViewAdmin'
import { NavigationContext } from './context'
import { useViewport } from './hooks/useViewport'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 1 } },
})

type ViewId = 'overview' | 'timeline' | 'shelves' | 'authors' | 'genres' | 'ratings' | 'books' | 'recommend' | 'discover' | 'insights' | 'series' | 'import' | 'settings' | 'admin'
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
  { id: 'series',    label: 'Series',    no: '11' },
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

function SideNav({ view, setView, books, theme, setTheme, isMobile, onNavigate }: {
  view: ViewId
  setView: (v: ViewId) => void
  books: Book[]
  theme: Theme
  setTheme: (t: Theme) => void
  isMobile: boolean
  onNavigate?: () => void
}) {
  const { user, logout } = useAuth()
  const readCount = books.filter(b => b.exclusive_shelf === 'read').length

  // Mobile drawer is full-height inside its container; on desktop we
  // pin it to the viewport with `position: sticky`.
  return (
    <aside style={{
      borderRight: '1px solid var(--line)', background: 'var(--paper)',
      padding: isMobile ? '24px 20px' : '32px 24px 32px',
      position: isMobile ? 'static' : 'sticky', top: 0,
      height: isMobile ? '100%' : '100vh',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      width: isMobile ? '100%' : 220, overflow: 'auto',
    }}>
      <div style={{ paddingBottom: 28, borderBottom: '1px solid var(--line)', position: 'relative' }}>
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
          <button key={item.id} onClick={() => { setView(item.id); onNavigate?.() }} style={{
            display: 'grid', gridTemplateColumns: '22px 1fr',
            width: '100%', textAlign: 'left',
            padding: isMobile ? '14px 4px' : '10px 4px', border: 'none',
            background: 'transparent', cursor: 'pointer',
            fontFamily: 'inherit',
            borderBottom: '1px solid var(--line-soft)',
            color: view === item.id ? 'var(--ink)' : 'var(--muted)',
            fontWeight: view === item.id ? 500 : 400,
          }}>
            <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--muted)', paddingTop: 3 }}>
              {item.no}
            </span>
            <span style={{ fontSize: isMobile ? 15 : 13.5 }}>{item.label}</span>
          </button>
        ))}
        <button onClick={() => { setView('import'); onNavigate?.() }} style={{
          display: 'grid', gridTemplateColumns: '22px 1fr',
          width: '100%', textAlign: 'left',
          padding: isMobile ? '14px 4px' : '10px 4px', border: 'none',
          background: 'transparent', cursor: 'pointer',
          fontFamily: 'inherit', marginTop: 8,
          color: view === 'import' ? 'var(--ink)' : 'var(--muted)',
        }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--muted)', paddingTop: 3 }}>⊕</span>
          <span style={{ fontSize: isMobile ? 15 : 13.5 }}>Import data</span>
        </button>
        <button onClick={() => { setView('settings'); onNavigate?.() }} style={{
          display: 'grid', gridTemplateColumns: '22px 1fr',
          width: '100%', textAlign: 'left',
          padding: isMobile ? '14px 4px' : '10px 4px', border: 'none',
          background: 'transparent', cursor: 'pointer',
          fontFamily: 'inherit', marginTop: 2,
          color: view === 'settings' ? 'var(--ink)' : 'var(--muted)',
        }}>
          <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--muted)', paddingTop: 3 }}>⚙</span>
          <span style={{ fontSize: isMobile ? 15 : 13.5 }}>Settings</span>
        </button>
        {user?.is_admin && (
          <button onClick={() => { setView('admin'); onNavigate?.() }} style={{
            display: 'grid', gridTemplateColumns: '22px 1fr',
            width: '100%', textAlign: 'left',
            padding: isMobile ? '14px 4px' : '10px 4px', border: 'none',
            background: 'transparent', cursor: 'pointer',
            fontFamily: 'inherit', marginTop: 2,
            color: view === 'admin' ? 'var(--ink)' : 'var(--muted)',
          }}>
            <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--muted)', paddingTop: 3 }}>★</span>
            <span style={{ fontSize: isMobile ? 15 : 13.5 }}>Admin</span>
          </button>
        )}
      </nav>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 20 }}>
        <div style={{ marginBottom: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 2 }}>Library</div>
          <div className="num" style={{ fontSize: 13, color: 'var(--ink)' }}>
            {nfmt(readCount)} books read
          </div>
        </div>
        {user && (
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
              {user.display_name || user.email}
            </div>
            <button onClick={logout} style={{
              padding: '3px 7px', fontSize: 10, borderRadius: 2, cursor: 'pointer', fontFamily: 'inherit',
              background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)',
            }}>
              Sign out
            </button>
          </div>
        )}
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

function Header({ range, setRange, granularity, setGranularity, isMobile }: {
  range: Range
  setRange: (r: Range) => void
  granularity: Granularity
  setGranularity: (g: Granularity) => void
  isMobile: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: isMobile ? 28 : 48,
      paddingBottom: isMobile ? 14 : 20,
      borderBottom: '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', gap: isMobile ? 10 : 16, alignItems: 'center', flexWrap: 'wrap', rowGap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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

        {!isMobile && <div style={{ width: 1, height: 18, background: 'var(--line)' }} />}

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
  const { user } = useAuth()
  const { isMobile } = useViewport()
  const [view,        setView]        = useState<ViewId>('overview')
  const [range,       setRange]       = useState<Range>('all')
  const [granularity, setGranularity] = useState<Granularity>('year')
  const [theme,       setTheme]       = useState<Theme>('paper')
  const [bookSearch,  setBookSearch]  = useState('')
  const [drawerOpen,  setDrawerOpen]  = useState(false)

  useEffect(() => { window.scrollTo(0, 0) }, [view])
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])

  // Lock body scroll when the mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  // Auto-close drawer if viewport widens past the mobile breakpoint
  useEffect(() => { if (!isMobile) setDrawerOpen(false) }, [isMobile])

  const { data: books = [], isLoading, error } = useQuery({
    queryKey: ['books'],
    queryFn: () => api.books(),
    enabled: !!user,
  })

  // Show login if no user
  if (!user) {
    return <ViewLogin />
  }

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

  const navigateToAuthor = (name: string) => { setBookSearch(name); setView('books') }

  // Reusable view-switch JSX
  const viewContent = (
    <>
      {view === 'overview'  && <ViewOverview  books={books} range={range} granularity={granularity} />}
      {view === 'timeline'  && <ViewTimeline  books={books} range={range} granularity={granularity} />}
      {view === 'shelves'   && <ViewShelves   books={books} />}
      {view === 'authors'   && <ViewAuthors   books={books} range={range} />}
      {view === 'genres'    && <ViewGenres    books={books} range={range} />}
      {view === 'ratings'   && <ViewRatings   books={books} range={range} granularity={granularity} />}
      {view === 'books'     && <ViewBooks     books={books} initialSearch={bookSearch} onSearchClear={() => setBookSearch('')} />}
      {view === 'recommend' && <ViewRecommend />}
      {view === 'discover'  && <ViewDiscover />}
      {view === 'insights'  && <ViewInsights />}
      {view === 'series'    && <ViewSeries />}
      {view === 'import'    && <ViewImport />}
      {view === 'settings'  && <ViewSettings  theme={theme} setTheme={setTheme} />}
      {view === 'admin'     && <ViewAdmin />}
    </>
  )

  if (isMobile) {
    const currentLabel = NAV.find(n => n.id === view)?.label
      ?? (view === 'import' ? 'Import data' : view === 'settings' ? 'Settings' : view === 'admin' ? 'Admin' : '')
    return (
      <NavigationContext.Provider value={{ navigateToAuthor }}>
        {/* Top bar */}
        <header style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--paper)',
          position: 'sticky', top: 0, zIndex: 30,
        }}>
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            style={{
              width: 40, height: 40, padding: 0,
              border: '1px solid var(--line)', borderRadius: 4,
              background: 'transparent', color: 'var(--ink)',
              cursor: 'pointer', fontSize: 20, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'inherit',
            }}
          >
            ☰
          </button>
          <div className="serif" style={{ fontSize: 18, color: 'var(--ink)', fontWeight: 600, lineHeight: 1 }}>
            ShelfLife
          </div>
          <div style={{ flex: 1 }} />
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{currentLabel}</div>
        </header>

        {/* Slide-out drawer + backdrop */}
        {drawerOpen && (
          <>
            <div
              onClick={() => setDrawerOpen(false)}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
                zIndex: 40, animation: 'fadeIn 150ms ease',
              }}
            />
            <div style={{
              position: 'fixed', top: 0, left: 0, bottom: 0,
              width: 'min(85vw, 320px)',
              background: 'var(--paper)', zIndex: 50,
              boxShadow: '4px 0 24px -8px rgba(0,0,0,0.3)',
              animation: 'slideIn 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
              display: 'flex', flexDirection: 'column',
            }}>
              <SideNav
                view={view} setView={setView} books={books}
                theme={theme} setTheme={setTheme}
                isMobile={true}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
          </>
        )}

        <main style={{ padding: '20px 16px 80px' }}>
          <Header range={range} setRange={setRange} granularity={granularity} setGranularity={setGranularity} isMobile />
          {viewContent}
        </main>
      </NavigationContext.Provider>
    )
  }

  return (
    <NavigationContext.Provider value={{ navigateToAuthor }}>
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh' }}>
      <SideNav view={view} setView={setView} books={books} theme={theme} setTheme={setTheme} isMobile={false} />

      <main style={{ padding: '36px 56px 120px', maxWidth: 1480, overflow: 'hidden' }}>
        <Header range={range} setRange={setRange} granularity={granularity} setGranularity={setGranularity} isMobile={false} />
        {viewContent}
      </main>
    </div>
    </NavigationContext.Provider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </QueryClientProvider>
  )
}
