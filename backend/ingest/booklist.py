"""Ingest a personal book-ownership CSV (Google Sheets export).

Column layout expected:
  Index, "Author, Last", "Author, First", Title, Read?, Category, Subcategory,
  Year Acquired, Status, From

Match classification for each sheet row:
  - Confident match:  exactly one title hit AND normalized authors match exactly
                      → auto-merge (set owned_copies=1, booklist_id on existing book)
  - Uncertain match:  title hit but author differs, one side missing, or multiple hits
                      → staged in BooklistPending for user review
  - No match:         no title hit → insert as new book (goodreads_book_id = -index)

Goodreads data wins on all fields for matched books; only ownership is updated.

Re-imports are idempotent:
  - Confident merges:  same UPDATE, no side effects
  - Pending entries:   on_conflict_do_nothing on booklist_index
  - New book inserts:  on_conflict_do_update on goodreads_book_id
"""

import csv
import io
import json
import re
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from db.models import Book, BooklistPending


# ── Normalisation helpers ──────────────────────────────────────────────────────

def _normalize(s: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace, drop leading article."""
    s = s.lower().strip()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^(the|a|an)\s+", "", s)
    return s


def _combine_author(last: str, first: str) -> tuple[str | None, str | None]:
    last, first = last.strip(), first.strip()
    if last and first:
        return f"{first} {last}", f"{last}, {first}"
    val = last or first or None
    return val, val


def _map_shelf(read_flag: str) -> str:
    return "read" if read_flag.strip().lower() == "yes" else "to-read"


def _map_genre(category: str) -> str | None:
    c = category.strip().lower()
    if c == "fiction":
        return "Fiction"
    if c in ("nonfiction", "non-fiction"):
        return "Non-fiction"
    if c == "cookbook":
        return "Cookbooks"
    return None


def _book_entry_from_pending(pending: BooklistPending) -> dict[str, Any]:
    """Build a Book insert dict from a resolved pending row."""
    bookshelves = None
    if pending.category:
        bookshelves = (
            f"{pending.category}, {pending.subcategory}"
            if pending.subcategory
            else pending.category
        )
    return {
        "goodreads_book_id": -(pending.booklist_index),
        "booklist_id": pending.booklist_index,
        "title": pending.title,
        "author": pending.author,
        "author_lf": pending.author_lf,
        "my_rating": 0,
        "exclusive_shelf": _map_shelf(pending.read_flag or ""),
        "genre": _map_genre(pending.category or ""),
        "bookshelves": bookshelves,
        "owned_copies": 1,
        "read_count": 1 if (pending.read_flag or "").lower() == "yes" else 0,
        "year_acquired": pending.year_acquired,
    }


# ── Main ingest ────────────────────────────────────────────────────────────────

def ingest_csv(content: str | bytes, db: Session) -> dict[str, Any]:
    if isinstance(content, bytes):
        content = content.decode("utf-8-sig")

    reader = csv.DictReader(io.StringIO(content))
    rows = list(reader)

    # Build lookup: normalized_title -> [(book.id, normalized_author)]
    title_index: dict[str, list[tuple[int, str]]] = {}
    for book in db.query(Book).filter(Book.goodreads_book_id > 0).all():
        nt = _normalize(book.title)
        na = _normalize(book.author or "")
        title_index.setdefault(nt, []).append((book.id, na))

    # Pre-build sets for idempotency checks
    existing_sheet_ids: set[int] = set(
        r for (r,) in db.query(Book.booklist_id).filter(Book.booklist_id != None).all()
    )
    # Include all statuses — dismissed/resolved rows should also block re-staging
    existing_pending_ids: set[int] = set(
        r for (r,) in db.query(BooklistPending.booklist_index).all()
    )

    matched = 0
    inserted = 0
    staged = 0
    errors: list[str] = []
    to_stage: list[BooklistPending] = []

    for row in rows:
        try:
            raw_idx = row.get("Index", "").strip()
            if not raw_idx:
                continue
            idx = int(raw_idx)

            # Skip rows already processed in a previous import (any path)
            if idx in existing_sheet_ids or idx in existing_pending_ids:
                continue

            title = row.get("Title", "").strip()
            if not title:
                errors.append(f"Row {idx}: missing title")
                continue

            last = row.get("Author, Last", "")
            first = row.get("Author, First", "")
            author_full, author_lf = _combine_author(last, first)

            read_flag = row.get("Read?", "").strip()
            category = row.get("Category", "").strip()
            subcategory = row.get("Subcategory", "").strip()
            raw_year = row.get("Year Acquired", "").strip()
            year_acquired = int(raw_year) if raw_year.isdigit() else None

            nt = _normalize(title)
            na = _normalize(author_full or "")

            candidates = title_index.get(nt, [])

            # ── Confident match ──────────────────────────────────────────────
            if (
                len(candidates) == 1
                and na  # sheet has an author
                and candidates[0][1]  # DB book has an author
                and candidates[0][1] == na
            ):
                update = {"owned_copies": 1, "booklist_id": idx}
                if year_acquired is not None:
                    update["year_acquired"] = year_acquired
                db.query(Book).filter(Book.id == candidates[0][0]).update(
                    update, synchronize_session=False,
                )
                matched += 1

            # ── Uncertain match ──────────────────────────────────────────────
            elif candidates:
                if idx not in existing_pending_ids:
                    candidate_ids = [bid for bid, _ in candidates[:10]]
                    to_stage.append(BooklistPending(
                        booklist_index=idx,
                        title=title,
                        author=author_full,
                        author_lf=author_lf,
                        read_flag=read_flag or None,
                        category=category or None,
                        subcategory=subcategory or None,
                        year_acquired=year_acquired,
                        candidate_book_ids=json.dumps(candidate_ids),
                        status="pending",
                        created_at=datetime.utcnow(),
                    ))
                    staged += 1

            # ── No match — insert as new sheet-only book ─────────────────────
            else:
                bookshelves = (
                    f"{category}, {subcategory}" if subcategory else category or None
                )
                entry: dict[str, Any] = {
                    "goodreads_book_id": -idx,
                    "booklist_id": idx,
                    "title": title,
                    "author": author_full,
                    "author_lf": author_lf,
                    "my_rating": 0,
                    "exclusive_shelf": _map_shelf(read_flag),
                    "genre": _map_genre(category),
                    "bookshelves": bookshelves,
                    "owned_copies": 1,
                    "read_count": 1 if read_flag.lower() == "yes" else 0,
                    "year_acquired": year_acquired,
                }
                stmt = (
                    sqlite_insert(Book)
                    .values(**entry)
                    .on_conflict_do_update(
                        index_elements=["goodreads_book_id"],
                        set_={k: v for k, v in entry.items() if k != "goodreads_book_id"},
                    )
                )
                db.execute(stmt)
                if idx not in existing_sheet_ids:
                    inserted += 1

        except Exception as e:
            errors.append(f"Row {row.get('Index', '?')}: {e}")

    if to_stage:
        db.bulk_save_objects(to_stage)

    db.commit()

    return {
        "source": "booklist",
        "total_rows": len(rows),
        "matched": matched,
        "inserted": inserted,
        "pending": staged,
        "errors": errors[:20],
    }
