"""Discovery API — find new books outside the user's current shelf."""
import json
import threading
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user
from db.database import get_db
from db.models import Book, DiscoveryCandidate, User, UserBook
from discover.pipeline import refresh_candidates

router = APIRouter(prefix="/api/discover", tags=["discover"])

# ---------------------------------------------------------------------------
# Background refresh state (keyed by user_id so concurrent users don't clash)
# ---------------------------------------------------------------------------

_refresh_lock = threading.Lock()
_refresh_state: dict = {
    "running":     False,
    "user_id":     None,
    "last_result": None,
    "error":       None,
}


def _run_refresh_bg(user_id: int) -> None:
    from db.database import SessionLocal
    db = SessionLocal()
    try:
        result = refresh_candidates(db, user_id=user_id)
        with _refresh_lock:
            _refresh_state.update({"running": False, "last_result": result, "error": None})
    except Exception as exc:
        with _refresh_lock:
            _refresh_state.update({"running": False, "error": str(exc)})
    finally:
        db.close()


def _candidate_dict(c: DiscoveryCandidate) -> dict:
    breakdown = {}
    if c.breakdown_json:
        try:
            breakdown = json.loads(c.breakdown_json)
        except Exception:
            pass

    evidence = {}
    if c.source_evidence:
        try:
            evidence = json.loads(c.source_evidence)
        except Exception:
            pass

    return {
        "id": c.id,
        "ol_work_key": c.ol_work_key,
        "title": c.title,
        "author": c.author,
        "source": c.source,
        "source_evidence": evidence,
        "cover_url": c.cover_url,
        "genre": c.genre,
        "ol_avg_rating": c.ol_avg_rating,
        "ol_ratings_count": c.ol_ratings_count,
        "original_pub_year": c.original_pub_year,
        "score": c.score,
        "breakdown": breakdown,
        "reason": c.reason or "",
        "status": c.status,
    }


@router.post("/refresh")
def refresh(current_user: User = Depends(get_current_user)):
    """Start candidate regeneration in a background thread. Returns immediately."""
    with _refresh_lock:
        if _refresh_state["running"]:
            return {"status": "already_running"}
        _refresh_state.update({"running": True, "user_id": current_user.id, "last_result": None, "error": None})
    threading.Thread(target=_run_refresh_bg, args=(current_user.id,), daemon=True).start()
    return {"status": "started"}


@router.get("/refresh/status")
def refresh_status(current_user: User = Depends(get_current_user)):
    """Poll this after POST /refresh to know when the job completes."""
    with _refresh_lock:
        return dict(_refresh_state)


@router.get("")
def list_candidates(
    limit: int = 50,
    source: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return ranked discovery candidates (status=new by default)."""
    q = (
        db.query(DiscoveryCandidate)
        .filter(
            DiscoveryCandidate.user_id == current_user.id,
            DiscoveryCandidate.status == "new",
            DiscoveryCandidate.score != None,
        )
    )
    if source:
        q = q.filter(DiscoveryCandidate.source == source)
    candidates = q.order_by(DiscoveryCandidate.score.desc()).limit(limit).all()
    return [_candidate_dict(c) for c in candidates]


@router.post("/{candidate_id}/dismiss")
def dismiss(
    candidate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hide this candidate from the discover feed."""
    c = db.query(DiscoveryCandidate).filter(
        DiscoveryCandidate.id == candidate_id,
        DiscoveryCandidate.user_id == current_user.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    c.status = "dismissed"
    db.commit()
    return {"ok": True}


@router.post("/{candidate_id}/add-to-shelf")
def add_to_shelf(
    candidate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add this candidate to the to-read shelf and mark it as added."""
    c = db.query(DiscoveryCandidate).filter(
        DiscoveryCandidate.id == candidate_id,
        DiscoveryCandidate.user_id == current_user.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")

    # Find or create the Book catalog entry
    book = None
    if c.ol_work_key:
        book = db.query(Book).filter(Book.ol_work_key == c.ol_work_key).first()
    if book is None and c.title and c.author:
        book = db.query(Book).filter(Book.title == c.title, Book.author == c.author).first()

    already_on_shelf = False
    if book is None:
        book = Book(
            goodreads_book_id=_synthetic_gr_id(c),
            title=c.title,
            author=c.author,
            cover_url=c.cover_url,
            genre=c.genre,
            subjects_json=c.subjects_json,
            ol_avg_rating=c.ol_avg_rating,
            ol_ratings_count=c.ol_ratings_count,
            ol_work_key=c.ol_work_key,
            original_pub_year=c.original_pub_year,
            enriched_at=datetime.utcnow(),
        )
        db.add(book)
        db.flush()
    else:
        # Check if user already has this book on their shelf
        existing_ub = db.query(UserBook).filter(
            UserBook.user_id == current_user.id,
            UserBook.book_id == book.id,
        ).first()
        already_on_shelf = existing_ub is not None

    if not already_on_shelf:
        db.add(UserBook(
            user_id=current_user.id,
            book_id=book.id,
            exclusive_shelf="to-read",
            date_added=datetime.utcnow().date(),
            my_rating=0,
            read_count=0,
        ))

    c.status = "added"
    db.commit()

    return {"ok": True, "already_on_shelf": already_on_shelf}


def _synthetic_gr_id(c: DiscoveryCandidate) -> int:
    return -(c.id + 1_000_000)
