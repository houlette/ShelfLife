import type { Book, Summary, AuthorStat, ShelfData, RatingBucket, IngestStatus, Insight, GenreStat, EnrichStatus, Recommendation, DiscoveryCandidate, BooklistPendingEntry, SeriesStat } from './types'
import type { AuthUser } from './auth'
import { getStoredToken } from './auth'

const BASE = '/api'

function authHeaders(): HeadersInit {
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => v && url.searchParams.set(k, v))
  const res = await fetch(url.toString(), { headers: authHeaders() })
  if (res.status === 401) {
    localStorage.removeItem('shelflife_token')
    localStorage.removeItem('shelflife_user')
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function post(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    localStorage.removeItem('shelflife_token')
    localStorage.removeItem('shelflife_user')
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  return res.json()
}

export const api = {
  health: () => get<{ status: string }>('/health'),

  books: () => get<Book[]>('/metrics/books'),
  summary: () => get<Summary>('/metrics/summary'),
  authors: () => get<AuthorStat[]>('/metrics/authors'),
  shelves: () => get<ShelfData>('/metrics/shelves'),
  ratingDistribution: () => get<RatingBucket[]>('/metrics/rating-distribution'),

  ingestStatus: () => get<IngestStatus>('/ingest/status'),
  uploadGoodreads: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/ingest/goodreads`, { method: 'POST', headers: authHeaders(), body: fd }).then(r => r.json())
  },
  uploadBooklist: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/ingest/booklist`, { method: 'POST', headers: authHeaders(), body: fd }).then(r => r.json())
  },
  booklistPending: () => get<BooklistPendingEntry[]>('/ingest/booklist/pending'),
  resolvePending: (id: number, action: string, bookId?: number) => {
    const params = new URLSearchParams({ action })
    if (bookId != null) params.set('book_id', String(bookId))
    return fetch(`${BASE}/ingest/booklist/pending/${id}/resolve?${params}`, { method: 'POST', headers: authHeaders() }).then(r => r.json())
  },

  insights: (period = 'recent') => get<Insight>(`/insights/summary?period=${period}`),

  genres: () => get<GenreStat[]>('/metrics/genres'),
  recommendations: (limit = 50) => get<Recommendation[]>('/metrics/recommendations', { limit: String(limit) }),
  enrichStatus: () => get<EnrichStatus>('/ingest/enrich/status'),
  enrichLibrary: () =>
    fetch(`${BASE}/ingest/enrich`, { method: 'POST', headers: authHeaders() }).then(r => r.json()),
  enrichCovers: () =>
    fetch(`${BASE}/ingest/enrich-covers`, { method: 'POST', headers: authHeaders() }).then(r => r.json()),

  diversityStatus: () => get<{
    total_read: number; total_authors: number;
    searched: number; searched_authors: number;
    with_gender: number; with_ethnicity: number;
    task: { running: boolean; authors_processed: number; authors_enriched: number; books_updated: number; errors: number }
  }>('/ingest/diversity-enrich/status'),
  diversityEnrich: (limit?: number) => {
    const qs = limit != null ? `?limit=${limit}` : ''
    return fetch(`${BASE}/ingest/diversity-enrich${qs}`, { method: 'POST', headers: authHeaders() }).then(r => r.json())
  },
  diversityStop: () => fetch(`${BASE}/ingest/diversity-enrich/stop`, { method: 'POST', headers: authHeaders() }).then(r => r.json()),
  diversityReset: (scope: string) =>
    fetch(`${BASE}/ingest/diversity-enrich/reset?scope=${scope}`, { method: 'POST', headers: authHeaders() })
      .then(r => { if (!r.ok) throw new Error(`Reset failed: ${r.status} ${r.statusText}`); return r.json() }),
  updateAuthorDiversity: (author: string, gender: string | null, ethnicity: string | null) =>
    fetch(`${BASE}/ingest/author-diversity`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ author, gender, ethnicity }),
    }).then(r => { if (!r.ok) throw new Error(`Update failed: ${r.status}`); return r.json() }),

  series: () => get<SeriesStat[]>('/metrics/series'),
  enrichSeries: () => fetch(`${BASE}/ingest/enrich-series`, { method: 'POST', headers: authHeaders() }).then(r => r.json()),
  seriesEnrichStatus: () => get<{ running: boolean; processed: number; total: number; current: string | null }>('/ingest/series-enrich/status'),

  seriesCatalog: {
    deleteEntry: (key: string, position: number) =>
      fetch(`${BASE}/series/${encodeURIComponent(key)}/entries/${position}`, { method: 'DELETE', headers: authHeaders() }),
    updateEntry: (key: string, position: number, body: { position?: number; title?: string }) =>
      fetch(`${BASE}/series/${encodeURIComponent(key)}/entries/${position}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      }).then(r => { if (!r.ok) throw new Error(`Update failed: ${r.status}`); return r.json() }),
    addEntry: (key: string, body: { position: number; title: string }) =>
      fetch(`${BASE}/series/${encodeURIComponent(key)}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      }).then(r => { if (!r.ok) throw new Error(`Add failed: ${r.status}`); return r.json() }),
    unlock: (key: string) =>
      fetch(`${BASE}/series/${encodeURIComponent(key)}/unlock`, { method: 'POST', headers: authHeaders() }),
  },

  cfStatus: () => get<{ ratings_loaded: number; books_covered: number; similarity_pairs: number }>('/ingest/cf-status'),
  cfRebuild: () => fetch(`${BASE}/ingest/cf-rebuild`, { method: 'POST', headers: authHeaders() }).then(async r => {
    const body = await r.json()
    if (!r.ok) throw new Error((body as { detail?: string }).detail || `${r.status} ${r.statusText}`)
    return body as { ingest: { resolved_rows: number }; similarity: { pairs_stored: number; books_covered: number } }
  }),

  discover: {
    list: (source?: string) =>
      get<DiscoveryCandidate[]>('/discover', source ? { source } : undefined),
    refresh: () =>
      fetch(`${BASE}/discover/refresh`, { method: 'POST', headers: authHeaders() }).then(r => r.json()),
    refreshStatus: () =>
      fetch(`${BASE}/discover/refresh/status`, { headers: authHeaders() }).then(r => r.json()),
    dismiss: (id: number) =>
      fetch(`${BASE}/discover/${id}/dismiss`, { method: 'POST', headers: authHeaders() }).then(r => r.json()),
    addToShelf: (id: number) =>
      fetch(`${BASE}/discover/${id}/add-to-shelf`, { method: 'POST', headers: authHeaders() }).then(r => r.json()),
  },

  auth: {
    login: (email: string, password: string): Promise<{ access_token: string; token_type: string }> => {
      const form = new URLSearchParams({ username: email, password })
      return fetch(`${BASE}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }).then(async r => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}))
          throw new Error((err as { detail?: string }).detail || 'Login failed')
        }
        return r.json()
      })
    },
    register: (email: string, password: string, invite_code: string): Promise<{ access_token: string; token_type: string }> =>
      post('/auth/register', { email, password, invite_code }) as Promise<{ access_token: string; token_type: string }>,
    me: () => get<AuthUser>('/auth/me'),
    createInvite: () => post('/auth/invites') as Promise<{ code: string }>,
    listInvites: () => get<Array<{ id: number; code: string; used: boolean; used_by: number | null; used_at: string | null; expires_at: string | null }>>('/auth/invites'),
  },
}
