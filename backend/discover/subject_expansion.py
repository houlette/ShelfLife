"""Subject-expansion candidate source.

For each high-affinity OL subject in the user profile (avg ≥ 4.0, support ≥ 5),
fetch top-rated OL works tagged with that subject and emit unknown ones.
"""
import time

from sqlalchemy.orm import Session

from . import ol_search

MIN_SUBJECT_AFFINITY = 4.0
MIN_SUBJECT_SUPPORT = 5     # must match recommend.SUBJECT_MIN_SUPPORT
WORKS_PER_SUBJECT = 20
MAX_SUBJECTS = 15           # cap so we don't make 100+ OL calls
RATE_DELAY = 0.2


def candidates(
    db: Session,
    profile: dict,
    known_work_keys: set[str],
    known_titles: set[str],
) -> list[dict]:
    """Return candidate seeds sourced from high-affinity subjects."""
    subject_affinity: dict[str, float] = profile.get("subject_affinity", {})
    subject_support: dict[str, int] = profile.get("subject_support", {})

    # Pick subjects sorted by affinity desc, capped at MAX_SUBJECTS
    top_subjects = sorted(
        [
            (s, v)
            for s, v in subject_affinity.items()
            if v >= MIN_SUBJECT_AFFINITY and subject_support.get(s, 0) >= MIN_SUBJECT_SUPPORT
        ],
        key=lambda x: -x[1],
    )[:MAX_SUBJECTS]

    results: list[dict] = []
    seen_keys: set[str] = set()

    for subject, affinity in top_subjects:
        seeds = ol_search.by_subject(subject, limit=WORKS_PER_SUBJECT)
        time.sleep(RATE_DELAY)
        for seed in seeds:
            wk = seed["ol_work_key"]
            if not wk or wk in known_work_keys or wk in seen_keys:
                continue
            t_norm = _normalize(seed["title"])
            if t_norm in known_titles:
                continue
            seed["source"] = "subject"
            seed["source_evidence"] = {
                "subject": subject,
                "your_avg": round(affinity, 2),
                "support": subject_support.get(subject, 0),
            }
            seen_keys.add(wk)
            results.append(seed)

    return results


def _normalize(title: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]", "", title.lower())
