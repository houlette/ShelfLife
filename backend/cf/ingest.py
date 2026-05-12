"""Ingest external rating datasets into the ExternalRating table."""
from typing import Any

from sqlalchemy.orm import Session
from sqlalchemy import delete

from db.models import ExternalRating
from .adapters.base import Adapter
from .resolver import Resolver

BATCH_SIZE = 5000


def ingest(db: Session, adapter: Adapter, replace: bool = True) -> dict[str, Any]:
    """Run an adapter, resolve book IDs, store normalized ratings.
    If replace=True, deletes existing rows for this source first."""
    if replace:
        db.execute(delete(ExternalRating).where(ExternalRating.source == adapter.meta.source))
        db.commit()

    resolver = Resolver(db)
    seen_input = 0
    resolved = 0
    batch: list[dict] = []

    for row in adapter.rows():
        seen_input += 1
        book_id = resolver.resolve(row)
        if book_id is None:
            continue
        batch.append({
            "source": adapter.meta.source,
            "ext_user_id": row.ext_user_id,
            "book_id": book_id,
            "rating": adapter.normalize(row.rating_raw),
        })
        resolved += 1
        if len(batch) >= BATCH_SIZE:
            db.bulk_insert_mappings(ExternalRating, batch)
            db.commit()
            batch.clear()

    if batch:
        db.bulk_insert_mappings(ExternalRating, batch)
        db.commit()

    distinct_books = db.query(ExternalRating.book_id).filter(
        ExternalRating.source == adapter.meta.source
    ).distinct().count()

    return {
        "source": adapter.meta.source,
        "input_rows": seen_input,
        "resolved_rows": resolved,
        "distinct_books_in_library": distinct_books,
    }
