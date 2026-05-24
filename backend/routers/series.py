from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from db.database import get_db
from db.models import SeriesCatalog, User

router = APIRouter(prefix="/api/series", tags=["series"])


class EntryCreate(BaseModel):
    position: int
    title: str


class EntryUpdate(BaseModel):
    position: int | None = None
    title: str | None = None


def _mark_curated(db: Session, key: str) -> None:
    db.query(SeriesCatalog).filter(SeriesCatalog.series_key == key).update(
        {"manually_curated": True}, synchronize_session=False
    )


def _ensure_sentinel(db: Session, key: str) -> None:
    """If no rows remain for a series, insert a curated sentinel so the lock persists."""
    count = db.query(SeriesCatalog).filter(SeriesCatalog.series_key == key).count()
    if count == 0:
        db.add(SeriesCatalog(
            series_key=key,
            display_name=key,
            manually_curated=True,
            fetched_at=datetime.utcnow(),
        ))


@router.delete("/{key}/entries/{position}", status_code=204)
def delete_entry(
    key: str,
    position: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    row = (
        db.query(SeriesCatalog)
        .filter(SeriesCatalog.series_key == key, SeriesCatalog.position == position)
        .first()
    )
    if not row:
        raise HTTPException(404, "Catalog entry not found")
    db.delete(row)
    db.flush()
    _mark_curated(db, key)
    _ensure_sentinel(db, key)
    db.commit()


@router.patch("/{key}/entries/{position}")
def update_entry(
    key: str,
    position: int,
    body: EntryUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    row = (
        db.query(SeriesCatalog)
        .filter(SeriesCatalog.series_key == key, SeriesCatalog.position == position)
        .first()
    )
    if not row:
        raise HTTPException(404, "Catalog entry not found")
    if body.title is not None:
        row.title = body.title
    if body.position is not None and body.position != position:
        conflict = (
            db.query(SeriesCatalog)
            .filter(SeriesCatalog.series_key == key, SeriesCatalog.position == body.position)
            .first()
        )
        if conflict:
            raise HTTPException(409, "A catalog entry already exists at that position")
        row.position = body.position
    row.manually_curated = True
    db.commit()
    return {"ok": True}


@router.post("/{key}/entries")
def add_entry(
    key: str,
    body: EntryCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    conflict = (
        db.query(SeriesCatalog)
        .filter(SeriesCatalog.series_key == key, SeriesCatalog.position == body.position)
        .first()
    )
    if conflict:
        raise HTTPException(409, "A catalog entry already exists at that position")
    # Use display_name from existing rows if present
    existing = db.query(SeriesCatalog).filter(SeriesCatalog.series_key == key).first()
    display_name = existing.display_name if existing else key
    db.add(SeriesCatalog(
        series_key=key,
        display_name=display_name,
        position=body.position,
        title=body.title,
        manually_curated=True,
        fetched_at=datetime.utcnow(),
    ))
    _mark_curated(db, key)
    db.commit()
    return {"ok": True}


@router.post("/{key}/unlock", status_code=204)
def unlock_series(
    key: str,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Clear curated flag and remove sentinel so the next enrich re-fetches from OL."""
    # Delete sentinel rows (position is NULL) and clear flag on real rows
    db.query(SeriesCatalog).filter(
        SeriesCatalog.series_key == key, SeriesCatalog.position.is_(None)
    ).delete(synchronize_session=False)
    db.query(SeriesCatalog).filter(SeriesCatalog.series_key == key).update(
        {"manually_curated": False}, synchronize_session=False
    )
    db.commit()
