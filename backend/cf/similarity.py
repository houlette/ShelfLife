"""Compute item-item cosine similarity from external ratings.

We only need similarity between books in the user's library (read or to-read).
For each pair (a, b), cosine similarity is computed over users who rated both,
using mean-centered ratings to reduce per-user rating-scale bias.
"""
import math
from collections import defaultdict
from typing import Any

from sqlalchemy import delete
from sqlalchemy.orm import Session

from db.models import Book, BookSimilarity, ExternalRating

MIN_CO_RATERS = 5     # need at least N users who rated both
MIN_SIM = 0.05        # don't store ~zero similarities (noise)
TOP_K_NEIGHBORS = 50  # only keep top K most-similar pairs per book (cap storage)


def _load_book_user_vectors(db: Session) -> tuple[dict[int, dict[int, float]], dict[int, float]]:
    """Returns (book_id → {user_id: rating}, user_id → mean_rating)."""
    book_users: dict[int, dict[int, float]] = defaultdict(dict)
    user_ratings: dict[int, list[float]] = defaultdict(list)

    library_ids = {b.id for b in db.query(Book.id).all()}

    rows = db.query(ExternalRating.book_id, ExternalRating.ext_user_id, ExternalRating.rating).all()
    for book_id, uid, r in rows:
        if book_id not in library_ids:
            continue
        book_users[book_id][uid] = r
        user_ratings[uid].append(r)

    user_mean = {uid: sum(rs) / len(rs) for uid, rs in user_ratings.items() if rs}
    return book_users, user_mean


def _cosine(a: dict[int, float], b: dict[int, float], user_mean: dict[int, float]) -> tuple[float, int]:
    """Mean-centered cosine similarity over shared users."""
    shared = a.keys() & b.keys()
    if len(shared) < MIN_CO_RATERS:
        return 0.0, len(shared)
    num = sa = sb = 0.0
    for u in shared:
        ra = a[u] - user_mean[u]
        rb = b[u] - user_mean[u]
        num += ra * rb
        sa += ra * ra
        sb += rb * rb
    if sa <= 0 or sb <= 0:
        return 0.0, len(shared)
    return num / math.sqrt(sa * sb), len(shared)


def build(db: Session) -> dict[str, Any]:
    """Build the BookSimilarity table from current ExternalRating rows."""
    db.execute(delete(BookSimilarity))
    db.commit()

    book_users, user_mean = _load_book_user_vectors(db)
    book_ids = sorted(book_users.keys())
    n_books = len(book_ids)

    # For each book, keep top-K similar books
    pairs_per_book: dict[int, list[tuple[float, int, int]]] = defaultdict(list)

    # n_books squared can be ~1M for 1000 covered books; pure-Python is OK
    for i, a_id in enumerate(book_ids):
        a_vec = book_users[a_id]
        for j in range(i + 1, n_books):
            b_id = book_ids[j]
            sim, n_co = _cosine(a_vec, book_users[b_id], user_mean)
            if abs(sim) < MIN_SIM:
                continue
            pairs_per_book[a_id].append((sim, b_id, n_co))
            pairs_per_book[b_id].append((sim, a_id, n_co))

    # Trim to top-K per book and persist
    inserted = 0
    batch: list[dict] = []
    for a_id, lst in pairs_per_book.items():
        lst.sort(key=lambda x: -x[0])
        for sim, b_id, n_co in lst[:TOP_K_NEIGHBORS]:
            batch.append({"book_a_id": a_id, "book_b_id": b_id,
                          "similarity": sim, "n_co_raters": n_co})
            inserted += 1
        if len(batch) >= 5000:
            db.bulk_insert_mappings(BookSimilarity, batch)
            db.commit()
            batch.clear()
    if batch:
        db.bulk_insert_mappings(BookSimilarity, batch)
        db.commit()

    return {
        "books_covered": n_books,
        "pairs_stored": inserted,
    }
