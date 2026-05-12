"""Discovery pipeline orchestrator.

Runs all candidate sources, deduplicates by OL work key, scores each
candidate with the existing recommend._score_book (duck-typed), and
persists/updates DiscoveryCandidate rows.

Series dedup: for series books (title contains "(Series, #N)"), only surface
book #1 for series the user hasn't started; use _series_info from recommend.
"""
import json
import re
import time
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from db.models import Book, DiscoveryCandidate
from ingest.openlibrary import normalize_genre
import recommend
from recommend import _build_profile, _score_book, _reason

from . import author_expansion, subject_expansion


def _normalize_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", title.lower())


def _known_sets(db: Session) -> tuple[set[str], set[str]]:
    """Return (ol_work_keys, normalized_titles) for all books already on shelf."""
    books = db.query(Book).all()
    work_keys = {b.ol_work_key for b in books if b.ol_work_key}
    titles = {_normalize_title(b.title) for b in books if b.title}
    return work_keys, titles


def _dedup(seeds: list[dict]) -> list[dict]:
    """Deduplicate by ol_work_key, keeping the highest-priority source
    (author > subject). Merge source_evidence when both fired."""
    SOURCE_PRIORITY = {"author": 0, "subject": 1, "similarity": 2}
    best: dict[str, dict] = {}
    for seed in seeds:
        wk = seed["ol_work_key"]
        if wk not in best:
            best[wk] = seed
        else:
            existing = best[wk]
            # Prefer higher-priority source
            if SOURCE_PRIORITY.get(seed["source"], 99) < SOURCE_PRIORITY.get(existing["source"], 99):
                # Promote to higher-priority source, keep old evidence under alt_evidence
                seed["alt_evidence"] = existing.get("source_evidence")
                best[wk] = seed
            else:
                existing.setdefault("alt_evidence", seed.get("source_evidence"))
    return list(best.values())


def _series_ok(seed: dict, profile: dict) -> bool:
    """Return False for sequel entries in series the user hasn't read at all."""
    series_name, book_num = recommend._series_info(seed["title"])
    if series_name is None or book_num is None:
        return True          # not a series book
    if book_num == 1:
        return True          # always include book #1
    # If user has read book #1 of this series, allow sequels
    if series_name in profile.get("series_avg", {}):
        return True
    # Unknown series: skip everything after book #1 to avoid noise
    return False


def refresh_candidates(db: Session) -> dict[str, Any]:
    """Full refresh: generate → dedup → upsert → score. Returns summary stats."""
    t0 = time.time()

    profile = _build_profile(db)
    known_keys, known_titles = _known_sets(db)

    # --- Gather candidates from all sources ---
    from_authors = author_expansion.candidates(db, profile, known_keys, known_titles)
    from_subjects = subject_expansion.candidates(db, profile, known_keys, known_titles)

    all_seeds = _dedup(from_authors + from_subjects)

    # Filter candidates already dismissed or added
    existing: dict[str, DiscoveryCandidate] = {
        c.ol_work_key: c
        for c in db.query(DiscoveryCandidate).all()
    }

    generated = len(all_seeds)
    upserted = 0
    scored = 0
    skipped_series = 0

    for seed in all_seeds:
        wk = seed["ol_work_key"]
        if not wk or not seed.get("title"):
            continue

        # Skip sequels in unknown series
        if not _series_ok(seed, profile):
            skipped_series += 1
            continue

        # Keep dismissed/added as-is; only refresh "new" or new entries
        cand = existing.get(wk)
        if cand and cand.status in ("dismissed", "added"):
            continue

        if cand is None:
            cand = DiscoveryCandidate(
                ol_work_key=wk,
                created_at=datetime.utcnow(),
                status="new",
            )
            db.add(cand)

        # Apply enrichment data from OL search result
        cand.title = seed["title"]
        cand.author = seed.get("author")
        cand.source = seed["source"]
        cand.source_evidence = json.dumps(seed.get("source_evidence", {}))
        if seed.get("cover_url"):
            cand.cover_url = seed["cover_url"]
        if seed.get("ol_avg_rating") is not None:
            cand.ol_avg_rating = seed["ol_avg_rating"]
        if seed.get("ol_ratings_count") is not None:
            cand.ol_ratings_count = seed["ol_ratings_count"]
        if seed.get("original_pub_year"):
            cand.original_pub_year = seed["original_pub_year"]

        subjects = seed.get("subjects") or []
        if subjects:
            cand.subjects_json = json.dumps(subjects[:50])
            cand.genre = normalize_genre(subjects)

        upserted += 1

        # Score it — _score_book works duck-typed on attribute access
        if cand.genre and cand.ol_avg_rating is not None:
            s = _score_book(cand, profile)
            if s:
                cand.score = s["score"]
                cand.breakdown_json = json.dumps(s["breakdown"])
                cand.reason = _reason(cand, s)
                cand.scored_at = datetime.utcnow()
                scored += 1

    db.commit()

    top_score = (
        db.query(DiscoveryCandidate)
        .filter(DiscoveryCandidate.status == "new", DiscoveryCandidate.score != None)
        .order_by(DiscoveryCandidate.score.desc())
        .first()
    )

    return {
        "generated": generated,
        "upserted": upserted,
        "scored": scored,
        "skipped_series": skipped_series,
        "top_score": top_score.score if top_score else None,
        "elapsed_s": round(time.time() - t0, 1),
    }
