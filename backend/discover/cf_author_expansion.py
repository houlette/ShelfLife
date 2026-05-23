"""CF-author-expansion candidate source.

Finds *new* authors the user is likely to enjoy, using item-item collaborative
filtering:

  1. Anchor books  = user's highly-rated read books (rating >= MIN_RATING) that
                     appear in the BookSimilarity table.
  2. Walk similarity edges (book_a → book_b) where book_b is by an author the
     user has never read (any shelf).
  3. Accumulate signal per new author:  sum(similarity × user_rating)
  4. Rank top TOP_AUTHORS by signal; fetch their OL bibliography; emit seeds.

source_evidence schema:
  {"new_author": str, "via_book": str, "n_anchors": int, "signal": float}
"""
import time
from collections import defaultdict

from sqlalchemy.orm import Session

from db.models import Book, BookSimilarity, UserBook
from . import ol_search

MIN_RATING       = 4.0   # anchor = read book rated this or above
MIN_ANCHORS      = 2     # ignore authors reached by only one anchor (noise gate)
TOP_AUTHORS      = 10    # how many new authors to expand via OL
WORKS_PER_AUTHOR = 10    # OL works to request per author
RATE_DELAY       = 0.2   # seconds between OL API calls


def candidates(
    db: Session,
    profile: dict,
    known_work_keys: set[str],
    known_titles: set[str],
    user_id: int | None = None,
) -> list[dict]:
    """Return candidate seeds sourced from CF-similar authors the user hasn't read."""
    import re

    def _norm(t: str) -> str:
        return re.sub(r"[^a-z0-9]", "", t.lower())

    # ------------------------------------------------------------------
    # 1. Anchor books: user's highly-rated reads
    # ------------------------------------------------------------------
    anchor_pairs = (
        db.query(UserBook, Book)
        .join(Book, UserBook.book_id == Book.id)
        .filter(
            UserBook.user_id == user_id,
            UserBook.exclusive_shelf == "read",
            UserBook.my_rating >= MIN_RATING,
            Book.author.isnot(None),
        )
        .all()
    )

    if not anchor_pairs:
        return []

    anchor_ids: dict[int, float] = {b.id: float(ub.my_rating) for ub, b in anchor_pairs}
    anchor_titles: dict[int, str] = {b.id: b.title for _, b in anchor_pairs}

    # ------------------------------------------------------------------
    # 2. All authors the user has ever shelved (any shelf) — exclude these
    # ------------------------------------------------------------------
    all_known_authors: set[str] = {
        b.author
        for _, b in (
            db.query(UserBook, Book)
            .join(Book, UserBook.book_id == Book.id)
            .filter(UserBook.user_id == user_id, Book.author.isnot(None))
            .all()
        )
        if b.author
    }

    # ------------------------------------------------------------------
    # 3. Walk similarity edges originating from anchor books
    # ------------------------------------------------------------------
    # BookSimilarity stores both directions, so book_a_id query is sufficient.
    edges = (
        db.query(BookSimilarity)
        .filter(BookSimilarity.book_a_id.in_(list(anchor_ids.keys())))
        .all()
    )

    if not edges:
        return []

    # Load neighbor book metadata (for author lookup)
    neighbor_ids = {e.book_b_id for e in edges}
    neighbor_books: dict[int, Book] = {
        b.id: b
        for b in db.query(Book).filter(Book.id.in_(neighbor_ids)).all()
    }

    # ------------------------------------------------------------------
    # 4. Accumulate signal per new author
    # ------------------------------------------------------------------
    author_signal:       dict[str, float]         = defaultdict(float)
    author_anchors:      dict[str, set[int]]       = defaultdict(set)
    # (best_contribution, anchor_book_id) — for evidence label
    author_best_anchor:  dict[str, tuple[float, int]] = {}

    for edge in edges:
        neighbor = neighbor_books.get(edge.book_b_id)
        if neighbor is None or not neighbor.author:
            continue
        if neighbor.author in all_known_authors:
            continue    # user already knows this author — skip

        contrib = edge.similarity * anchor_ids[edge.book_a_id]
        author_signal[neighbor.author] += contrib
        author_anchors[neighbor.author].add(edge.book_a_id)

        prev = author_best_anchor.get(neighbor.author)
        if prev is None or contrib > prev[0]:
            author_best_anchor[neighbor.author] = (contrib, edge.book_a_id)

    if not author_signal:
        return []

    # ------------------------------------------------------------------
    # 5. Rank; apply noise gate; pick top authors
    # ------------------------------------------------------------------
    ranked = sorted(
        [
            (author, signal)
            for author, signal in author_signal.items()
            if len(author_anchors[author]) >= MIN_ANCHORS
        ],
        key=lambda x: x[1],
        reverse=True,
    )

    top = ranked[:TOP_AUTHORS]
    if not top:
        return []

    # ------------------------------------------------------------------
    # 6. Fetch OL works for each top author and emit seeds
    # ------------------------------------------------------------------
    results: list[dict] = []

    for author, signal in top:
        seeds = ol_search.by_author(author, limit=WORKS_PER_AUTHOR)
        time.sleep(RATE_DELAY)

        n_anchors = len(author_anchors[author])
        _, best_anchor_id = author_best_anchor[author]
        via_book = anchor_titles.get(best_anchor_id, "")

        for seed in seeds:
            wk = seed["ol_work_key"]
            if not wk:
                continue
            if wk in known_work_keys:
                continue
            if _norm(seed["title"]) in known_titles:
                continue

            seed["source"] = "cf_author"
            seed["source_evidence"] = {
                "new_author": author,
                "via_book":   via_book,
                "n_anchors":  n_anchors,
                "signal":     round(signal, 2),
            }
            results.append(seed)

    return results
