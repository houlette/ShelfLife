from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from db.database import get_db
from db.models import Book, BooklistPending, IngestLog
import ingest.goodreads as goodreads_ingest
import ingest.booklist as booklist_ingest
import ingest.openlibrary as ol

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


def _log(db: Session, source: str, filename: str, result: dict, status: str = "ok"):
    log = IngestLog(
        source=source,
        filename=filename,
        records_inserted=result.get("inserted", 0),
        records_updated=0,
        ingested_at=datetime.utcnow(),
        status=status,
        message=str(result.get("errors", [])) if result.get("errors") else None,
    )
    db.add(log)
    db.commit()


@router.post("/goodreads")
async def upload_goodreads(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(400, "Expected a .csv file")
    content = await file.read()
    try:
        result = goodreads_ingest.ingest_csv(content, db)
        _log(db, "goodreads", file.filename, result)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/booklist")
async def upload_booklist(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(400, "Expected a .csv file")
    content = await file.read()
    try:
        result = booklist_ingest.ingest_csv(content, db)
        _log(db, "booklist", file.filename, result)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/booklist/pending")
def booklist_pending(db: Session = Depends(get_db)):
    """Return unresolved pending entries with candidate book details for disambiguation UI."""
    import json as _json
    entries = db.query(BooklistPending).filter(BooklistPending.status == "pending").all()
    result = []
    for entry in entries:
        candidate_ids: list[int] = _json.loads(entry.candidate_book_ids or "[]")
        candidates = []
        for book in db.query(Book).filter(Book.id.in_(candidate_ids)).all():
            candidates.append({
                "id": book.id,
                "title": book.title,
                "author": book.author,
                "cover_url": book.cover_url,
                "exclusive_shelf": book.exclusive_shelf,
                "original_pub_year": book.original_pub_year,
                "my_rating": book.my_rating,
            })
        result.append({
            "id": entry.id,
            "booklist_index": entry.booklist_index,
            "title": entry.title,
            "author": entry.author,
            "category": entry.category,
            "read_flag": entry.read_flag,
            "candidates": candidates,
        })
    return result


@router.post("/booklist/pending/{pending_id}/resolve")
def resolve_pending(
    pending_id: int,
    action: str,
    book_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Resolve a pending disambiguation entry.

    action="merge"       — mark book_id as owned; requires book_id
    action="insert"      — insert the sheet row as a new book
    action="dismiss"     — discard the pending entry without inserting
    """
    entry = db.query(BooklistPending).filter(BooklistPending.id == pending_id).first()
    if not entry:
        raise HTTPException(404, "Pending entry not found")

    if action == "merge":
        if book_id is None:
            raise HTTPException(400, "book_id required for merge action")
        book = db.query(Book).filter(Book.id == book_id).first()
        if not book:
            raise HTTPException(404, f"Book {book_id} not found")
        book.owned_copies = 1
        book.booklist_id = entry.booklist_index
        if entry.year_acquired is not None:
            book.year_acquired = entry.year_acquired
        entry.status = "merged"

    elif action == "insert":
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        book_entry = booklist_ingest._book_entry_from_pending(entry)
        stmt = (
            sqlite_insert(Book)
            .values(**book_entry)
            .on_conflict_do_update(
                index_elements=["goodreads_book_id"],
                set_={k: v for k, v in book_entry.items() if k != "goodreads_book_id"},
            )
        )
        db.execute(stmt)
        entry.status = "inserted"

    elif action == "dismiss":
        entry.status = "dismissed"

    else:
        raise HTTPException(400, f"Unknown action: {action!r}")

    db.commit()
    return {"ok": True}


@router.post("/enrich")
def enrich_library(limit: int | None = None, db: Session = Depends(get_db)):
    """Trigger Open Library enrichment for unenriched books with ISBNs."""
    try:
        result = ol.enrich_all(db, only_unenriched=True, limit=limit)
        log = IngestLog(
            source="openlibrary",
            filename=f"enrich (limit={limit})",
            records_inserted=result["enriched"],
            records_updated=0,
            ingested_at=datetime.utcnow(),
            status="ok",
            message=None,
        )
        db.add(log)
        db.commit()
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/reclassify")
def reclassify(db: Session = Depends(get_db)):
    """Re-run genre classification on stored subjects without re-fetching from OL."""
    return ol.reclassify_all(db)


@router.post("/cf-rebuild")
def cf_rebuild(source: str = "ucsd", db: Session = Depends(get_db)):
    """Ingest a CF source and rebuild item-item similarity.
    `source` ∈ {"ucsd", "goodbooks"}. UCSD-Goodreads (Wan & McAuley) is the default."""
    from pathlib import Path
    from cf.ingest import ingest as cf_ingest
    from cf.similarity import build as cf_build

    base = Path(__file__).parent.parent.parent / "data" / "cf"
    if source == "ucsd":
        from cf.adapters.ucsd_goodreads import UCSDGoodreadsAdapter
        data_dir = base / "ucsd"
        if not (data_dir / "goodreads_interactions.csv").exists():
            raise HTTPException(400, f"Missing UCSD files in {data_dir}")
        adapter = UCSDGoodreadsAdapter(data_dir)
    elif source == "goodbooks":
        from cf.adapters.goodbooks import GoodbooksAdapter
        if not (base / "ratings.csv").exists():
            raise HTTPException(400, f"Missing Goodbooks files in {base}")
        adapter = GoodbooksAdapter(base)
    else:
        raise HTTPException(400, f"Unknown source: {source}")

    ingest_result = cf_ingest(db, adapter)
    sim_result = cf_build(db)

    log = IngestLog(
        source=f"cf-{source}", filename="rebuild",
        records_inserted=ingest_result["resolved_rows"],
        records_updated=0, ingested_at=datetime.utcnow(),
        status="ok", message=None,
    )
    db.add(log); db.commit()
    return {"ingest": ingest_result, "similarity": sim_result}


@router.get("/cf-status")
def cf_status(db: Session = Depends(get_db)):
    from sqlalchemy import func
    from db.models import ExternalRating, BookSimilarity
    n_ratings = db.query(func.count(ExternalRating.id)).scalar() or 0
    n_books = db.query(func.count(func.distinct(ExternalRating.book_id))).scalar() or 0
    n_pairs = db.query(func.count(BookSimilarity.id)).scalar() or 0
    return {
        "ratings_loaded": n_ratings,
        "books_covered": n_books,
        "similarity_pairs": n_pairs,
    }


@router.get("/enrich/status")
def enrich_status(db: Session = Depends(get_db)):
    from sqlalchemy import func
    total = db.query(func.count(Book.id)).scalar() or 0
    with_isbn = db.query(func.count(Book.id)).filter(
        ((Book.isbn13 != None) & (Book.isbn13 != "")) |
        ((Book.isbn != None) & (Book.isbn != ""))
    ).scalar() or 0
    enriched = db.query(func.count(Book.id)).filter(Book.enriched_at != None).scalar() or 0
    with_cover = db.query(func.count(Book.id)).filter(Book.cover_url != None).scalar() or 0
    with_genre = db.query(func.count(Book.id)).filter(Book.genre != None).scalar() or 0
    return {
        "total": total,
        "with_isbn": with_isbn,
        "enriched": enriched,
        "with_cover": with_cover,
        "with_genre": with_genre,
    }


@router.get("/status")
def ingest_status(db: Session = Depends(get_db)):
    row = db.query(
        func.count(Book.id),
        func.min(Book.date_added),
        func.max(Book.date_added),
    ).first()

    return {
        "books": {
            "count": row[0] if row else 0,
            "from": str(row[1]) if row and row[1] else None,
            "to": str(row[2]) if row and row[2] else None,
        },
        "logs": [
            {
                "source": l.source,
                "filename": l.filename,
                "status": l.status,
                "records": l.records_inserted,
                "at": str(l.ingested_at),
            }
            for l in db.query(IngestLog).order_by(IngestLog.ingested_at.desc()).limit(20)
        ],
    }
