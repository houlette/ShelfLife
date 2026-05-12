"""Discovery API — find new books outside the user's current shelf."""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Book, DiscoveryCandidate
from discover.pipeline import refresh_candidates

router = APIRouter(prefix="/api/discover", tags=["discover"])


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
def refresh(db: Session = Depends(get_db)):
    """Regenerate discovery candidates from author/subject expansion. Idempotent."""
    return refresh_candidates(db)


@router.get("")
def list_candidates(
    limit: int = 50,
    source: str | None = None,
    db: Session = Depends(get_db),
):
    """Return ranked discovery candidates (status=new by default)."""
    q = (
        db.query(DiscoveryCandidate)
        .filter(DiscoveryCandidate.status == "new")
        .filter(DiscoveryCandidate.score != None)
    )
    if source:
        q = q.filter(DiscoveryCandidate.source == source)
    candidates = q.order_by(DiscoveryCandidate.score.desc()).limit(limit).all()
    return [_candidate_dict(c) for c in candidates]


@router.post("/{candidate_id}/dismiss")
def dismiss(candidate_id: int, db: Session = Depends(get_db)):
    """Hide this candidate from the discover feed."""
    c = db.get(DiscoveryCandidate, candidate_id)
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    c.status = "dismissed"
    db.commit()
    return {"ok": True}


@router.post("/{candidate_id}/add-to-shelf")
def add_to_shelf(candidate_id: int, db: Session = Depends(get_db)):
    """Add this candidate to the to-read shelf and mark it as added."""
    c = db.get(DiscoveryCandidate, candidate_id)
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")

    # Check if already on shelf (by work key or normalized title)
    existing = None
    if c.ol_work_key:
        existing = db.query(Book).filter(Book.ol_work_key == c.ol_work_key).first()
    if existing is None and c.title and c.author:
        existing = (
            db.query(Book)
            .filter(Book.title == c.title, Book.author == c.author)
            .first()
        )

    if existing is None:
        book = Book(
            goodreads_book_id=_synthetic_gr_id(c),
            title=c.title,
            author=c.author,
            exclusive_shelf="to-read",
            cover_url=c.cover_url,
            genre=c.genre,
            subjects_json=c.subjects_json,
            ol_avg_rating=c.ol_avg_rating,
            ol_ratings_count=c.ol_ratings_count,
            ol_work_key=c.ol_work_key,
            original_pub_year=c.original_pub_year,
            date_added=datetime.utcnow().date(),
            enriched_at=datetime.utcnow(),
            my_rating=0,
            read_count=0,
        )
        db.add(book)

    c.status = "added"
    db.commit()

    return {"ok": True, "already_on_shelf": existing is not None}


def _synthetic_gr_id(c: DiscoveryCandidate) -> int:
    """Generate a stable synthetic Goodreads ID for books discovered via OL.
    Uses a large negative offset from the candidate ID to avoid collisions with
    real Goodreads IDs (which are positive integers starting low)."""
    return -(c.id + 1_000_000)
