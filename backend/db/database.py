from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from .models import Base

DB_PATH = Path(__file__).parent.parent.parent / "data" / "shelflife.db"
DB_PATH.parent.mkdir(exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
