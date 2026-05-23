import threading
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from auth import get_current_user
from db.database import get_db
from db.models import Book, BooklistPending, IngestLog, SeriesCatalog, User, UserBook
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

    def _progress(totals: dict) -> None:
        with _enrich_lock:
            _enrich_state.update(totals)

    try:
        result = ol.enrich_all(db, only_unenriched=True, limit=limit,
                               on_progress=_progress)
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

    def _progress(totals: dict) -> None:
        with _enrich_lock:
            _enrich_state.update(totals)

    try:
        result = ol.backfill_missing_covers(db, limit=limit, on_progress=_progress)
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


def _log(db: Session, source: str, filename: str, result: dict, status: str = "ok", user_id: int | None = None):
    log = IngestLog(
        source=source,
        filename=filename,
        records_inserted=result.get("inserted", 0),
        records_updated=0,
        ingested_at=datetime.utcnow(),
        status=status,
        message=str(result.get("errors", [])) if result.get("errors") else None,
        user_id=user_id,
    )
    db.add(log)
    db.commit()


@router.post("/goodreads")
async def upload_goodreads(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(400, "Expected a .csv file")
    content = await file.read()
    try:
        result = goodreads_ingest.ingest_csv(content, db, user_id=current_user.id)
        _log(db, "goodreads", file.filename, result, user_id=current_user.id)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/booklist")
async def upload_booklist(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(400, "Expected a .csv file")
    content = await file.read()
    try:
        result = booklist_ingest.ingest_csv(content, db)
        _log(db, "booklist", file.filename, result, user_id=current_user.id)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/booklist/pending")
def booklist_pending(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return unresolved pending entries with candidate book details for disambiguation UI."""
    import json as _json
    entries = (
        db.query(BooklistPending)
        .filter(BooklistPending.status == "pending", BooklistPending.user_id == current_user.id)
        .all()
    )
    result = []
    for entry in entries:
        candidate_ids: list[int] = _json.loads(entry.candidate_book_ids or "[]")
        candidates = []
        for book, ub in (
            db.query(Book, UserBook)
            .outerjoin(UserBook, (UserBook.book_id == Book.id) & (UserBook.user_id == current_user.id))
            .filter(Book.id.in_(candidate_ids))
            .all()
        ):
            candidates.append({
                "id": book.id,
                "title": book.title,
                "author": book.author,
                "cover_url": book.cover_url,
                "exclusive_shelf": ub.exclusive_shelf if ub else None,
                "original_pub_year": book.original_pub_year,
                "my_rating": ub.my_rating if ub else 0,
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
    current_user: User = Depends(get_current_user),
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
def enrich_covers(limit: int | None = None, current_user: User = Depends(get_current_user)):
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
def enrich_library(limit: int | None = None, current_user: User = Depends(get_current_user)):
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
def diversity_enrich(limit: int | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
def diversity_enrich_stop(current_user: User = Depends(get_current_user)):
    """Ask the running enrichment thread to stop after the current author."""
    with _diversity_lock:
        _diversity_state["stop_flag"][0] = True
    return {"ok": True}


@router.post("/diversity-enrich/reset")
def diversity_enrich_reset(scope: str = "unresolved", db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Clear diversity_enriched_at so affected authors are re-queried next run.

    scope="unresolved"     — authors searched but no origin found (default).
                             Enables the new Wikidata P27 fallback for them.
    scope="middle_eastern" — authors tagged Middle Eastern.
                             Use this to re-classify after the Jewish-bucket fix.
    scope="all"            — every previously-searched author (full clean re-run).

    Manual edits (author_diversity_manual=True) are always excluded from all scopes.
    """
    q = db.query(Book).filter(Book.author_diversity_manual.isnot(True))
    if scope == "unresolved":
        q = q.filter(
            Book.diversity_enriched_at.isnot(None),
            Book.author_ethnicity.is_(None),
        )
    elif scope == "middle_eastern":
        q = q.filter(Book.author_ethnicity == "Middle Eastern")
    elif scope == "all":
        q = q.filter(Book.diversity_enriched_at.isnot(None))
    else:
        raise HTTPException(400, f"Unknown scope: {scope!r}")

    count = q.update({"diversity_enriched_at": None}, synchronize_session=False)
    db.commit()
    return {"reset": count}


class _UpdateAuthorDiversityBody(BaseModel):
    author: str
    gender: str | None = None        # canonical value or None to clear
    ethnicity: str | None = None     # canonical group name or None to clear


@router.patch("/author-diversity")
def update_author_diversity(body: _UpdateAuthorDiversityBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Set gender / ethnicity for every book by a given author and mark as manual.

    Manually-edited authors are excluded from all reset scopes and from the
    Wikidata enrichment write loop, so the values survive re-enrichment runs.
    """
    books = db.query(Book).filter(Book.author == body.author).all()
    if not books:
        raise HTTPException(404, f"No books found for author {body.author!r}")
    now = datetime.utcnow()
    for book in books:
        book.author_gender = body.gender
        book.author_ethnicity = body.ethnicity
        book.author_diversity_manual = True
        book.diversity_enriched_at = now
    db.commit()
    return {"updated": len(books)}


@router.get("/diversity-enrich/status")
def diversity_enrich_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Coverage stats + current background task state."""
    from sqlalchemy import distinct

    # Join UserBook → Book to scope to this user's read books
    read_q = (
        db.query(Book)
        .join(UserBook, (UserBook.book_id == Book.id) & (UserBook.user_id == current_user.id))
        .filter(UserBook.exclusive_shelf == "read", Book.author.isnot(None))
    )
    total_read     = read_q.count()
    searched       = read_q.filter(Book.diversity_enriched_at.isnot(None)).count()
    with_gender    = read_q.filter(Book.author_gender.isnot(None)).count()
    with_ethnicity = read_q.filter(Book.author_ethnicity.isnot(None)).count()
    total_authors = db.query(func.count(distinct(Book.author))).join(
        UserBook, (UserBook.book_id == Book.id) & (UserBook.user_id == current_user.id)
    ).filter(UserBook.exclusive_shelf == "read", Book.author.isnot(None)).scalar() or 0
    searched_authors = db.query(func.count(distinct(Book.author))).join(
        UserBook, (UserBook.book_id == Book.id) & (UserBook.user_id == current_user.id)
    ).filter(
        UserBook.exclusive_shelf == "read",
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
def reclassify(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Re-run genre classification on stored subjects without re-fetching from OL."""
    return ol.reclassify_all(db)


# ---------------------------------------------------------------------------
# Series enrichment background task
# ---------------------------------------------------------------------------

_series_lock = threading.Lock()
_series_state: dict = {
    "running":   False,
    "processed": 0,
    "total":     0,
    "current":   None,
}


def _run_series_enrich_bg() -> None:
    from datetime import timedelta
    from db.database import SessionLocal
    import ingest.wikidata as wd

    db = SessionLocal()
    try:
        # Collect all series names; also grab ol_work_key for the OL fallback
        all_rows = (
            db.query(Book.series_name, Book.ol_work_key)
            .filter(Book.series_name.isnot(None))
            .all()
        )
        # series_name → first ol_work_key found (may be None)
        seen: dict[str, str | None] = {}
        for name, wk in all_rows:
            if name and name not in seen:
                seen[name] = wk

        stale_cutoff = datetime.utcnow() - timedelta(days=7)

        with _series_lock:
            _series_state.update({"running": True, "total": len(seen), "processed": 0, "current": None})

        for series_name, ol_work_key in seen.items():
            existing = (
                db.query(SeriesCatalog)
                .filter(SeriesCatalog.series_key == series_name.lower())
                .first()
            )
            if existing and existing.fetched_at and existing.fetched_at > stale_cutoff:
                with _series_lock:
                    _series_state["processed"] += 1
                continue

            with _series_lock:
                _series_state["current"] = series_name

            # Primary: Wikidata (P179 part-of-series + P1545 series ordinal)
            entries = wd.fetch_series_catalog(series_name)

            # Fallback: OL work/series/seeds chain if Wikidata returned nothing
            if not entries and ol_work_key:
                _, entries = ol.fetch_series_catalog(series_name, ol_work_key)
            now = datetime.utcnow()

            db.query(SeriesCatalog).filter(
                SeriesCatalog.series_key == series_name.lower()
            ).delete()

            if entries:
                for e in entries:
                    db.add(SeriesCatalog(
                        series_key=series_name.lower(),
                        display_name=series_name,
                        position=e["position"],
                        title=e["title"],
                        ol_work_key=e["ol_work_key"],
                        cover_url=e["cover_url"],
                        fetched_at=now,
                    ))
            else:
                db.add(SeriesCatalog(
                    series_key=series_name.lower(),
                    display_name=series_name,
                    fetched_at=now,
                ))
            db.commit()

            with _series_lock:
                _series_state["processed"] += 1

            import time as _time
            _time.sleep(0.2)

        with _series_lock:
            _series_state.update({"running": False, "current": None})
    except Exception:
        with _series_lock:
            _series_state["running"] = False
    finally:
        db.close()


@router.post("/enrich-series")
def enrich_series(current_user: User = Depends(get_current_user)):
    """Start a background task that fetches the complete book list for each
    series from Open Library and caches it in series_catalog."""
    with _series_lock:
        if _series_state["running"]:
            return {"status": "already_running"}
        _series_state["running"] = True
    threading.Thread(target=_run_series_enrich_bg, daemon=True).start()
    return {"status": "started"}


@router.get("/series-enrich/status")
def series_enrich_status(current_user: User = Depends(get_current_user)):
    with _series_lock:
        return dict(_series_state)


@router.post("/cf-rebuild")
def cf_rebuild(source: str = "ucsd", db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
def cf_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
def enrich_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from sqlalchemy import func
    total = db.query(func.count(Book.id)).scalar() or 0
    with_isbn = db.query(func.count(Book.id)).filter(
        ((Book.isbn13 != None) & (Book.isbn13 != "")) |
        ((Book.isbn != None) & (Book.isbn != ""))
    ).scalar() or 0
    enriched = db.query(func.count(Book.id)).filter(Book.enriched_at != None).scalar() or 0
    with_cover = db.query(func.count(Book.id)).filter(Book.cover_url != None).scalar() or 0
    with_genre = db.query(func.count(Book.id)).filter(Book.genre != None).scalar() or 0
    # Books with no cover at all — both unenriched and enriched-but-missed.
    missing_covers = db.query(func.count(Book.id)).filter(Book.cover_url == None).scalar() or 0
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
def ingest_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.query(
        func.count(UserBook.id),
        func.min(UserBook.date_added),
        func.max(UserBook.date_added),
    ).filter(UserBook.user_id == current_user.id).first()

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
            for l in db.query(IngestLog)
            .filter(IngestLog.user_id == current_user.id)
            .order_by(IngestLog.ingested_at.desc())
            .limit(20)
        ],
    }
