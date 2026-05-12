"""UCSD Goodreads adapter (Wan & McAuley, RecSys 2018).

Source: https://mcauleylab.ucsd.edu/public_datasets/gdrive/goodreads/
Files needed:
  goodreads_interactions.csv  (~4.3GB)  user_id, book_id, is_read, rating, is_reviewed
  book_id_map.csv             (~37MB)   book_id_csv, book_id  (internal_id → goodreads_id)

The `book_id` in interactions.csv is the dataset's INTERNAL id; we map it to the
Goodreads book_id via book_id_map.csv so the resolver can join on our
Book.goodreads_book_id column.

Filters out is_read=0 (added but not read) and rating=0 (no rating given).
The is_reviewed=1 flag is preserved in metadata for a future phase that joins
to the reviews dataset.
"""
import csv
from pathlib import Path
from typing import Iterable

from .base import Adapter, AdapterMeta, RatingRow


class UCSDGoodreadsAdapter(Adapter):
    meta = AdapterMeta(source="ucsd-goodreads", rating_min=1.0, rating_max=5.0)

    def __init__(self, data_dir: Path):
        self.interactions_path = data_dir / "goodreads_interactions.csv"
        self.book_id_map_path = data_dir / "book_id_map.csv"

    def _internal_to_goodreads_id(self) -> dict[int, int]:
        out: dict[int, int] = {}
        with self.book_id_map_path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    out[int(row["book_id_csv"])] = int(row["book_id"])
                except (ValueError, KeyError):
                    continue
        return out

    def rows(self) -> Iterable[RatingRow]:
        id_map = self._internal_to_goodreads_id()
        with self.interactions_path.open(encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    rating = int(row["rating"])
                    if rating <= 0:
                        continue  # skip unrated interactions
                    internal_id = int(row["book_id"])
                    user_id = int(row["user_id"])
                except (ValueError, KeyError):
                    continue
                gr_id = id_map.get(internal_id)
                if gr_id is None:
                    continue
                yield RatingRow(
                    ext_user_id=user_id,
                    book_lookup_kind="goodreads_id",
                    book_lookup_value=str(gr_id),
                    rating_raw=float(rating),
                )
