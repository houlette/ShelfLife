import type { Book, Summary, AuthorStat, ShelfData, RatingBucket, IngestStatus, Insight, GenreStat, EnrichStatus, Recommendation, DiscoveryCandidate, BooklistPendingEntry } from './types'

const BASE = '/api'

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => v && url.searchParams.set(k, v))
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
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
    return fetch(`${BASE}/ingest/goodreads`, { method: 'POST', body: fd }).then(r => r.json())
  },
  uploadBooklist: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/ingest/booklist`, { method: 'POST', body: fd }).then(r => r.json())
  },
  booklistPending: () => get<BooklistPendingEntry[]>('/ingest/booklist/pending'),
  resolvePending: (id: number, action: string, bookId?: number) => {
    const params = new URLSearchParams({ action })
    if (bookId != null) params.set('book_id', String(bookId))
    return fetch(`${BASE}/ingest/booklist/pending/${id}/resolve?${params}`, { method: 'POST' }).then(r => r.json())
  },

  insights: (period = 'recent') => get<Insight>(`/insights/summary?period=${period}`),

  genres: () => get<GenreStat[]>('/metrics/genres'),
  recommendations: (limit = 50) => get<Recommendation[]>('/metrics/recommendations', { limit: String(limit) }),
  enrichStatus: () => get<EnrichStatus>('/ingest/enrich/status'),
  enrichLibrary: () =>
    fetch(`${BASE}/ingest/enrich`, { method: 'POST' }).then(r => r.json()),

  diversityStatus: () => get<{
    total_read: number; total_authors: number;
    searched: number; searched_authors: number;
    with_gender: number; with_ethnicity: number;
    task: { running: boolean; authors_processed: number; authors_enriched: number; books_updated: number; errors: number }
  }>('/ingest/diversity-enrich/status'),
  diversityEnrich: (limit?: number) => {
    const qs = limit != null ? `?limit=${limit}` : ''
    return fetch(`${BASE}/ingest/diversity-enrich${qs}`, { method: 'POST' }).then(r => r.json())
  },
  diversityStop: () => fetch(`${BASE}/ingest/diversity-enrich/stop`, { method: 'POST' }).then(r => r.json()),
  diversityReset: (scope: string) =>
    fetch(`${BASE}/ingest/diversity-enrich/reset?scope=${scope}`, { method: 'POST' })
      .then(r => { if (!r.ok) throw new Error(`Reset failed: ${r.status} ${r.statusText}`); return r.json() }),

  cfStatus: () => get<{ ratings_loaded: number; books_covered: number; similarity_pairs: number }>('/ingest/cf-status'),
  cfRebuild: () => fetch(`${BASE}/ingest/cf-rebuild`, { method: 'POST' }).then(r => r.json()),

  discover: {
    list: (source?: string) =>
      get<DiscoveryCandidate[]>('/discover', source ? { source } : undefined),
    refresh: () =>
      fetch(`${BASE}/discover/refresh`, { method: 'POST' }).then(r => r.json()),
    dismiss: (id: number) =>
      fetch(`${BASE}/discover/${id}/dismiss`, { method: 'POST' }).then(r => r.json()),
    addToShelf: (id: number) =>
      fetch(`${BASE}/discover/${id}/add-to-shelf`, { method: 'POST' }).then(r => r.json()),
  },
}

