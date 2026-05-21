"""Author demographics enrichment.

Gender
------
Primary:  Wikidata P21 — authoritative (supports non-binary, handles ambiguous
          first names like "Toni" or "Robin").
Fallback: gender_guesser — offline first-name database, covers the ~40% of
          authors Wikidata doesn't have entries for.

Ethnicity / origin
------------------
Primary:  Wikipedia article categories — far more populated than Wikidata
          P172.  Categories like "African-American writers", "Black British
          writers", "American poets of Asian descent" are mapped to broad
          groups.
          Two API calls per author: OpenSearch (find page title) +
          query&prop=categories (fetch category list).

Both sources set `diversity_enriched_at` on every processed book so
re-runs skip already-searched authors regardless of whether data was found.
"""
from __future__ import annotations

import re
import time
from datetime import datetime

import requests
from sqlalchemy.orm import Session

from db.models import Book

# ---------------------------------------------------------------------------
# Shared HTTP helpers
# ---------------------------------------------------------------------------

_WD = "https://www.wikidata.org/w/api.php"
_WP = "https://en.wikipedia.org/w/api.php"

# Wikimedia API rules (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits):
#   • Unauthenticated clients with a compliant User-Agent: 200 req/min
#   • User-Agent must identify the application and include contact information
#   • On 429 the server sets Retry-After; if absent wait ≥ 5 s with backoff
#   • Keep concurrent requests ≤ 3
_UA = {"User-Agent": "ShelfLife/1.0 (personal reading-stats app; https://github.com/local/shelflife)"}


def _get(url: str, params: dict) -> dict:
    """GET with Retry-After-aware retry on 429."""
    for attempt in range(4):
        resp = requests.get(url, params={**params, "format": "json"}, headers=_UA, timeout=12)
        if resp.status_code == 429:
            # Respect the server's Retry-After value; fall back to 5 s min with backoff
            retry_after = resp.headers.get("Retry-After")
            wait = float(retry_after) if retry_after else 5 * (attempt + 1)
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()
    raise requests.HTTPError("Rate limited after retries")


# ---------------------------------------------------------------------------
# Gender — Wikidata P21 (primary) + gender_guesser (fallback)
# ---------------------------------------------------------------------------

# Wikidata QIDs for P21 values
_WD_GENDER: dict[str, str] = {
    "Q6581097": "Man",        # male
    "Q6581072": "Woman",      # female
    "Q1052281": "Woman",      # transgender woman
    "Q2449503": "Man",        # transgender man
    "Q48270":   "Non-binary", # non-binary
    "Q12964198":"Non-binary", # genderqueer
    "Q179294":  "Non-binary", # transgender person
}

_WD_AUTHOR_WORDS = {"author", "writer", "novelist", "poet", "playwright",
                    "journalist", "essayist", "screenwriter", "biographer",
                    "fiction", "memoirist"}
_WD_SKIP_WORDS   = {"fictional", "film", "album", "song", "television series",
                    "city", "municipality", "district", "company", "river",
                    "mountain", "island", "species", "asteroid", "video game",
                    "brand", "magazine"}

# Regex: matches single-letter or multi-initial tokens  — J, J., J.K, J.K., J.R.R
_INITIAL_RE = re.compile(r"^[A-Z]([.][A-Z])*\.?$")


def _wd_qid(name: str) -> str | None:
    """Find the best Wikidata QID for an author name."""
    try:
        data = _get(_WD, {"action": "wbsearchentities", "search": name,
                          "language": "en", "type": "item", "limit": 5})
    except Exception:
        return None
    results = data.get("search", [])
    for r in results:
        desc = (r.get("description") or "").lower()
        if any(w in desc for w in _WD_AUTHOR_WORDS):
            return r["id"]
    for r in results:
        desc = (r.get("description") or "").lower()
        if not any(w in desc for w in _WD_SKIP_WORDS):
            return r["id"]
    return results[0]["id"] if results else None


def _wd_gender(qid: str) -> str | None:
    """Fetch P21 (sex/gender) for a Wikidata entity."""
    try:
        data   = _get(_WD, {"action": "wbgetentities", "ids": qid, "props": "claims"})
        claims = data.get("entities", {}).get(qid, {}).get("claims", {})
        for claim in claims.get("P21", []):
            v = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
            qv = v.get("id") if isinstance(v, dict) else None
            if qv in _WD_GENDER:
                return _WD_GENDER[qv]
    except Exception:
        pass
    return None


def _gender_from_name(author: str) -> str | None:
    """Offline gender guess from first name via gender_guesser."""
    # Find the first token that isn't an initial
    first = None
    for tok in author.split():
        clean = tok.rstrip(".,")
        if _INITIAL_RE.match(clean):
            continue
        if len(clean) > 2:
            first = clean
            break
    if not first:
        return None
    try:
        import gender_guesser.detector as _mod
        result = _mod.Detector().get_gender(first)
        if result in ("male", "mostly_male"):
            return "Man"
        if result in ("female", "mostly_female"):
            return "Woman"
    except Exception:
        pass
    return None


def resolve_gender(author: str) -> str | None:
    """Return gender for an author.

    Wikidata P21 is tried first (accurate, supports non-binary).
    gender_guesser is the fallback for authors not on Wikidata.
    """
    qid = _wd_qid(author)
    if qid:
        time.sleep(0.5)   # Wikidata asks for ≤1 req/s; two calls = 2s per author
        gender = _wd_gender(qid)
        if gender:
            return gender
    return _gender_from_name(author)


# ---------------------------------------------------------------------------
# Ethnicity — Wikipedia article categories (primary)
# ---------------------------------------------------------------------------

def _normalize_name_for_wp(name: str) -> str:
    """Expand dotted initials so Wikipedia search can find them.
    'N.K. Jemisin' → 'N. K. Jemisin', 'J.R.R. Tolkien' → 'J. R. R. Tolkien'
    """
    return re.sub(r"([A-Z])\.([A-Z])", r"\1. \2", name)


def _wp_categories(author: str) -> list[str]:
    """Return Wikipedia article categories for an author (non-hidden only)."""
    try:
        search_name = _normalize_name_for_wp(author)
        search = _get(_WP, {"action": "opensearch", "search": search_name, "limit": 1})
        titles = search[1] if isinstance(search, list) and len(search) > 1 else []
        if not titles:
            return []
        time.sleep(0.2)
        data = _get(_WP, {"action": "query", "titles": titles[0],
                          "prop": "categories", "cllimit": 80, "clshow": "!hidden"})
        cats: list[str] = []
        for page in data.get("query", {}).get("pages", {}).values():
            cats.extend(c["title"].replace("Category:", "")
                        for c in page.get("categories", []))
        return cats
    except Exception:
        return []


def _ethnicity_from_categories(cats: list[str]) -> str | None:
    """Map Wikipedia article categories to a broad ethnicity/origin group."""
    text = " ".join(cats).lower()

    # ---- Black / African -----------------------------------------------
    if any(x in text for x in [
        "african-american", "african american",
        "black american", "black british", "black canadian",
        "black south african", "black australian",
    ]):
        return "Black / African"
    if any(x in text for x in [
        "of jamaican descent", "of caribbean descent",
        "of haitian descent", "of nigerian descent",
        "of ghanaian descent", "of kenyan descent",
        "of ugandan descent", "of ethiopian descent",
        "of zimbabwean descent", "of cameroonian descent",
        "of trinidadian", "of barbadian",
    ]):
        return "Black / African"
    if any(x in text for x in [
        "nigerian writer", "nigerian novelist", "nigerian poet",
        "ghanaian writer", "kenyan writer", "south african writer",
        "south african novelist", "tanzanian writer", "zimbabwean writer",
        "west african writer", "east african writer",
    ]):
        return "Black / African"

    # ---- Asian ---------------------------------------------------------
    if any(x in text for x in [
        "asian american", "asian-american",
        "of asian descent",
        "chinese american", "chinese-american",
        "japanese american", "japanese-american",
        "korean american", "korean-american",
        "indian american", "indian-american",
        "vietnamese american", "vietnamese-american",
        "of vietnamese descent",
        "south asian american", "southeast asian american",
        "of chinese descent", "of japanese descent",
        "of korean descent", "of indian descent",
        "of south asian descent",
    ]):
        return "Asian"
    if any(x in text for x in [
        "chinese writer", "chinese novelist", "chinese poet",
        "japanese writer", "japanese novelist",
        "korean writer", "taiwanese writer",
        "hong kong", "singaporean writer",
        "vietnamese writer",
        "bangladeshi writer", "pakistani writer", "sri lankan writer",
        "indian writer", "indian novelist",
    ]):
        return "Asian"

    # ---- Hispanic / Latino ---------------------------------------------
    if any(x in text for x in [
        "hispanic", "latino", "latina", "chicano", "chicana",
        "mexican american", "cuban american", "puerto rican",
        "of mexican descent", "of cuban descent",
        "colombian writer", "argentinian writer", "peruvian writer",
        "chilean writer", "ecuadorian writer", "venezuelan writer",
        "dominican writer", "uruguayan writer", "bolivian writer",
    ]):
        return "Hispanic / Latino"

    # ---- Middle Eastern ------------------------------------------------
    if any(x in text for x in [
        "arab american", "iranian american", "turkish american",
        "lebanese american", "egyptian american",
        "of arab descent", "of iranian descent",
        "of jewish descent",
        "jewish american", "jewish british", "jewish canadian",
        "jewish australian",
        "arabic writer", "iranian writer", "turkish writer",
        "lebanese writer", "egyptian writer", "afghan writer",
        "armenian writer", "kurdish writer",
        "israeli writer", "persian writer",
    ]):
        return "Middle Eastern"

    # ---- Indigenous ----------------------------------------------------
    if any(x in text for x in [
        "native american", "indigenous", "first nations",
        "aboriginal australian", "aboriginal canadian",
        "māori", "maori", "inuit", "métis", "metis",
        "cherokee", "navajo", "lakota", "ojibwe",
    ]):
        return "Indigenous"

    return None


def resolve_ethnicity(author: str) -> str | None:
    """Return broad ethnicity/origin group for an author via Wikipedia categories."""
    cats = _wp_categories(author)
    return _ethnicity_from_categories(cats) if cats else None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def enrich_author(author_name: str) -> dict:
    """Return {"gender": str | None, "ethnicity": str | None} for one author."""
    gender    = resolve_gender(author_name)
    time.sleep(0.5)
    ethnicity = resolve_ethnicity(author_name)
    return {"gender": gender, "ethnicity": ethnicity}


def enrich_all(
    db: Session,
    limit: int | None = None,
    on_progress: "Callable[[dict], None] | None" = None,
    stop_flag: "list[bool] | None" = None,
) -> dict:
    """Enrich author_gender / author_ethnicity for books not yet attempted.

    Groups by unique author name so each source is queried at most once per
    author.  Sets ``diversity_enriched_at`` on every book for the author after
    each attempt (even when no data is found) so re-runs skip them.

    Args:
        on_progress: Called after each author with the running totals dict.
        stop_flag:   Single-element list; set ``stop_flag[0] = True`` from
                     another thread to abort the loop cleanly.
    """
    from typing import Callable  # local import to avoid circular issues

    unenriched = (
        db.query(Book)
        .filter(Book.author.isnot(None), Book.diversity_enriched_at.is_(None))
        .all()
    )

    by_author: dict[str, list[Book]] = {}
    for book in unenriched:
        if book.author:
            by_author.setdefault(book.author, []).append(book)

    authors = sorted(by_author.keys())
    if limit:
        authors = authors[:limit]

    authors_processed = 0
    authors_enriched  = 0
    books_updated     = 0
    errors            = 0
    now = datetime.utcnow()

    for author in authors:
        if stop_flag and stop_flag[0]:
            break

        books = by_author[author]
        try:
            result = enrich_author(author)
            for book in books:
                book.diversity_enriched_at = now
                if result["gender"]:
                    book.author_gender = result["gender"]
                if result["ethnicity"]:
                    book.author_ethnicity = result["ethnicity"]
            db.commit()
            authors_processed += 1
            if result["gender"] or result["ethnicity"]:
                authors_enriched += 1
                books_updated += len(books)
        except Exception:
            errors += 1
            db.rollback()

        if on_progress:
            on_progress({
                "authors_processed": authors_processed,
                "authors_enriched":  authors_enriched,
                "books_updated":     books_updated,
                "errors":            errors,
            })

        time.sleep(0.5)   # Wikimedia asks for ≤200 req/min; this keeps us well under

    return {
        "authors_processed": authors_processed,
        "authors_enriched":  authors_enriched,
        "books_updated":     books_updated,
        "errors":            errors,
    }
