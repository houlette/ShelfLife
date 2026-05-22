"""Author demographics enrichment.

Gender
------
Primary:  Wikidata P21 — authoritative (supports non-binary, handles ambiguous
          first names like "Toni" or "Robin").
Fallback: gender_guesser — offline first-name database, covers the ~40% of
          authors Wikidata doesn't have entries for.

Geographic / Cultural Origin
-----------------------------
Primary:  Wikipedia article categories — far more populated than Wikidata
          P172.  Categories like "African-American writers", "Black British
          writers", "American poets of Asian descent" are mapped to broad
          groups.  Jewish writers get their own "Jewish" bucket rather than
          being folded into "Middle Eastern."
          Two API calls per author: OpenSearch (find page title) +
          query&prop=categories (fetch category list).

Fallback: Wikidata P27 (country of citizenship) — covers authors from
          non-Western countries who may not be explicitly categorised on
          Wikipedia (e.g. a Nigerian novelist whose page only says
          "Nigerian writers").  US/UK/Canada/Australia/Western Europe are
          intentionally excluded: nationality alone doesn't distinguish
          origin for white Western authors, and Wikipedia categories already
          handle diaspora writers from those countries.

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


def _wd_claims(qid: str) -> dict:
    """Fetch all claims for a Wikidata entity (shared helper)."""
    data = _get(_WD, {"action": "wbgetentities", "ids": qid, "props": "claims"})
    return data.get("entities", {}).get(qid, {}).get("claims", {})


def _wd_gender(claims: dict) -> str | None:
    """Extract P21 (sex/gender) from pre-fetched claims."""
    try:
        for claim in claims.get("P21", []):
            v = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
            qv = v.get("id") if isinstance(v, dict) else None
            if qv in _WD_GENDER:
                return _WD_GENDER[qv]
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Geographic / Cultural Origin — Wikidata P27 country → origin group
# ---------------------------------------------------------------------------

# Country QIDs that map to a non-white-Western origin group.
# US (Q30), UK (Q145), Canada (Q16), Australia (Q408), NZ (Q664) and
# Western European nations are intentionally absent: nationality there
# does not distinguish origin for white authors, and Wikipedia article
# categories already handle diaspora writers from those countries.
_COUNTRY_ORIGIN: dict[str, str] = {
    # ── Black / African ──────────────────────────────────────────────────
    "Q1033": "Black / African",   # Nigeria
    "Q117":  "Black / African",   # Ghana
    "Q114":  "Black / African",   # Kenya
    "Q258":  "Black / African",   # South Africa
    "Q954":  "Black / African",   # Zimbabwe
    "Q924":  "Black / African",   # Tanzania
    "Q1036": "Black / African",   # Uganda
    "Q115":  "Black / African",   # Ethiopia
    "Q766":  "Black / African",   # Jamaica
    "Q790":  "Black / African",   # Haiti
    "Q754":  "Black / African",   # Trinidad and Tobago
    "Q244":  "Black / African",   # Barbados
    "Q1009": "Black / African",   # Cameroon
    "Q1041": "Black / African",   # Senegal
    "Q1008": "Black / African",   # Ivory Coast
    "Q912":  "Black / African",   # Mali
    "Q1037": "Black / African",   # Rwanda
    "Q953":  "Black / African",   # Zambia
    "Q1020": "Black / African",   # Malawi
    "Q1029": "Black / African",   # Mozambique
    "Q963":  "Black / African",   # Botswana
    "Q1030": "Black / African",   # Namibia
    "Q1045": "Black / African",   # Somalia
    "Q1049": "Black / African",   # Sudan
    "Q974":  "Black / African",   # DR Congo
    "Q971":  "Black / African",   # Republic of Congo
    "Q916":  "Black / African",   # Angola
    "Q965":  "Black / African",   # Burkina Faso
    "Q1006": "Black / African",   # Guinea
    # ── Asian ────────────────────────────────────────────────────────────
    "Q148":  "Asian",             # China
    "Q17":   "Asian",             # Japan
    "Q884":  "Asian",             # South Korea
    "Q668":  "Asian",             # India
    "Q843":  "Asian",             # Pakistan
    "Q902":  "Asian",             # Bangladesh
    "Q881":  "Asian",             # Vietnam
    "Q928":  "Asian",             # Philippines
    "Q869":  "Asian",             # Thailand
    "Q854":  "Asian",             # Sri Lanka
    "Q865":  "Asian",             # Taiwan
    "Q334":  "Asian",             # Singapore
    "Q252":  "Asian",             # Indonesia
    "Q833":  "Asian",             # Malaysia
    "Q836":  "Asian",             # Myanmar
    "Q424":  "Asian",             # Cambodia
    "Q819":  "Asian",             # Laos
    "Q837":  "Asian",             # Nepal
    "Q711":  "Asian",             # Mongolia
    # ── Hispanic / Latino ────────────────────────────────────────────────
    "Q96":   "Hispanic / Latino", # Mexico
    "Q155":  "Hispanic / Latino", # Brazil
    "Q739":  "Hispanic / Latino", # Colombia
    "Q414":  "Hispanic / Latino", # Argentina
    "Q419":  "Hispanic / Latino", # Peru
    "Q298":  "Hispanic / Latino", # Chile
    "Q717":  "Hispanic / Latino", # Venezuela
    "Q736":  "Hispanic / Latino", # Ecuador
    "Q241":  "Hispanic / Latino", # Cuba
    "Q786":  "Hispanic / Latino", # Dominican Republic
    "Q750":  "Hispanic / Latino", # Bolivia
    "Q77":   "Hispanic / Latino", # Uruguay
    "Q733":  "Hispanic / Latino", # Paraguay
    "Q774":  "Hispanic / Latino", # Guatemala
    "Q783":  "Hispanic / Latino", # Honduras
    "Q792":  "Hispanic / Latino", # El Salvador
    "Q811":  "Hispanic / Latino", # Nicaragua
    "Q800":  "Hispanic / Latino", # Costa Rica
    "Q804":  "Hispanic / Latino", # Panama
    # ── Middle Eastern ───────────────────────────────────────────────────
    "Q794":  "Middle Eastern",    # Iran
    "Q796":  "Middle Eastern",    # Iraq
    "Q851":  "Middle Eastern",    # Saudi Arabia
    "Q822":  "Middle Eastern",    # Lebanon
    "Q79":   "Middle Eastern",    # Egypt
    "Q858":  "Middle Eastern",    # Syria
    "Q810":  "Middle Eastern",    # Jordan
    "Q801":  "Middle Eastern",    # Israel
    "Q43":   "Middle Eastern",    # Turkey
    "Q889":  "Middle Eastern",    # Afghanistan
    "Q1028": "Middle Eastern",    # Morocco
    "Q262":  "Middle Eastern",    # Algeria
    "Q948":  "Middle Eastern",    # Tunisia
    "Q1016": "Middle Eastern",    # Libya
    "Q805":  "Middle Eastern",    # Yemen
    "Q23792":"Middle Eastern",    # Palestine
    "Q399":  "Middle Eastern",    # Armenia
    "Q227":  "Middle Eastern",    # Azerbaijan
    "Q817":  "Middle Eastern",    # Kuwait
    "Q878":  "Middle Eastern",    # UAE
    "Q846":  "Middle Eastern",    # Qatar
    "Q398":  "Middle Eastern",    # Bahrain
    "Q842":  "Middle Eastern",    # Oman
}


def _wd_nationality(claims: dict) -> str | None:
    """Extract P27 (country of citizenship) from pre-fetched claims and map to
    a cultural/geographic origin group.  Returns None for countries not in
    _COUNTRY_ORIGIN (i.e. US, UK, Western Europe)."""
    try:
        for claim in claims.get("P27", []):
            v = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
            country_qid = v.get("id") if isinstance(v, dict) else None
            if country_qid and country_qid in _COUNTRY_ORIGIN:
                return _COUNTRY_ORIGIN[country_qid]
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
        try:
            claims = _wd_claims(qid)
            gender = _wd_gender(claims)
        except Exception:
            gender = None
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
    """Map Wikipedia article categories to a broad cultural/geographic origin group."""
    text = " ".join(cats).lower()

    # ---- Jewish (checked before Middle Eastern to avoid misclassification) --
    # Jewish American/British authors dominate Wikipedia's "Jewish" categories;
    # keeping them separate from Middle Eastern is more accurate.
    if any(x in text for x in [
        "jewish american", "jewish-american",
        "jewish british", "jewish-british",
        "jewish canadian", "jewish australian",
        "of jewish descent",
        "american jewish writer", "american jewish novelist",
        "british jewish writer", "british jewish novelist",
        "jewish writer", "jewish novelist", "jewish poet",
    ]):
        return "Jewish"

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
    # Note: Jewish writers are handled above; "of jewish descent" is NOT here.
    if any(x in text for x in [
        "arab american", "iranian american", "turkish american",
        "lebanese american", "egyptian american",
        "of arab descent", "of iranian descent",
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
    """Return broad cultural/geographic origin group for an author.

    Primary:  Wikipedia article categories.
    (No P27 fallback here — use enrich_author() for the full pipeline.)
    """
    cats = _wp_categories(author)
    return _ethnicity_from_categories(cats) if cats else None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def enrich_author(author_name: str) -> dict:
    """Return {"gender": str | None, "ethnicity": str | None} for one author.

    Fetches the Wikidata QID once and reuses it across three lookups:
      1. P21 (sex/gender) — primary gender source
      2. Wikipedia categories — primary origin source
      3. P27 (country of citizenship) — fallback origin for non-Western authors
    """
    # ── Step 1: single QID lookup ──────────────────────────────────────
    qid = _wd_qid(author_name)
    claims: dict = {}
    if qid:
        time.sleep(0.5)   # respect ≤200 req/min Wikimedia limit
        try:
            claims = _wd_claims(qid)
        except Exception:
            claims = {}

    # ── Step 2: gender ─────────────────────────────────────────────────
    gender = _wd_gender(claims) if claims else None
    if not gender:
        gender = _gender_from_name(author_name)

    # ── Step 3: origin — Wikipedia categories first ────────────────────
    time.sleep(0.5)
    cats = _wp_categories(author_name)
    ethnicity = _ethnicity_from_categories(cats) if cats else None

    # ── Step 4: P27 nationality fallback (non-Western countries only) ──
    if not ethnicity and claims:
        time.sleep(0.3)
        ethnicity = _wd_nationality(claims)

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
                # Never overwrite a value the user set manually
                if book.author_diversity_manual:
                    continue
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
