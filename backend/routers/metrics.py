from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_current_user
from db.database import get_db
from db.models import Book, SeriesCatalog, User, UserBook

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


def _user_books(db: Session, user_id: int) -> list[Book]:
    """Return merged UserBook+Book objects for a user as simple Book-like wrappers."""
    pairs = (
        db.query(UserBook, Book)
        .join(Book, UserBook.book_id == Book.id)
        .filter(UserBook.user_id == user_id)
        .all()
    )
    return [_merged(ub, b) for ub, b in pairs]


class _Merged:
    """Combines UserBook user fields with Book catalog fields into one object."""
    __slots__ = (
        "id", "goodreads_book_id", "title", "author", "author_lf", "additional_authors",
        "isbn", "isbn13", "my_rating", "average_rating", "publisher", "binding",
        "num_pages", "year_published", "original_pub_year", "date_read", "date_added",
        "exclusive_shelf", "bookshelves", "my_review", "read_count", "cover_url",
        "genre", "subjects_json", "ol_avg_rating", "ol_ratings_count", "ol_work_key",
        "enriched_at", "author_gender", "author_ethnicity", "author_diversity_manual",
        "diversity_enriched_at", "series_name", "series_position", "year_acquired",
    )

    def __init__(self, ub: UserBook, b: Book):
        # UserBook (per-user)
        self.exclusive_shelf = ub.exclusive_shelf
        self.my_rating = ub.my_rating
        self.date_read = ub.date_read
        self.date_added = ub.date_added
        self.my_review = ub.my_review
        self.bookshelves = ub.bookshelves
        self.read_count = ub.read_count
        self.year_acquired = ub.year_acquired
        # Book (shared catalog)
        self.id = b.id
        self.goodreads_book_id = b.goodreads_book_id
        self.title = b.title
        self.author = b.author
        self.author_lf = b.author_lf
        self.additional_authors = b.additional_authors
        self.isbn = b.isbn
        self.isbn13 = b.isbn13
        self.average_rating = b.average_rating
        self.publisher = b.publisher
        self.binding = b.binding
        self.num_pages = b.num_pages
        self.year_published = b.year_published
        self.original_pub_year = b.original_pub_year
        self.cover_url = b.cover_url
        self.genre = b.genre
        self.subjects_json = b.subjects_json
        self.ol_avg_rating = b.ol_avg_rating
        self.ol_ratings_count = b.ol_ratings_count
        self.ol_work_key = b.ol_work_key
        self.enriched_at = b.enriched_at
        self.author_gender = b.author_gender
        self.author_ethnicity = b.author_ethnicity
        self.author_diversity_manual = b.author_diversity_manual
        self.diversity_enriched_at = b.diversity_enriched_at
        self.series_name = b.series_name
        self.series_position = b.series_position


def _merged(ub: UserBook, b: Book) -> _Merged:
    return _Merged(ub, b)


@router.get("/recommendations")
def get_recommendations(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from recommend import compute_recommendations
    return compute_recommendations(db, user_id=current_user.id, limit=limit)


@router.get("/books")
def get_books(
    shelf: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = (
        db.query(UserBook, Book)
        .join(Book, UserBook.book_id == Book.id)
        .filter(UserBook.user_id == current_user.id)
        .order_by(UserBook.date_read.desc().nullslast(), UserBook.date_added.desc().nullslast())
    )
    if shelf:
        q = q.filter(UserBook.exclusive_shelf == shelf)
    return [_book_dict(_merged(ub, b)) for ub, b in q.all()]


@router.get("/summary")
def get_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    books = _user_books(db, current_user.id)
    read_books = [b for b in books if b.exclusive_shelf == "read"]

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
def get_authors(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    books = _user_books(db, current_user.id)
    read_books = [b for b in books if b.exclusive_shelf == "read"]

    by_author: dict[str, list] = defaultdict(list)
    for b in read_books:
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
def get_shelves(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    books = _user_books(db, current_user.id)

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
def get_rating_distribution(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    books = _user_books(db, current_user.id)
    read_books = [b for b in books if b.exclusive_shelf == "read" and b.my_rating and b.my_rating > 0]

    buckets: dict[int, dict] = {}
    for rating in range(1, 6):
        matching = [b for b in read_books if b.my_rating == rating]
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


def _reading_streak(books: list) -> dict:
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


def _book_dict(b: _Merged) -> dict:
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
def get_series(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all series merged with the catalog; infer gaps when no catalog."""
    # Only books this user has in their library that belong to a series
    pairs = (
        db.query(UserBook, Book)
        .join(Book, UserBook.book_id == Book.id)
        .filter(UserBook.user_id == current_user.id, Book.series_name.isnot(None))
        .all()
    )

    by_key: dict[str, list[_Merged]] = defaultdict(list)
    for ub, b in pairs:
        m = _merged(ub, b)
        by_key[b.series_name.lower()].append(m)

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

        owned_map: dict[int, _Merged] = {}
        for b in books:
            if b.series_position:
                owned_map[b.series_position] = b

        catalog = by_catalog.get(key, [])
        catalog_map: dict[int, SeriesCatalog] = {r.position: r for r in catalog if r.position}
        catalog_fetched = bool(catalog)

        all_positions: set[int] = set(owned_map.keys()) | set(catalog_map.keys())
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
def get_genres(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    books = _user_books(db, current_user.id)
    read_books = [b for b in books if b.exclusive_shelf == "read"]

    counts: dict[str, dict] = {}
    for b in read_books:
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
