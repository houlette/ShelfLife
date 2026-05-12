"""Resolves an adapter's external book identifier to our local Book.id."""
from typing import Iterable

from sqlalchemy.orm import Session

from db.models import Book
from .adapters.base import RatingRow


class Resolver:
    def __init__(self, db: Session):
        self.by_goodreads = {b.goodreads_book_id: b.id for b in db.query(Book).all()
                             if b.goodreads_book_id}
        self.by_isbn13 = {b.isbn13: b.id for b in db.query(Book).all() if b.isbn13}
        self.by_isbn10 = {b.isbn: b.id for b in db.query(Book).all() if b.isbn}

    def resolve(self, row: RatingRow) -> int | None:
        kind = row.book_lookup_kind
        val = row.book_lookup_value
        if kind == "goodreads_id" and isinstance(val, str):
            try:
                return self.by_goodreads.get(int(val))
            except ValueError:
                return None
        if kind == "isbn13" and isinstance(val, str):
            return self.by_isbn13.get(val)
        if kind == "isbn10" and isinstance(val, str):
            return self.by_isbn10.get(val)
        # title_author: not implemented yet (no fuzzy matching for v1)
        return None

    def resolve_all(self, rows: Iterable[RatingRow]) -> Iterable[tuple[int, RatingRow]]:
        for r in rows:
            book_id = self.resolve(r)
            if book_id is not None:
                yield book_id, r
