"""Adapter protocol for collaborative-filtering data sources.

Each adapter yields (ext_user_id, book_lookup_key, rating) tuples plus
metadata about its rating scale. Identity resolution and storage are handled
downstream — adapters only know about their own data format.
"""
from dataclasses import dataclass
from typing import Iterable, Literal


# How the adapter identifies books: by Goodreads ID (numeric), ISBN-13/10,
# or as a (title, author) pair for fuzzy matching.
LookupKind = Literal["goodreads_id", "isbn13", "isbn10", "title_author"]


@dataclass
class RatingRow:
    ext_user_id: int
    book_lookup_kind: LookupKind
    book_lookup_value: str | tuple[str, str]   # str for IDs, (title, author) for fuzzy
    rating_raw: float


@dataclass
class AdapterMeta:
    source: str
    rating_min: float
    rating_max: float


class Adapter:
    """Subclass and implement `meta` and `rows`."""
    meta: AdapterMeta

    def rows(self) -> Iterable[RatingRow]:
        raise NotImplementedError

    def normalize(self, raw: float) -> float:
        """Linear-rescale the raw rating to a 1-5 scale."""
        m = self.meta
        if m.rating_max == m.rating_min:
            return 3.0
        return 1.0 + 4.0 * (raw - m.rating_min) / (m.rating_max - m.rating_min)
