"""Open Library enrichment: fetch covers, ratings, subjects per ISBN."""
import json
import re
import time
from datetime import datetime
from typing import Any

import requests
from sqlalchemy.orm import Session

from db.models import Book

OL_SEARCH = "https://openlibrary.org/search.json"
COVER_BASE = "https://covers.openlibrary.org/b/id"
FIELDS = "key,title,ratings_average,ratings_count,subject,cover_i,first_publish_year"

# ─── Genre normalization ─────────────────────────────────────────────────────
#
# Maps Open Library subject strings to a small set of curated genre buckets.
# Order matters — first match wins. Specific buckets come before broad ones.

GENRE_RULES: list[tuple[str, list[str]]] = [
    # ── Fiction-specific (highest priority) ──────────────────────────────────
    # Horror before Sci-Fi: many horror books have "fiction, science fiction" tags
    ("Horror",             ["horror fiction", "horror tales", "horror stories", "ghost stories", "vampires"]),
    ("Sci-Fi",             ["science fiction", "sci-fi", "scifi", "space opera", "cyberpunk", "dystopian fiction", "post-apocalyptic"]),
    ("Fantasy",            ["fantasy fiction", "fantasy", "epic fantasy", "sword and sorcery", "wizards", "dragons"]),
    ("Mystery/Thriller",   ["mystery fiction", "thrillers", "suspense fiction", "detective and mystery stories", "crime fiction", "noir fiction", "spy stories", "espionage"]),
    ("Romance",            ["romance fiction", "love stories", "romantic fiction"]),
    ("Historical Fiction", ["historical fiction", "historical novel"]),
    # Children's before Graphic Novel: e.g. Diary of a Wimpy Kid is both
    ("Children's",         ["juvenile fiction", "children's fiction", "children's stories", "picture books", "young adult fiction"]),
    ("Graphic Novel",      ["graphic novel", "graphic novels", "comic books, strips, etc."]),
    ("Poetry",             ["poetry", "poems", "american poetry", "english poetry"]),
    ("Drama",              ["drama", "plays", "theater"]),
    ("Cookbooks",          ["cookbooks", "cooking", "recipes", "cuisine"]),

    # ── Generic Fiction catches "fiction" subject before non-fiction buckets ─
    ("Fiction",            ["fiction", "literary fiction", "short stories", "novels", "domestic fiction", "psychological fiction", "literature"]),

    # ── Non-fiction-specific ──────────────────────────────────────────────────
    ("Biography/Memoir",   ["biography", "memoir", "autobiography", "personal narratives"]),
    ("History",            ["history", "historical"]),
    # Tightened: dropped bare "science" (matches "social science"); kept domain words
    ("Science",            ["physics", "biology", "astronomy", "mathematics", "evolution", "climate change", "neuroscience", "popular science", "natural history"]),
    ("Business",           ["business", "economics", "management", "leadership", "finance"]),
    # Tightened: only specific self-help signals; dropped "habits", "productivity" (too broad)
    ("Self-Help",          ["self-help", "personal growth", "personal development", "self-improvement"]),
    ("Politics",           ["politics", "political science", "public policy"]),
    ("Philosophy",         ["philosophy", "ethics", "metaphysics"]),
    ("Religion",           ["religion", "religious", "spirituality", "theology", "buddhism", "christianity"]),
    ("Travel",             ["travel", "voyages and travels", "travel guides"]),
    ("Art",                ["art", "design", "architecture", "photography"]),
    ("Essays",             ["essays"]),

    # ── Catch-all ─────────────────────────────────────────────────────────────
    ("Non-fiction",        ["non-fiction", "nonfiction"]),
]


# Pre-compile regex patterns. Each subject is matched as a whole word/phrase to
# avoid substring false positives (e.g. "psychology" inside "psychological fiction").
_COMPILED: list[tuple[str, list[re.Pattern]]] | None = None


def _compile():
    global _COMPILED
    _COMPILED = [
        (bucket, [re.compile(rf"(?<!\w){re.escape(kw)}(?!\w)", re.IGNORECASE) for kw in keywords])
        for bucket, keywords in GENRE_RULES
    ]


def normalize_genre(subjects: list[str]) -> str | None:
    if not subjects:
        return None
    if _COMPILED is None:
        _compile()
    # Iterate buckets in priority order; for each bucket check whether any
    # subject matches any of its keywords. This preserves rule priority
    # (Sci-Fi beats Fiction even if "Fiction" subject appears first).
    lowered = [s.lower() for s in subjects]
    for bucket, patterns in _COMPILED:
        for p in patterns:
            for s in lowered:
                if p.search(s):
                    return bucket
    return None


def reclassify_all(db: Session) -> dict[str, Any]:
    """Re-run genre classification on stored subjects without re-fetching from OL.
    Useful after tweaking GENRE_RULES."""
    _compile()
    books = db.query(Book).filter(Book.subjects_json != None).all()
    changed = 0
    for b in books:
        try:
            subjects = json.loads(b.subjects_json)
        except Exception:
            continue
        new_genre = normalize_genre(subjects)
        if new_genre != b.genre:
            b.genre = new_genre
            changed += 1
    db.commit()
    return {"reclassified": changed, "total_with_subjects": len(books)}


_FIELDS_WITH_ISBN = FIELDS + ",isbn"


def backfill_missing_covers(
    db: Session, limit: int | None = None, rate_per_sec: float = 3.0
) -> dict[str, Any]:
    """Back-fill ``cover_url`` for books that currently have none.

    Re-runs the OL ISBN (or title) search for every cover-less book.  The
    original enrichment run may have found these books without a ``cover_i``
    (OL's search index lags behind their cover uploads), or returned nothing at
    all if the book wasn't indexed yet.

    On a successful hit, also writes back ``ol_work_key`` if it was previously
    missing.  Other fields (subjects, genre, ratings) are NOT touched so
    already-good data is preserved.
    """
    q = db.query(Book).filter(Book.cover_url == None)
    if limit:
        q = q.limit(limit)
    books = q.all()

    delay = 1.0 / rate_per_sec
    checked = len(books)
    filled = 0
    not_found = 0

    for b in books:
        isbn = b.isbn13 or b.isbn
        if isbn:
            doc = _fetch(isbn)
        elif b.title:
            doc = _fetch_by_title_author(b.title, b.author)
        else:
            doc = None

        cover_i = doc.get("cover_i") if doc else None

        if cover_i:
            b.cover_url = f"{COVER_BASE}/{cover_i}-M.jpg"
            # Opportunistically grab the work key if we didn't have it
            if not b.ol_work_key and doc and doc.get("key"):
                b.ol_work_key = doc["key"]
            if not b.enriched_at:
                b.enriched_at = datetime.utcnow()
            filled += 1
        else:
            not_found += 1

        time.sleep(delay)

    db.commit()
    return {"checked": checked, "filled": filled, "not_found": not_found}


def _fetch(isbn: str) -> dict[str, Any] | None:
    try:
        r = requests.get(
            OL_SEARCH,
            params={"q": f"isbn:{isbn}", "limit": 1, "fields": FIELDS},
            timeout=10,
        )
        r.raise_for_status()
        docs = r.json().get("docs", [])
        return docs[0] if docs else None
    except Exception:
        return None


def _fetch_by_title_author(title: str, author: str | None) -> dict[str, Any] | None:
    """Search OL by title + author for books that have no ISBN.
    Returns the top doc (with isbn field included) or None."""
    params: dict[str, Any] = {"title": title, "limit": 1, "fields": _FIELDS_WITH_ISBN}
    if author:
        params["author"] = author
    try:
        r = requests.get(OL_SEARCH, params=params, timeout=10)
        r.raise_for_status()
        docs = r.json().get("docs", [])
        return docs[0] if docs else None
    except Exception:
        return None


def backfill_missing_covers(
    db: Session, limit: int | None = None, rate_per_sec: float = 3.0
) -> dict[str, Any]:
    """Back-fill ``cover_url`` for books that currently have none.

    Re-runs the OL ISBN (or title) search for every cover-less book.  The
    original enrichment run may have found these books without a ``cover_i``
    (OL's search index lags behind their cover uploads), or returned nothing
    at all if the book wasn't indexed yet.

    On a successful hit, also writes back ``ol_work_key`` if it was previously
    missing.  Other fields (subjects, genre, ratings) are NOT touched so
    already-good data is preserved.
    """
    q = db.query(Book).filter(Book.cover_url == None)
    if limit:
        q = q.limit(limit)
    books = q.all()

    delay = 1.0 / rate_per_sec
    checked = len(books)
    filled = 0
    not_found = 0

    for b in books:
        isbn = b.isbn13 or b.isbn
        if isbn:
            doc = _fetch(isbn)
        elif b.title:
            doc = _fetch_by_title_author(b.title, b.author)
        else:
            doc = None

        cover_i = doc.get("cover_i") if doc else None

        if cover_i:
            b.cover_url = f"{COVER_BASE}/{cover_i}-M.jpg"
            if not b.ol_work_key and doc and doc.get("key"):
                b.ol_work_key = doc["key"]
            if not b.enriched_at:
                b.enriched_at = datetime.utcnow()
            filled += 1
        else:
            not_found += 1

        time.sleep(delay)

    db.commit()
    return {"checked": checked, "filled": filled, "not_found": not_found}


def enrich_book(book: Book, doc: dict[str, Any]) -> bool:
    """Apply enrichment data to a book. Returns True if anything was set."""
    changed = False
    cover_i = doc.get("cover_i")
    if cover_i and not book.cover_url:
        book.cover_url = f"{COVER_BASE}/{cover_i}-M.jpg"
        changed = True

    subjects = doc.get("subject") or []
    if subjects:
        book.subjects_json = json.dumps(subjects[:50])
        book.genre = normalize_genre(subjects)
        changed = True

    avg = doc.get("ratings_average")
    cnt = doc.get("ratings_count")
    if avg is not None:
        book.ol_avg_rating = float(avg)
        changed = True
    if cnt is not None:
        book.ol_ratings_count = int(cnt)
        changed = True

    work_key = doc.get("key")
    if work_key:
        book.ol_work_key = work_key
        changed = True

    if changed:
        book.enriched_at = datetime.utcnow()
    return changed


def enrich_all(db: Session, only_unenriched: bool = True, limit: int | None = None,
               rate_per_sec: float = 5.0) -> dict[str, Any]:
    """Enrich books from Open Library.

    For books with ISBN: query by ISBN (fast, precise).
    For books without ISBN (e.g. sheet-only imports): query by title + author,
    and write back any ISBN found so future runs use the faster path.

    Rate-limited to be polite to the OL API.
    """
    q = db.query(Book)
    if only_unenriched:
        q = q.filter(Book.enriched_at == None)
    if limit:
        q = q.limit(limit)

    books = q.all()
    delay = 1.0 / rate_per_sec

    processed = 0
    enriched = 0
    not_found = 0
    errors: list[str] = []

    for b in books:
        isbn = b.isbn13 or b.isbn
        if isbn:
            doc = _fetch(isbn)
        else:
            doc = _fetch_by_title_author(b.title, b.author)
            if doc:
                # Write back any ISBN so future enrichment runs use the ISBN path
                isbns: list[str] = doc.get("isbn") or []
                isbn13 = next((i for i in isbns if len(i) == 13), None)
                if isbn13:
                    b.isbn13 = isbn13
                elif isbns:
                    b.isbn = isbns[0]

        processed += 1
        if doc:
            if enrich_book(b, doc):
                enriched += 1
        else:
            not_found += 1
            # Mark as attempted so we don't re-fetch on every run
            b.enriched_at = datetime.utcnow()

        if processed % 20 == 0:
            db.commit()

        time.sleep(delay)

    db.commit()
    return {
        "processed": processed,
        "enriched": enriched,
        "not_found": not_found,
        "errors": errors[:10],
    }
