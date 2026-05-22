export interface Book {
  id: number
  goodreads_book_id: number
  title: string
  author: string | null
  author_lf: string | null
  additional_authors: string | null
  isbn: string | null
  isbn13: string | null
  my_rating: number
  average_rating: number | null
  publisher: string | null
  binding: string | null
  num_pages: number | null
  year_published: number | null
  original_pub_year: number | null
  date_read: string | null
  date_added: string | null
  exclusive_shelf: string
  bookshelves: string[]
  my_review: string | null
  read_count: number
  cover_url: string | null
  genre: string | null
  year_acquired: number | null
  ol_avg_rating: number | null
  ol_ratings_count: number | null
  author_gender: string | null
  author_ethnicity: string | null
  author_diversity_manual?: boolean
}

export interface GenreStat {
  genre: string
  count: number
  pages: number
  avg_rating: number | null
}

export interface EnrichStatus {
  total: number
  with_isbn: number
  enriched: number
  with_cover: number
  with_genre: number
  missing_covers: number
}

export interface ReadingPeriod {
  period: string
  year: number
  month?: number
  books: number
  pages: number
  avgRating: number | null
  titles: string[]
}

export interface AuthorStat {
  author: string
  books_count: number
  avg_rating: number | null
  total_pages: number
}

export interface ShelfData {
  exclusive: Array<{ shelf: string; count: number }>
  custom: Array<{ shelf: string; count: number }>
}

export interface RatingBucket {
  rating: number
  count: number
  avg_goodreads_rating: number | null
}

export interface Summary {
  total_books: number
  total_pages: number
  unique_authors: number
  avg_rating: number | null
  books_by_year: Record<string, number>
  current_streak: number
  best_streak: number
}

export interface IngestStatus {
  books: { count: number; from: string | null; to: string | null }
  logs: Array<{ source: string; filename: string; status: string; records: number; at: string }>
}

export interface Insight {
  summary: string
}

export interface DiscoveryCandidate {
  id: number
  ol_work_key: string
  title: string
  author: string | null
  source: 'author' | 'subject' | 'similarity'
  source_evidence: Record<string, unknown>
  cover_url: string | null
  genre: string | null
  ol_avg_rating: number | null
  ol_ratings_count: number | null
  original_pub_year: number | null
  score: number | null
  breakdown: {
    genre_baseline?: number
    author_offset?: number
    ol_z_bonus?: number
    subject_offset?: number
    cf_offset?: number
    text_offset?: number
    popularity_penalty?: number
    series_penalty?: number
  }
  reason: string
  status: 'new' | 'dismissed' | 'added'
}

export interface BooklistPendingEntry {
  id: number
  booklist_index: number
  title: string
  author: string | null
  category: string | null
  read_flag: string | null
  candidates: Array<{
    id: number
    title: string
    author: string | null
    cover_url: string | null
    exclusive_shelf: string | null
    original_pub_year: number | null
    my_rating: number
  }>
}

export interface Recommendation {
  book: Book
  score: number
  breakdown: {
    genre_baseline: number
    author_offset: number
    ol_z_bonus: number
    subject_offset?: number
    cf_offset?: number
    text_offset?: number
    popularity_penalty: number
    series_penalty: number
  }
  raw: {
    genre_user_avg: number
    author_user_avg: number | null
    ol_z: number
    ol_calibrated: number
    subject_pred?: number | null
    subject_overlap?: number
    cf_pred?: number | null
    cf_neighbors?: number
    text_pred?: number | null
    text_neighbors?: number
    text_sim?: number
    ratings_count: number
    is_sequel: boolean
  }
  reason: string
}
