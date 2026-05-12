"""Thin wrapper around the Open Library Search API for discovery queries."""
import requests

OL_SEARCH = "https://openlibrary.org/search.json"
FIELDS = "key,title,author_name,ratings_average,ratings_count,subject,cover_i,first_publish_year"
COVER_BASE = "https://covers.openlibrary.org/b/id"


def _search(params: dict, limit: int = 10) -> list[dict]:
    try:
        r = requests.get(
            OL_SEARCH,
            params={"limit": limit, "fields": FIELDS, **params},
            timeout=12,
        )
        r.raise_for_status()
        return r.json().get("docs", [])
    except Exception:
        return []


def doc_to_seed(doc: dict) -> dict:
    """Normalize a raw OL search doc into a uniform seed dict."""
    authors = doc.get("author_name") or []
    cover_i = doc.get("cover_i")
    return {
        "ol_work_key": doc.get("key"),          # e.g. "/works/OL12345W"
        "title": doc.get("title", "").strip(),
        "author": authors[0] if authors else None,
        "cover_url": f"{COVER_BASE}/{cover_i}-M.jpg" if cover_i else None,
        "ol_avg_rating": float(doc["ratings_average"]) if doc.get("ratings_average") else None,
        "ol_ratings_count": int(doc["ratings_count"]) if doc.get("ratings_count") else None,
        "subjects": doc.get("subject") or [],
        "original_pub_year": doc.get("first_publish_year"),
    }


def by_author(author_name: str, limit: int = 12) -> list[dict]:
    """Return OL search docs for works by this author, sorted by rating."""
    docs = _search({"author": author_name, "sort": "rating"}, limit=limit)
    return [doc_to_seed(d) for d in docs if d.get("key")]


def by_subject(subject: str, limit: int = 20) -> list[dict]:
    """Return OL search docs for works with this subject, sorted by rating."""
    docs = _search({"subject": subject, "sort": "rating"}, limit=limit)
    return [doc_to_seed(d) for d in docs if d.get("key")]
