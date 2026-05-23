import csv
import io
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from db.models import Book, UserBook
from ingest.series import parse_series


def _parse_date(s: str) -> date | None:
    s = s.strip()
    if not s:
        return None
    for fmt in ("%Y/%m/%d", "%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _clean_isbn(s: str) -> str | None:
    s = s.strip().strip('="').strip('"')
    return s if s else None


def _safe_int(s: str) -> int | None:
    s = s.strip()
    if not s:
        return None
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return None


def _safe_float(s: str) -> float | None:
    s = s.strip()
    if not s:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def ingest_csv(content: str | bytes, db: Session, user_id: int) -> dict[str, Any]:
    if isinstance(content, bytes):
        content = content.decode("utf-8-sig")

    reader = csv.DictReader(io.StringIO(content))
    rows = list(reader)

    # Existing book catalog IDs (for insert/update counting)
    existing_book_ids = {row[0] for row in db.query(Book.goodreads_book_id).all()}
    # Existing UserBook pairs for this user
    existing_ub = {
        row[0]
        for row in db.query(Book.goodreads_book_id)
        .join(UserBook, UserBook.book_id == Book.id)
        .filter(UserBook.user_id == user_id)
        .all()
    }

    # Catalog fields never overwrite on re-import
    CATALOG_NEVER_OVERWRITE = {"goodreads_book_id"}
    # User fields that shouldn't regress: date_added (historical fact)
    USER_NEVER_OVERWRITE = {"date_added"}
    # User fields preserved when null (don't blank out existing content)
    USER_PRESERVE_IF_NULL = {"my_review"}

    inserted = 0
    updated = 0
    errors: list[str] = []

    for row in rows:
        book_id = _safe_int(row.get("Book Id", ""))
        if book_id is None:
            errors.append(f"Missing Book Id in row: {row.get('Title', '?')}")
            continue

        title = row.get("Title", "").strip()
        if not title:
            errors.append(f"Missing title for Book Id {book_id}")
            continue

        bookshelves_raw = row.get("Bookshelves", "").strip()
        bookshelves = bookshelves_raw if bookshelves_raw else None
        series_name, series_position = parse_series(title)

        # ── 1. Upsert shared Book catalog ──────────────────────────────────
        catalog = {
            "goodreads_book_id": book_id,
            "title": title,
            "author": row.get("Author", "").strip() or None,
            "author_lf": row.get("Author l-f", "").strip() or None,
            "additional_authors": row.get("Additional Authors", "").strip() or None,
            "isbn": _clean_isbn(row.get("ISBN", "")),
            "isbn13": _clean_isbn(row.get("ISBN13", "")),
            "average_rating": _safe_float(row.get("Average Rating", "")),
            "publisher": row.get("Publisher", "").strip() or None,
            "binding": row.get("Binding", "").strip() or None,
            "num_pages": _safe_int(row.get("Number of Pages", "")),
            "year_published": _safe_int(row.get("Year Published", "")),
            "original_pub_year": _safe_int(row.get("Original Publication Year", "")),
            "series_name": series_name,
            "series_position": series_position,
        }
        cat_stmt = (
            sqlite_insert(Book)
            .values(**catalog)
            .on_conflict_do_update(
                index_elements=["goodreads_book_id"],
                set_={k: v for k, v in catalog.items() if k not in CATALOG_NEVER_OVERWRITE},
            )
        )
        db.execute(cat_stmt)

        # ── 2. Get the Book.id for the row we just upserted ───────────────
        book = db.query(Book).filter(Book.goodreads_book_id == book_id).first()
        if not book:
            errors.append(f"Failed to locate book {book_id} after upsert")
            continue

        # ── 3. Upsert per-user UserBook ────────────────────────────────────
        user_entry = {
            "user_id": user_id,
            "book_id": book.id,
            "my_rating": _safe_int(row.get("My Rating", "0")) or 0,
            "date_read": _parse_date(row.get("Date Read", "")),
            "date_added": _parse_date(row.get("Date Added", "")),
            "exclusive_shelf": row.get("Exclusive Shelf", "").strip() or None,
            "bookshelves": bookshelves,
            "my_review": row.get("My Review", "").strip() or None,
            "read_count": _safe_int(row.get("Read Count", "1")) or 1,
            "year_acquired": None,  # comes from booklist, not Goodreads CSV
        }
        ub_update = {
            k: v for k, v in user_entry.items()
            if k not in USER_NEVER_OVERWRITE
            and not (k in USER_PRESERVE_IF_NULL and v is None)
            and k not in {"user_id", "book_id"}
        }
        ub_stmt = (
            sqlite_insert(UserBook)
            .values(**user_entry)
            .on_conflict_do_update(
                index_elements=["user_id", "book_id"],
                set_=ub_update,
            )
        )
        db.execute(ub_stmt)

        if book_id in existing_ub:
            updated += 1
        else:
            inserted += 1

    db.commit()

    return {
        "source": "goodreads",
        "total_rows": len(rows),
        "inserted": inserted,
        "updated": updated,
        "errors": errors[:20],
    }
