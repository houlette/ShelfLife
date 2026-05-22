import os
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Book

router = APIRouter(prefix="/api/insights", tags=["insights"])

_cache: dict = {}
_CACHE_TTL = 3600  # 1 hour; busts automatically when book count changes


def _build_context(books: list[Book], period: str) -> str:
    read = [b for b in books if b.exclusive_shelf == "read"]
    if not read:
        return "No books have been read yet."

    total = len(read)
    total_pages = sum(b.num_pages or 0 for b in read)
    authors = len({b.author for b in read if b.author})
    rated = [b for b in read if b.my_rating and b.my_rating > 0]
    avg_rating = sum(b.my_rating for b in rated) / len(rated) if rated else 0

    by_year: dict[int, list[Book]] = defaultdict(list)
    for b in read:
        d = b.date_read or b.date_added
        if d:
            by_year[d.year].append(b)

    year_summary = []
    for y in sorted(by_year.keys()):
        yb = by_year[y]
        yr = [b for b in yb if b.my_rating and b.my_rating > 0]
        yr_avg = sum(b.my_rating for b in yr) / len(yr) if yr else 0
        year_summary.append(f"  {y}: {len(yb)} books, {sum(b.num_pages or 0 for b in yb)} pages, avg rating {yr_avg:.1f}")

    author_counts: dict[str, int] = defaultdict(int)
    for b in read:
        if b.author:
            author_counts[b.author] += 1
    top_authors = sorted(author_counts.items(), key=lambda x: -x[1])[:10]

    recent = sorted(read, key=lambda b: str(b.date_read or b.date_added or ""), reverse=True)[:10]
    recent_lines = []
    for b in recent:
        d = b.date_read or b.date_added
        r = f" ({b.my_rating}★)" if b.my_rating else ""
        recent_lines.append(f"  - {b.title} by {b.author}{r} [{d}]")

    return f"""Reading Library Summary ({period}):
- Total books read: {total}
- Total pages: {total_pages}
- Unique authors: {authors}
- Average rating: {avg_rating:.2f}/5
- Rated books: {len(rated)}/{total}

Books per year:
{chr(10).join(year_summary)}

Top authors:
{chr(10).join(f'  {a}: {c} books' for a, c in top_authors)}

Recent reads:
{chr(10).join(recent_lines)}"""


@router.get("/summary")
def get_summary(period: str = Query("recent"), db: Session = Depends(get_db)):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {"summary": "Set ANTHROPIC_API_KEY in .env to enable AI-powered insights."}

    books = db.query(Book).all()
    if not books:
        return {"summary": "No data yet. Import your Goodreads library to get started."}

    # Cache key includes book count so the cache busts automatically after imports.
    cache_key = (period, len(books))
    cached = _cache.get(cache_key)
    if cached and cached["expires_at"] > time.monotonic():
        return cached["result"]

    context = _build_context(books, period)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1500,
            system="You are a personal reading analyst. Analyze the user's Goodreads library data and provide thoughtful insights about their reading patterns, preferences, and trends. Be specific and reference actual books and data points. Keep your response concise and engaging.",
            messages=[{"role": "user", "content": f"Analyze my reading library and share interesting patterns and insights:\n\n{context}"}],
        )
        result = {"summary": msg.content[0].text}
        _cache[cache_key] = {"result": result, "expires_at": time.monotonic() + _CACHE_TTL}
        return result
    except Exception as e:
        return {"summary": f"Error generating insights: {e}"}
