import threading
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

# ---------------------------------------------------------------------------
# OL enrichment background task state
# ---------------------------------------------------------------------------

_enrich_lock  = threading.Lock()
_enrich_state: dict = {
    "running":    False,
    "job":        None,   # "enrich" | "covers"
    "processed":  0,
    "enriched":   0,
    "not_found":  0,
    "errors":     0,
}


def _run_enrich_bg(limit: int | None) -> None:
    from db.database import SessionLocal
    db = SessionLocal()
    try:
        result = ol.enrich_all(db, only_unenriched=True, limit=limit)
        with _enrich_lock:
            _enrich_state.update({
                "running":   False,
                "processed": result.get("processed", 0),
                "enriched":  result.get("enriched", 0),
                "not_found": result.get("not_found", 0),
            })
        # Log it
        db2 = SessionLocal()
        try:
            from db.models import IngestLog as _IL
            log = _IL(
                source="openlibrary",
                filename=f"enrich (limit={limit})",
                records_inserted=result.get("enriched", 0),
                records_updated=0,
                ingested_at=datetime.utcnow(),
                status="ok",
                message=None,
            )
            db2.add(log)
            db2.commit()
        finally:
            db2.close()
    except Exception:
        with _enrich_lock:
            _enrich_state["running"] = False
            _enrich_state["errors"] += 1
    finally:
        db.close()


def _run_covers_bg(limit: int | None) -> None:
    from db.database import SessionLocal
    db = SessionLocal()
    try:
        result = ol.backfill_missing_covers(db, limit=limit)
        with _enrich_lock:
            _enrich_state.update({
                "running":   False,
                "processed": result.get("checked", 0),
                "enriched":  result.get("filled", 0),
                "not_found": result.get("not_found", 0),
            })
    except Exception:
        with _enrich_lock:
            _enrich_state["running"] = False
            _enrich_state["errors"] += 1
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Diversity enrichment background task state
# ---------------------------------------------------------------------------

_diversity_lock  = threading.Lock()
_diversity_state: dict = {
    "running":           False,
    "authors_processed": 0,
    "authors_enriched":  0,
    "books_updated":     0,
    "errors":            0,
    "stop_flag":         [False],   # single-element list so the thread can see mutations
}


def _run_diversity_bg(limit: int | None) -> None:
    """Background thread: runs enrich_all and keeps _diversity_state current."""
    import ingest.wikidata as wikidata
    from db.database import SessionLocal

    db = SessionLocal()
    try:
        stop_flag = _diversity_state["stop_flag"]

        def _on_progress(totals: dict) -> None:
            with _diversity_lock:
                _diversity_state.update(totals)

        wikidata.enrich_all(db, limit=limit, on_progress=_on_progress,
                            stop_flag=stop_flag)
    except Exception:
        with _diversity_lock:
            _diversity_state["errors"] += 1
    finally:
        db.close()
        with _diversity_lock:
            _diversity_state["running"] = False


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


@router.post("/enrich-covers")
def enrich_covers(limit: int | None = None):
    """Start cover backfill in a background thread.  Returns immediately.

    Calling while a job is already running returns the current state without
    starting a second thread.
    """
    with _enrich_lock:
        if _enrich_state["running"]:
            return {"status": "already_running", **_enrich_state}
        _enrich_state.update({
            "running": True, "job": "covers",
            "processed": 0, "enriched": 0, "not_found": 0, "errors": 0,
        })
    threading.Thread(target=_run_covers_bg, args=(limit,), daemon=True).start()
    return {"status": "started"}


@router.post("/enrich")
def enrich_library(limit: int | None = None):
    """Start OL enrichment in a background thread.  Returns immediately.

    Calling while a job is already running returns the current state without
    starting a second thread.
    """
    with _enrich_lock:
        if _enrich_state["running"]:
            return {"status": "already_running", **_enrich_state}
        _enrich_state.update({
            "running": True, "job": "enrich",
            "processed": 0, "enriched": 0, "not_found": 0, "errors": 0,
        })
    threading.Thread(target=_run_enrich_bg, args=(limit,), daemon=True).start()
    return {"status": "started"}


@router.post("/diversity-enrich")
def diversity_enrich(limit: int | None = None, db: Session = Depends(get_db)):
    """Start background diversity enrichment.  Returns immediately.

    If enrichment is already running, returns the current state without
    starting a second thread.  Pass limit=N to cap the number of authors
    processed in this run (default: all remaining).
    """
    with _diversity_lock:
        if _diversity_state["running"]:
            return {"status": "already_running", **{
                k: v for k, v in _diversity_state.items() if k != "stop_flag"
            }}
        _diversity_state.update({
            "running":           True,
            "authors_processed": 0,
            "authors_enriched":  0,
            "books_updated":     0,
            "errors":            0,
            "stop_flag":         [False],
        })

    thread = threading.Thread(target=_run_diversity_bg, args=(limit,), daemon=True)
    thread.start()
    return {"status": "started"}


@router.post("/diversity-enrich/stop")
def diversity_enrich_stop():
    """Ask the running enrichment thread to stop after the current author."""
    with _diversity_lock:
        _diversity_state["stop_flag"][0] = True
    return {"ok": True}


@router.get("/diversity-enrich/status")
def diversity_enrich_status(db: Session = Depends(get_db)):
    """Coverage stats + current background task state."""
    from sqlalchemy import distinct

    read_q = db.query(Book).filter(Book.exclusive_shelf == "read", Book.author.isnot(None))
    total_read    = read_q.count()
    searched      = read_q.filter(Book.diversity_enriched_at.isnot(None)).count()
    with_gender   = read_q.filter(Book.author_gender.isnot(None)).count()
    with_ethnicity = read_q.filter(Book.author_ethnicity.isnot(None)).count()
    total_authors = db.query(func.count(distinct(Book.author))).filter(
        Book.exclusive_shelf == "read", Book.author.isnot(None)
    ).scalar() or 0
    searched_authors = db.query(func.count(distinct(Book.author))).filter(
        Book.exclusive_shelf == "read",
        Book.author.isnot(None),
        Book.diversity_enriched_at.isnot(None),
    ).scalar() or 0

    with _diversity_lock:
        task = {k: v for k, v in _diversity_state.items() if k != "stop_flag"}

    return {
        "total_read":        total_read,
        "total_authors":     total_authors,
        "searched":          searched,
        "searched_authors":  searched_authors,
        "with_gender":       with_gender,
        "with_ethnicity":    with_ethnicity,
        "task":              task,
    }


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
    missing_covers = total - with_cover
    with _enrich_lock:
        task = dict(_enrich_state)
    return {
        "total": total,
        "with_isbn": with_isbn,
        "enriched": enriched,
        "with_cover": with_cover,
        "with_genre": with_genre,
        "missing_covers": missing_covers,
        "enrich_task": task,
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
