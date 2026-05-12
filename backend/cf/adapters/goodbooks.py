"""Goodbooks-10k adapter.

Source: https://github.com/zygmuntz/goodbooks-10k
Format:
  books.csv:   book_id, goodreads_book_id, isbn, isbn13, authors, title, ...
  ratings.csv: user_id, book_id, rating  (rating: 1-5)

Ratings reference book_id (Goodbooks-internal); we map book_id → goodreads_book_id
via books.csv so the resolver can join on our Book.goodreads_book_id column.
"""
import csv
from pathlib import Path
from typing import Iterable

from .base import Adapter, AdapterMeta, RatingRow


class GoodbooksAdapter(Adapter):
    meta = AdapterMeta(source="goodbooks-10k", rating_min=1.0, rating_max=5.0)

    def __init__(self, data_dir: Path):
        self.books_path = data_dir / "books.csv"
        self.ratings_path = data_dir / "ratings.csv"

    def _book_id_to_goodreads_id(self) -> dict[int, int]:
        out: dict[int, int] = {}
        with self.books_path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    out[int(row["book_id"])] = int(row["goodreads_book_id"])
                except (ValueError, KeyError):
                    continue
        return out

    def rows(self) -> Iterable[RatingRow]:
        mapping = self._book_id_to_goodreads_id()
        with self.ratings_path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    book_id = int(row["book_id"])
                    user_id = int(row["user_id"])
                    rating = float(row["rating"])
                except (ValueError, KeyError):
                    continue
                gr_id = mapping.get(book_id)
                if gr_id is None:
                    continue
                yield RatingRow(
                    ext_user_id=user_id,
                    book_lookup_kind="goodreads_id",
                    book_lookup_value=str(gr_id),
                    rating_raw=rating,
                )
