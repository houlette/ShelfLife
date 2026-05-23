"""Recommendation engine for ShelfLife.

Ranks books on the to-read shelf by predicted enjoyment, with a scoring formula
designed to counter fan-community rating inflation.
"""
import json
import math
import re
import statistics
from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

from db.models import Book
from ingest.series import SERIES_RE, parse_series as _parse_series_shared

# Score is a predicted 1-5 rating. Base is your genre baseline, then nudged by
# author offset, OL-z bonus, subject-affinity offset, and penalties.
# Weights tuned via random search + coordinate descent on a 75/25 split of
# rated, read books. Final MAE 0.512 vs baseline 0.580 vs naive-mean 0.624.
# See tune_weights.py.
BETA = 0.84    # author affinity (your_author_avg - genre_baseline)
GAMMA = 0.05   # OL z-score within genre — tuned ~0; direct evidence beats OL
ZETA = 0.61    # subject affinity (your avg rating across overlapping OL subjects)
THETA = 0.25   # collaborative-filtering KNN prediction
ETA = 0.48     # content text TF-IDF predictor (UCSD review aggregates)
DELTA = 0.0    # popularity penalty — tuned ~0; signal duplicated by author/text
EPSILON = 0.35  # series penalty — sequels meaningfully overpredict

GLOBAL_MEAN = 3.5      # neutral baseline when we have no genre data
SUBJECT_MIN_SUPPORT = 5  # subject must appear in N+ rated books to count
SUBJECT_MIN_OVERLAP = 3  # candidate must share N+ trustworthy subjects

def _series_info(title: str) -> tuple[str | None, int | None]:
    """Extract (series_name_lower, book_number) from a title, or (None, None)."""
    name, pos = _parse_series_shared(title)
    if name is None:
        return None, None
    return name.lower(), pos


def _build_profile(db: Session, min_data: int = 3, read: list[Book] | None = None) -> dict[str, Any]:
    """Compute the user profile from rated, read books."""
    if read is None:
        read = db.query(Book).filter(
            Book.exclusive_shelf == "read",
            Book.my_rating != None,
            Book.my_rating > 0,
        ).all()

    # Per-genre stats (your avg, OL avg, OL stdev)
    by_genre: dict[str, list[Book]] = defaultdict(list)
    for b in read:
        if b.genre:
            by_genre[b.genre].append(b)

    genre_user_avg: dict[str, float] = {}
    genre_ol_avg: dict[str, float] = {}
    genre_ol_stdev: dict[str, float] = {}
    genre_offset: dict[str, float] = {}

    for g, books in by_genre.items():
        if len(books) < min_data:
            continue
        ratings = [b.my_rating for b in books]
        ol_ratings = [b.ol_avg_rating for b in books if b.ol_avg_rating is not None]
        genre_user_avg[g] = statistics.fmean(ratings)
        if len(ol_ratings) >= min_data:
            genre_ol_avg[g] = statistics.fmean(ol_ratings)
            genre_ol_stdev[g] = statistics.pstdev(ol_ratings) if len(ol_ratings) > 1 else 0.5
            genre_offset[g] = genre_user_avg[g] - genre_ol_avg[g]

    # Per-author affinity (your avg rating)
    by_author: dict[str, list[float]] = defaultdict(list)
    for b in read:
        if b.author:
            by_author[b.author].append(b.my_rating)
    author_user_avg = {
        a: statistics.fmean(rs) for a, rs in by_author.items() if len(rs) >= min_data
    }

    # Series the user has read, with their average rating per series
    series_user_avg: dict[str, list[float]] = defaultdict(list)
    for b in read:
        s, _ = _series_info(b.title)
        if s:
            series_user_avg[s].append(b.my_rating)
    series_avg = {s: statistics.fmean(rs) for s, rs in series_user_avg.items()}

    # Subject affinity: for each OL subject seen on N+ rated books, the avg
    # rating of those books. Captures hidden taste signals (e.g. you love
    # "magical realism" tagged books regardless of genre).
    subject_ratings: dict[str, list[float]] = defaultdict(list)
    for b in read:
        if not b.subjects_json:
            continue
        try:
            subjects = json.loads(b.subjects_json)
        except Exception:
            continue
        for s in subjects:
            if isinstance(s, str):
                subject_ratings[s.strip().lower()].append(b.my_rating)
    subject_affinity = {
        s: statistics.fmean(rs)
        for s, rs in subject_ratings.items()
        if len(rs) >= SUBJECT_MIN_SUPPORT
    }
    subject_support = {s: len(subject_ratings[s]) for s in subject_affinity}

    # Global popularity baseline
    counts = [b.ol_ratings_count for b in db.query(Book).all()
              if b.ol_ratings_count and b.ol_ratings_count > 0]
    median_count = statistics.median(counts) if counts else 50

    return {
        "genre_user_avg": genre_user_avg,
        "genre_ol_avg": genre_ol_avg,
        "genre_ol_stdev": genre_ol_stdev,
        "genre_offset": genre_offset,
        "author_user_avg": author_user_avg,
        "series_avg": series_avg,
        "subject_affinity": subject_affinity,
        "subject_support": subject_support,
        "median_ratings_count": median_count,
    }


def _subject_score(book: Book, profile: dict[str, Any]) -> tuple[float | None, int]:
    """Average user-affinity across this book's subjects that we have data on.
    Returns (predicted_rating_from_subjects, n_overlapping_subjects)."""
    if not book.subjects_json:
        return None, 0
    try:
        subjects = json.loads(book.subjects_json)
    except Exception:
        return None, 0
    affinities = profile["subject_affinity"]
    matched = []
    for s in subjects:
        if not isinstance(s, str):
            continue
        v = affinities.get(s.strip().lower())
        if v is not None:
            matched.append(v)
    if len(matched) < SUBJECT_MIN_OVERLAP:
        return None, len(matched)
    return statistics.fmean(matched), len(matched)


def _score_book(book: Book, profile: dict[str, Any], cf_pred: dict[str, Any] | None = None, text_pred: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Score a single book. Returns None if insufficient data (no genre or no OL rating)."""
    if not book.genre or book.ol_avg_rating is None:
        return None

    g = book.genre

    # 1. Personal genre baseline — anchor at your typical rating for this
    # genre, but soft-mixed with the global mean so high-rating genres
    # (Bio/Memoir 4.58) don't immediately saturate the 5-cap.
    raw_genre_baseline = profile["genre_user_avg"].get(g, GLOBAL_MEAN)
    genre_baseline = 0.7 * raw_genre_baseline + 0.3 * GLOBAL_MEAN

    # 2. Author offset — if you've read this author 3+ times, shift toward how
    # they compare to your typical rating in this genre.
    author_score = profile["author_user_avg"].get(book.author or "")
    if author_score is not None:
        author_offset = BETA * (author_score - raw_genre_baseline)
    else:
        author_offset = 0.0

    # 3. Genre-normalized OL z-score with personal calibration AND Bayesian
    # shrinkage based on ratings_count. Books with only a handful of OL ratings
    # are mostly noise — we shrink their z toward 0 by `confidence = n/(n+30)`.
    ol = book.ol_avg_rating
    n = book.ol_ratings_count or 0
    offset = profile["genre_offset"].get(g, 0.0)
    calibrated_ol = ol + offset
    g_mean = profile["genre_ol_avg"].get(g)
    g_std = profile["genre_ol_stdev"].get(g, 0.5) or 0.5
    if g_mean is not None:
        z_raw = (calibrated_ol - g_mean) / g_std
    else:
        z_raw = (calibrated_ol - GLOBAL_MEAN) / 0.5
    z_raw = max(-3.0, min(3.0, z_raw))  # cap raw z at ±3
    confidence = n / (n + 30)  # 0 ratings → 0; 30 → 0.5; 300 → 0.91
    z = z_raw * confidence
    z_bonus = GAMMA * z

    # 4. Subject-affinity offset — what your average rating is for books
    # tagged with this book's OL subjects. Captures taste signals that genre
    # alone can't (e.g. you love "magical realism" across any genre).
    subj_pred, subj_n = _subject_score(book, profile)
    if subj_pred is not None:
        subject_offset = ZETA * (subj_pred - genre_baseline)
    else:
        subject_offset = 0.0

    # 4b. Collaborative filtering offset — KNN over external user ratings.
    # Only present for books with enough overlap in the public dataset.
    if cf_pred is not None:
        cf_offset = THETA * (cf_pred["prediction"] - genre_baseline)
        cf_neighbors = cf_pred["neighbors_used"]
        cf_value = cf_pred["prediction"]
    else:
        cf_offset = 0.0
        cf_neighbors = 0
        cf_value = None

    # 4c. Text content predictor — TF-IDF similarity over aggregated UCSD review
    # text. Acts like author_offset but works across authors via shared
    # vocabulary (themes, tone, settings). Gated by avg-similarity confidence.
    if text_pred is not None:
        text_offset = ETA * (text_pred["prediction"] - genre_baseline)
        text_neighbors = text_pred["neighbors_used"]
        text_value = text_pred["prediction"]
        text_sim = text_pred["avg_similarity"]
    else:
        text_offset = 0.0
        text_neighbors = 0
        text_value = None
        text_sim = 0.0

    # 5. Popularity penalty — discount above-median ratings counts
    median = profile["median_ratings_count"] or 50
    pop_overshoot = max(0.0, math.log10(max(n, 1) / max(median, 1)))
    pop_pen = DELTA * pop_overshoot

    # 6. Series penalty — sequels suffer selection bias
    series_name, book_num = _series_info(book.title)
    series_pen = 0.0
    if series_name and book_num and book_num >= 2:
        series_pen = EPSILON
        prior_avg = profile["series_avg"].get(series_name)
        if prior_avg is not None and prior_avg < 3.5:
            series_pen = 2 * EPSILON

    raw_score = (
        genre_baseline
        + author_offset
        + z_bonus
        + subject_offset
        + cf_offset
        + text_offset
        - pop_pen
        - series_pen
    )
    score = max(1.0, min(5.0, raw_score))

    return {
        "score": round(score, 2),
        "breakdown": {
            "genre_baseline": round(genre_baseline, 2),
            "author_offset": round(author_offset, 2),
            "ol_z_bonus": round(z_bonus, 2),
            "subject_offset": round(subject_offset, 2),
            "cf_offset": round(cf_offset, 2),
            "text_offset": round(text_offset, 2),
            "popularity_penalty": -round(pop_pen, 2),
            "series_penalty": -round(series_pen, 2),
        },
        "raw": {
            "genre_user_avg": round(genre_baseline, 2),
            "author_user_avg": round(author_score, 2) if author_score is not None else None,
            "ol_z": round(z, 2),
            "ol_calibrated": round(calibrated_ol, 2),
            "subject_pred": round(subj_pred, 2) if subj_pred is not None else None,
            "subject_overlap": subj_n,
            "cf_pred": round(cf_value, 2) if cf_value is not None else None,
            "cf_neighbors": cf_neighbors,
            "text_pred": round(text_value, 2) if text_value is not None else None,
            "text_neighbors": text_neighbors,
            "text_sim": round(text_sim, 3),
            "ratings_count": n,
            "is_sequel": series_pen > 0,
        },
    }


def _reason(book: Book, scoring: dict[str, Any]) -> str:
    """One-line explanation for the predicted score."""
    raw = scoring["raw"]
    parts = []
    if raw["author_user_avg"] is not None:
        parts.append(f"you rate {book.author} {raw['author_user_avg']:.1f}/5 avg")
    if raw["ol_z"] >= 0.7:
        parts.append(f"strong for a {book.genre} book")
    elif raw["ol_z"] <= -0.7:
        parts.append(f"weak for a {book.genre} book")
    parts.append(f"genre baseline {raw['genre_user_avg']:.1f}")
    if raw.get("cf_neighbors", 0) > 0:
        parts.append(f"CF: {raw['cf_neighbors']} similar books in your shelf")
    if raw.get("text_pred") is not None:
        parts.append(f"text-similar reads avg {raw['text_pred']:.1f}")
    if raw["is_sequel"]:
        parts.append("sequel — discounted")
    return " · ".join(parts)


def compute_recommendations(db: Session, *, limit: int = 50) -> list[dict[str, Any]]:
    """Return ranked to-read books with predicted scores and explanations."""
    from cf.predict import load_predictor as load_cf
    from cf.text_features import load_predictor as load_text
    profile = _build_profile(db)
    cf = load_cf(db)
    text = load_text(db)

    to_read = db.query(Book).filter(Book.exclusive_shelf == "to-read").all()

    scored = []
    for b in to_read:
        cf_pred = cf.predict(b.id)
        text_pred = text.predict(b.id) if text is not None else None
        s = _score_book(b, profile, cf_pred=cf_pred, text_pred=text_pred)
        if s is None:
            continue
        scored.append({
            "book": _book_dict(b),
            "score": s["score"],
            "breakdown": s["breakdown"],
            "raw": s["raw"],
            "reason": _reason(b, s),
        })

    scored.sort(key=lambda x: -x["score"])
    return scored[:limit]


def _book_dict(b: Book) -> dict:
    return {
        "id": b.id,
        "goodreads_book_id": b.goodreads_book_id,
        "title": b.title,
        "author": b.author,
        "num_pages": b.num_pages,
        "year_published": b.year_published,
        "original_pub_year": b.original_pub_year,
        "exclusive_shelf": b.exclusive_shelf,
        "genre": b.genre,
        "cover_url": b.cover_url,
        "ol_avg_rating": b.ol_avg_rating,
        "ol_ratings_count": b.ol_ratings_count,
    }
