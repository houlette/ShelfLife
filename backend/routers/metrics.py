from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Book, SeriesCatalog
from recommend import compute_recommendations

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/recommendations")
def get_recommendations(limit: int = 50, db: Session = Depends(get_db)):
    return compute_recommendations(db, limit=limit)


@router.get("/books")
def get_books(
    shelf: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Book).order_by(Book.date_read.desc().nullslast(), Book.date_added.desc().nullslast())
    if shelf:
        q = q.filter(Book.exclusive_shelf == shelf)
    rows = q.all()
    return [_book_dict(r) for r in rows]


@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    read_books = db.query(Book).filter(Book.exclusive_shelf == "read").all()

    total_pages = sum(b.num_pages or 0 for b in read_books)
    unique_authors = len({b.author for b in read_books if b.author})
    rated = [b for b in read_books if b.my_rating and b.my_rating > 0]
    avg_rating = sum(b.my_rating for b in rated) / len(rated) if rated else None

    books_by_year: dict[int, int] = defaultdict(int)
    for b in read_books:
        d = b.date_read or b.date_added
        if d:
            books_by_year[d.year] += 1

    streak = _reading_streak(read_books)

    return {
        "total_books": len(read_books),
        "total_pages": total_pages,
        "unique_authors": unique_authors,
        "avg_rating": round(avg_rating, 2) if avg_rating else None,
        "books_by_year": dict(sorted(books_by_year.items())),
        "current_streak": streak["current"],
        "best_streak": streak["best"],
    }


@router.get("/authors")
def get_authors(db: Session = Depends(get_db)):
    books = db.query(Book).filter(Book.exclusive_shelf == "read").all()

    by_author: dict[str, list[Book]] = defaultdict(list)
    for b in books:
        if b.author:
            by_author[b.author].append(b)

    result = []
    for author, author_books in by_author.items():
        rated = [b.my_rating for b in author_books if b.my_rating and b.my_rating > 0]
        result.append({
            "author": author,
            "books_count": len(author_books),
            "avg_rating": round(sum(rated) / len(rated), 2) if rated else None,
            "total_pages": sum(b.num_pages or 0 for b in author_books),
        })

    result.sort(key=lambda x: x["books_count"], reverse=True)
    return result


@router.get("/shelves")
def get_shelves(db: Session = Depends(get_db)):
    books = db.query(Book).all()

    exclusive: dict[str, int] = defaultdict(int)
    custom: dict[str, int] = defaultdict(int)

    for b in books:
        if b.exclusive_shelf:
            exclusive[b.exclusive_shelf] += 1
        if b.bookshelves:
            for shelf in b.bookshelves.split(","):
                s = shelf.strip()
                if s:
                    custom[s] += 1

    return {
        "exclusive": [{"shelf": k, "count": v} for k, v in sorted(exclusive.items(), key=lambda x: -x[1])],
        "custom": [{"shelf": k, "count": v} for k, v in sorted(custom.items(), key=lambda x: -x[1])],
    }


@router.get("/rating-distribution")
def get_rating_distribution(db: Session = Depends(get_db)):
    books = db.query(Book).filter(
        Book.exclusive_shelf == "read",
        Book.my_rating != None,
        Book.my_rating > 0,
    ).all()

    buckets: dict[int, dict] = {}
    for rating in range(1, 6):
        matching = [b for b in books if b.my_rating == rating]
        avg_gr = None
        if matching:
            avgs = [b.average_rating for b in matching if b.average_rating]
            avg_gr = round(sum(avgs) / len(avgs), 2) if avgs else None
        buckets[rating] = {
            "rating": rating,
            "count": len(matching),
            "avg_goodreads_rating": avg_gr,
        }

    return [buckets[r] for r in range(1, 6)]


def _reading_streak(books: list[Book]) -> dict:
    months_with_books: set[tuple[int, int]] = set()
    for b in books:
        d = b.date_read or b.date_added
        if d:
            months_with_books.add((d.year, d.month))

    if not months_with_books:
        return {"current": 0, "best": 0}

    sorted_months = sorted(months_with_books)

    best = 1
    current_run = 1
    for i in range(1, len(sorted_months)):
        prev_y, prev_m = sorted_months[i - 1]
        cur_y, cur_m = sorted_months[i]
        expected_m = prev_m + 1
        expected_y = prev_y
        if expected_m > 12:
            expected_m = 1
            expected_y += 1
        if cur_y == expected_y and cur_m == expected_m:
            current_run += 1
            best = max(best, current_run)
        else:
            current_run = 1

    now = date.today()
    last = sorted_months[-1]
    if last == (now.year, now.month) or (
        last[1] == now.month - 1 and last[0] == now.year
    ) or (now.month == 1 and last == (now.year - 1, 12)):
        current_streak = current_run
    else:
        current_streak = 0

    return {"current": current_streak, "best": best}


def _book_dict(b: Book) -> dict:
    return {
        "id": b.id,
        "goodreads_book_id": b.goodreads_book_id,
        "title": b.title,
        "author": b.author,
        "author_lf": b.author_lf,
        "additional_authors": b.additional_authors,
        "isbn": b.isbn,
        "isbn13": b.isbn13,
        "my_rating": b.my_rating,
        "average_rating": b.average_rating,
        "publisher": b.publisher,
        "binding": b.binding,
        "num_pages": b.num_pages,
        "year_published": b.year_published,
        "original_pub_year": b.original_pub_year,
        "date_read": str(b.date_read) if b.date_read else None,
        "date_added": str(b.date_added) if b.date_added else None,
        "exclusive_shelf": b.exclusive_shelf,
        "bookshelves": [s.strip() for s in b.bookshelves.split(",") if s.strip()] if b.bookshelves else [],
        "my_review": b.my_review,
        "read_count": b.read_count,
        "cover_url": b.cover_url,
        "genre": b.genre,
        "ol_avg_rating": b.ol_avg_rating,
        "ol_ratings_count": b.ol_ratings_count,
        "year_acquired": b.year_acquired,
        "author_gender": b.author_gender,
        "author_ethnicity": b.author_ethnicity,
        "series_name": b.series_name,
        "series_position": b.series_position,
    }


@router.get("/series")
def get_series(db: Session = Depends(get_db)):
    """Return all series merged with the OL catalog; infer gaps when no catalog."""
    owned_books = (
        db.query(Book)
        .filter(Book.series_name.isnot(None))
        .all()
    )

    by_key: dict[str, list[Book]] = defaultdict(list)
    for b in owned_books:
        by_key[b.series_name.lower()].append(b)

    keys = list(by_key.keys())
    catalog_rows = (
        db.query(SeriesCatalog)
        .filter(SeriesCatalog.series_key.in_(keys))
        .all()
    ) if keys else []

    by_catalog: dict[str, list[SeriesCatalog]] = defaultdict(list)
    for row in catalog_rows:
        by_catalog[row.series_key].append(row)

    result = []
    for key, books in by_key.items():
        display_name = books[0].series_name
        author = next((b.author for b in books if b.author), None)

        owned_map: dict[int, Book] = {}
        for b in books:
            if b.series_position:
                owned_map[b.series_position] = b

        catalog = by_catalog.get(key, [])
        catalog_map: dict[int, SeriesCatalog] = {r.position: r for r in catalog if r.position}
        catalog_fetched = bool(catalog)

        # All known positions from owned books and catalog
        all_positions: set[int] = set(owned_map.keys()) | set(catalog_map.keys())

        # Fill gaps within the min–max range so missing books are shown
        if all_positions:
            all_positions = set(range(min(all_positions), max(all_positions) + 1))

        entries = []
        for pos in sorted(all_positions):
            owned_book = owned_map.get(pos)
            catalog_row = catalog_map.get(pos)
            entries.append({
                "position":  pos,
                "title":     (owned_book.title if owned_book else None) or (catalog_row.title if catalog_row else None),
                "shelf":     owned_book.exclusive_shelf if owned_book else None,
                "cover_url": (owned_book.cover_url if owned_book else None) or (catalog_row.cover_url if catalog_row else None),
                "book_id":   owned_book.id if owned_book else None,
                "owned":     owned_book is not None,
            })

        result.append({
            "name":            display_name,
            "key":             key,
            "author":          author,
            "catalog_fetched": catalog_fetched,
            "entries":         entries,
        })

    result.sort(key=lambda x: x["name"].lower())
    return result


@router.get("/genres")
def get_genres(db: Session = Depends(get_db)):
    books = db.query(Book).filter(Book.exclusive_shelf == "read").all()
    counts: dict[str, dict] = {}
    for b in books:
        g = b.genre or "Unclassified"
        if g not in counts:
            counts[g] = {"genre": g, "count": 0, "ratings": [], "pages": 0}
        counts[g]["count"] += 1
        counts[g]["pages"] += b.num_pages or 0
        if b.my_rating and b.my_rating > 0:
            counts[g]["ratings"].append(b.my_rating)
    result = []
    for g in counts.values():
        rs = g.pop("ratings")
        g["avg_rating"] = round(sum(rs) / len(rs), 2) if rs else None
        result.append(g)
    result.sort(key=lambda x: -x["count"])
    return result
