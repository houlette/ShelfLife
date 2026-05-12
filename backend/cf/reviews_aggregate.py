"""Aggregate UCSD Goodreads reviews per book.

Streams the gzipped JSON-lines file. For each review whose book maps to a
local Book row, accumulates the text. Caps at MAX_REVIEWS_PER_BOOK reviews
and MAX_TEXT_PER_BOOK_CHARS chars per book to keep storage bounded.
"""
import gzip
import json
from pathlib import Path
from typing import Any

from sqlalchemy import delete
from sqlalchemy.orm import Session

from db.models import Book, BookReviewAgg

MAX_REVIEWS_PER_BOOK = 80      # cap reviews per book (most-voted first if known)
MAX_TEXT_PER_BOOK_CHARS = 40000  # cap text storage per book


def aggregate(reviews_path: Path, db: Session) -> dict[str, Any]:
    # Map goodreads_book_id (string) → local Book.id
    gr_to_local = {str(b.goodreads_book_id): b.id
                   for b in db.query(Book.id, Book.goodreads_book_id).all()
                   if b.goodreads_book_id}

    # Accumulator: book_id → {"texts": [(rating, n_votes, text), ...], "ratings": [int]}
    acc: dict[int, dict] = {}
    seen = 0

    with gzip.open(reviews_path, "rt", encoding="utf-8") as f:
        for line in f:
            seen += 1
            try:
                d = json.loads(line)
            except Exception:
                continue
            gr_id = str(d.get("book_id", ""))
            local_id = gr_to_local.get(gr_id)
            if local_id is None:
                continue
            text = (d.get("review_text") or "").strip()
            if not text:
                continue
            try:
                rating = int(d.get("rating") or 0)
            except (TypeError, ValueError):
                rating = 0
            n_votes = d.get("n_votes") or 0
            entry = acc.setdefault(local_id, {"texts": [], "ratings": []})
            entry["texts"].append((rating, n_votes, text))
            if rating > 0:
                entry["ratings"].append(rating)

    # Wipe and re-insert
    db.execute(delete(BookReviewAgg))
    db.commit()

    rows = []
    for book_id, entry in acc.items():
        # Prefer reviews with more votes (signal of community attention) and stronger ratings
        sorted_reviews = sorted(
            entry["texts"],
            key=lambda t: (t[1], abs(t[0] - 3)),  # by n_votes desc, then by rating polarity
            reverse=True,
        )
        chunks = []
        total_chars = 0
        for _, _, text in sorted_reviews[:MAX_REVIEWS_PER_BOOK]:
            if total_chars + len(text) > MAX_TEXT_PER_BOOK_CHARS:
                remaining = MAX_TEXT_PER_BOOK_CHARS - total_chars
                if remaining > 200:
                    chunks.append(text[:remaining])
                break
            chunks.append(text)
            total_chars += len(text) + 1
        blob = "\n".join(chunks)
        avg = (sum(entry["ratings"]) / len(entry["ratings"])) if entry["ratings"] else None
        rows.append({
            "book_id": book_id,
            "n_reviews": len(entry["texts"]),
            "avg_rating": avg,
            "text": blob,
        })

    db.bulk_insert_mappings(BookReviewAgg, rows)
    db.commit()

    return {
        "lines_seen": seen,
        "books_with_reviews": len(rows),
        "total_review_count": sum(r["n_reviews"] for r in rows),
    }
