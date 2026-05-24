import os
import secrets
from pathlib import Path
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from .models import Base, Book

DB_PATH = Path(__file__).parent.parent.parent / "data" / "shelflife.db"
DB_PATH.parent.mkdir(exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _record):
    """Enable WAL journal mode on every new connection.

    WAL (Write-Ahead Logging) lets readers proceed concurrently with a writer
    instead of waiting for an exclusive lock.  Without this, long-running write
    operations (enrichment, cover backfill) block every read request — including
    the initial books fetch that the UI needs to render.

    PRAGMA synchronous=NORMAL is safe with WAL and ~3× faster than FULL.
    """
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

_MIGRATIONS = [
    ("books", "cover_url TEXT"),
    ("books", "genre VARCHAR(50)"),
    ("books", "subjects_json TEXT"),
    ("books", "ol_avg_rating REAL"),
    ("books", "ol_ratings_count INTEGER"),
    ("books", "ol_work_key VARCHAR(50)"),
    ("books", "enriched_at DATETIME"),
    ("books", "booklist_id INTEGER"),
    ("books", "year_acquired INTEGER"),
    ("booklist_pending", "year_acquired INTEGER"),
    ("books", "author_gender VARCHAR(20)"),
    ("books", "author_ethnicity VARCHAR(100)"),
    ("books", "diversity_enriched_at DATETIME"),
    ("books", "author_diversity_manual BOOLEAN DEFAULT FALSE"),
    ("books", "series_name VARCHAR(255)"),
    ("books", "series_position INTEGER"),
    ("discovery_candidates", "user_id INTEGER REFERENCES users(id)"),
    ("booklist_pending", "user_id INTEGER REFERENCES users(id)"),
    ("ingest_log", "user_id INTEGER REFERENCES users(id)"),
    ("series_catalog", "manually_curated BOOLEAN DEFAULT FALSE"),
]

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_extrating_book ON external_ratings(book_id)",
    "CREATE INDEX IF NOT EXISTS ix_extrating_user ON external_ratings(ext_user_id)",
    "CREATE INDEX IF NOT EXISTS ix_booksim_a ON book_similarity(book_a_id)",
]


def _run_migrations():
    with engine.connect() as conn:
        for table, col_def in _MIGRATIONS:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_def}"))
                conn.commit()
            except Exception:
                pass


def _backfill_series() -> None:
    """Parse series name + position from book titles for any books not yet tagged."""
    from ingest.series import parse_series
    db = SessionLocal()
    try:
        books = db.query(Book).filter(
            Book.series_name.is_(None),
            Book.title.like('%(%'),
        ).all()
        for b in books:
            name, pos = parse_series(b.title)
            if name:
                b.series_name = name
                b.series_position = pos
        db.commit()
    finally:
        db.close()


def _migrate_to_multiuser() -> None:
    """Bootstrap multi-user schema. Idempotent: skips if any users already exist."""
    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()
        if count > 0:
            return  # Already set up

        email = os.environ.get("SHELFLIFE_BOOTSTRAP_EMAIL", "")
        password = os.environ.get("SHELFLIFE_BOOTSTRAP_PASSWORD", "")
        if not email or not password:
            return  # No bootstrap credentials configured

        from auth import hash_password
        hashed = hash_password(password)
        display_name = email.split("@")[0]
        conn.execute(text(
            "INSERT INTO users (email, hashed_pw, is_admin, display_name, created_at) "
            "VALUES (:email, :hashed_pw, 1, :display_name, datetime('now'))"
        ), {"email": email, "hashed_pw": hashed, "display_name": display_name})
        conn.commit()

        # Copy all existing books into user_books for the bootstrap user (id=1)
        conn.execute(text("""
            INSERT INTO user_books
                (user_id, book_id, exclusive_shelf, my_rating, date_read,
                 date_added, my_review, bookshelves, read_count, year_acquired)
            SELECT
                1, id, exclusive_shelf, my_rating, date_read,
                date_added, my_review, bookshelves, read_count, year_acquired
            FROM books
        """))
        conn.commit()

        # Assign existing rows in other tables to the bootstrap user
        conn.execute(text("UPDATE discovery_candidates SET user_id = 1 WHERE user_id IS NULL"))
        conn.execute(text("UPDATE booklist_pending SET user_id = 1 WHERE user_id IS NULL"))
        conn.execute(text("UPDATE ingest_log SET user_id = 1 WHERE user_id IS NULL"))
        conn.commit()

        # Create the first invite code and print it to stdout
        code = secrets.token_urlsafe(32)
        conn.execute(text(
            "INSERT INTO invite_codes (code, created_by) VALUES (:code, 1)"
        ), {"code": code})
        conn.commit()

        print(f"\n[ShelfLife] Bootstrap complete — admin: {email}")
        print(f"[ShelfLife] First invite code: {code}\n")


def init_db():
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    with engine.connect() as conn:
        for sql in _INDEXES:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass
    _migrate_to_multiuser()
    _backfill_series()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
