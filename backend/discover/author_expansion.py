"""Author-expansion candidate source.

For each author the user rates ≥ 4.0 (with ≥ 2 reads), fetch their OL
bibliography and emit works not already on the shelf.
"""
import time

from sqlalchemy.orm import Session

from . import ol_search

MIN_AVG_RATING = 4.0
MIN_READ_COUNT = 3   # matches recommend._build_profile min_data so author_offset is always available
WORKS_PER_AUTHOR = 12
RATE_DELAY = 0.2   # seconds between OL calls


def candidates(
    db: Session,
    profile: dict,
    known_work_keys: set[str],
    known_titles: set[str],
) -> list[dict]:
    """Return candidate seeds sourced from beloved authors' bibliographies."""
    author_avgs: dict[str, float] = profile.get("author_user_avg", {})

    # Also check raw counts so we can enforce MIN_READ_COUNT.
    # profile doesn't store counts, so pull from the by_author data indirectly:
    # we stored author_user_avg only for authors with >= min_data reads (default 3),
    # but here we want >= 2. Query DB directly.
    from db.models import Book
    from collections import defaultdict
    import statistics

    read_books = db.query(Book).filter(
        Book.exclusive_shelf == "read",
        Book.my_rating != None,
        Book.my_rating > 0,
        Book.author != None,
    ).all()

    by_author: dict[str, list[float]] = defaultdict(list)
    for b in read_books:
        by_author[b.author].append(b.my_rating)

    loved_authors = [
        a for a, rs in by_author.items()
        if len(rs) >= MIN_READ_COUNT and statistics.fmean(rs) >= MIN_AVG_RATING
    ]

    results: list[dict] = []
    for author in loved_authors:
        seeds = ol_search.by_author(author, limit=WORKS_PER_AUTHOR)
        time.sleep(RATE_DELAY)
        avg = statistics.fmean(by_author[author])
        for seed in seeds:
            wk = seed["ol_work_key"]
            if not wk:
                continue
            if wk in known_work_keys:
                continue
            t_norm = _normalize(seed["title"])
            if t_norm in known_titles:
                continue
            seed["source"] = "author"
            seed["source_evidence"] = {"author": author, "your_avg": round(avg, 2)}
            results.append(seed)

    return results


def _normalize(title: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]", "", title.lower())
