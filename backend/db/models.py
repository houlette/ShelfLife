from datetime import datetime

from sqlalchemy import Boolean, Column, ForeignKey, Integer, Float, String, Date, DateTime, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Book(Base):
    __tablename__ = "books"

    id = Column(Integer, primary_key=True)
    goodreads_book_id = Column(Integer, unique=True, nullable=False)
    title = Column(Text, nullable=False)
    author = Column(String(255))
    author_lf = Column(String(255))
    additional_authors = Column(Text)
    isbn = Column(String(20))
    isbn13 = Column(String(20))
    my_rating = Column(Integer, default=0)
    average_rating = Column(Float)
    publisher = Column(String(255))
    binding = Column(String(50))
    num_pages = Column(Integer)
    year_published = Column(Integer)
    original_pub_year = Column(Integer)
    date_read = Column(Date)
    date_added = Column(Date)
    exclusive_shelf = Column(String(50))
    bookshelves = Column(Text)
    my_review = Column(Text)
    private_notes = Column(Text)
    read_count = Column(Integer, default=1)
    owned_copies = Column(Integer, default=0)

    booklist_id = Column(Integer)          # Index from personal book-ownership sheet
    year_acquired = Column(Integer)        # "Year Acquired" from booklist sheet

    # Enriched from Open Library
    cover_url = Column(Text)
    genre = Column(String(50))            # normalized bucket
    subjects_json = Column(Text)          # raw OL subjects (JSON array)
    ol_avg_rating = Column(Float)
    ol_ratings_count = Column(Integer)
    ol_work_key = Column(String(50))
    enriched_at = Column(DateTime)

    # Enriched from Wikidata (author demographics)
    author_gender = Column(String(20))    # "Man" | "Woman" | "Non-binary" | "Other"
    author_ethnicity = Column(String(100))  # raw Wikidata label (e.g. "African Americans")
    diversity_enriched_at = Column(DateTime)  # when Wikidata was last queried for this author
    author_diversity_manual = Column(Boolean, default=False)  # True = user-edited, skip re-enrichment

    # Parsed from Goodreads title suffix, e.g. "Name of the Wind (Kingkiller Chronicle, #1)"
    series_name     = Column(String(255))
    series_position = Column(Integer)


class User(Base):
    __tablename__ = "users"
    id           = Column(Integer, primary_key=True)
    email        = Column(String(255), unique=True, nullable=False, index=True)
    hashed_pw    = Column(String(255), nullable=False)
    display_name = Column(String(100))
    is_admin     = Column(Boolean, default=False)
    created_at   = Column(DateTime, default=datetime.utcnow)


class InviteCode(Base):
    __tablename__ = "invite_codes"
    id         = Column(Integer, primary_key=True)
    code       = Column(String(64), unique=True, nullable=False, index=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    used_by    = Column(Integer, ForeignKey("users.id"), nullable=True)
    used_at    = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)


class UserBook(Base):
    """Per-user reading relationship: shelf, rating, dates, review."""
    __tablename__ = "user_books"
    id              = Column(Integer, primary_key=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    book_id         = Column(Integer, ForeignKey("books.id"), nullable=False)
    exclusive_shelf = Column(String(50))
    my_rating       = Column(Integer)
    date_read       = Column(Date)
    date_added      = Column(Date)
    my_review       = Column(Text)
    bookshelves     = Column(Text)
    read_count      = Column(Integer)
    year_acquired   = Column(Integer)
    __table_args__  = (UniqueConstraint("user_id", "book_id"),)


class ExternalRating(Base):
    """Ratings sourced from public datasets (Goodbooks-10k, etc.) used for
    collaborative filtering. Resolved to our local Book.id at ingest time."""
    __tablename__ = "external_ratings"

    id = Column(Integer, primary_key=True)
    source = Column(String(50), nullable=False, index=True)
    ext_user_id = Column(Integer, nullable=False)
    book_id = Column(Integer, nullable=False, index=True)  # FK to Book.id
    rating = Column(Float, nullable=False)  # normalized to 1-5 scale


class BookSimilarity(Base):
    """Precomputed item-item similarity, used by CF predictor."""
    __tablename__ = "book_similarity"

    id = Column(Integer, primary_key=True)
    book_a_id = Column(Integer, nullable=False, index=True)
    book_b_id = Column(Integer, nullable=False)
    similarity = Column(Float, nullable=False)
    n_co_raters = Column(Integer, nullable=False)


class BookReviewAgg(Base):
    """Aggregated review text per book, used by the content-text predictor."""
    __tablename__ = "book_review_agg"

    book_id = Column(Integer, primary_key=True)  # FK to Book.id
    n_reviews = Column(Integer, nullable=False)
    avg_rating = Column(Float)
    text = Column(Text, nullable=False)


class DiscoveryCandidate(Base):
    """Books surfaced by the discovery pipeline (not yet on the user's shelf)."""
    __tablename__ = "discovery_candidates"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    ol_work_key = Column(String(50), unique=True, nullable=False)
    title = Column(Text, nullable=False)
    author = Column(String(255))

    # Which generator found it, and why
    source = Column(String(20), nullable=False)   # "author" | "subject" | "similarity"
    source_evidence = Column(Text)                # JSON: {"author": "George Saunders"}

    # Enrichment (mirrors Book's OL columns)
    cover_url = Column(Text)
    genre = Column(String(50))
    subjects_json = Column(Text)
    ol_avg_rating = Column(Float)
    ol_ratings_count = Column(Integer)
    original_pub_year = Column(Integer)

    # Scoring (cached)
    score = Column(Float)
    breakdown_json = Column(Text)
    reason = Column(Text)

    # Lifecycle
    status = Column(String(20), default="new")    # "new" | "dismissed" | "added"
    created_at = Column(DateTime)
    scored_at = Column(DateTime)


class BooklistPending(Base):
    """Sheet rows that had a title match in the DB but no confident author match.
    The user resolves each one: merge into an existing book, insert as new, or dismiss."""
    __tablename__ = "booklist_pending"

    id = Column(Integer, primary_key=True)
    booklist_index = Column(Integer, nullable=False, unique=True)

    # Verbatim sheet fields — applied on resolution
    title = Column(Text, nullable=False)
    author = Column(String(255))
    author_lf = Column(String(255))
    read_flag = Column(String(10))
    category = Column(String(50))
    subcategory = Column(String(50))
    year_acquired = Column(Integer)

    candidate_book_ids = Column(Text)  # JSON list of Book.id to compare against
    status = Column(String(20), default="pending")  # "pending" (others reserved)
    created_at = Column(DateTime)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class SeriesCatalog(Base):
    """Complete book list per series, fetched from Open Library and cached."""
    __tablename__ = "series_catalog"

    id           = Column(Integer, primary_key=True)
    series_key   = Column(String(255), nullable=False, index=True)  # lowercased name
    display_name = Column(String(255))   # original-case name
    position     = Column(Integer)
    title        = Column(Text)
    author       = Column(String(255))
    ol_work_key  = Column(String(50))
    cover_url    = Column(Text)
    fetched_at        = Column(DateTime)   # same timestamp for all rows in a series
    manually_curated  = Column(Boolean, default=False)


class IngestLog(Base):
    __tablename__ = "ingest_log"

    id = Column(Integer, primary_key=True)
    source = Column(String(50), nullable=False)
    filename = Column(String(255))
    records_inserted = Column(Integer)
    records_updated = Column(Integer)
    ingested_at = Column(DateTime, nullable=False)
    status = Column(String(20))
    message = Column(Text)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
