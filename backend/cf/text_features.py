"""Content predictor using TF-IDF over aggregated review text.

For each book in user's library that has aggregated review text, build a
TF-IDF vector. Predict a candidate's rating as a similarity-weighted average
of the user's ratings of the K most-similar rated books.
"""
import math
import re
from collections import Counter
from typing import Any

from sqlalchemy.orm import Session

from db.models import Book, BookReviewAgg, UserBook

K_NEIGHBORS = 15        # use top-K most-similar rated books
MIN_AVG_SIM = 0.05      # require average similarity above this to use a prediction
MIN_NEIGHBORS = 3       # require at least N neighbors
MIN_DOC_FREQ = 3        # word must appear in ≥ N books to be in vocabulary
MAX_DOC_FREQ_RATIO = 0.7  # word in > X% of books is too common (stopword-like)

_WORD_RE = re.compile(r"[a-zA-Z']{3,}")
_STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had",
    "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how",
    "man", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its",
    "let", "put", "say", "she", "too", "use", "this", "that", "with", "have",
    "from", "they", "will", "would", "there", "their", "what", "about", "which",
    "when", "your", "more", "very", "just", "into", "than", "your", "some",
    "book", "books", "story", "read", "reading", "really", "much", "first",
    "even", "also", "good", "great", "other", "like", "made", "make", "many",
    "could", "still", "after", "back", "down", "found", "going", "where",
    "want", "ever", "only", "those", "these", "such", "while", "well",
}


def tokenize(text: str) -> list[str]:
    return [w for w in (m.group(0).lower() for m in _WORD_RE.finditer(text))
            if w not in _STOPWORDS]


def _build_idf(docs: dict[int, list[str]]) -> dict[str, float]:
    n_docs = len(docs)
    df: Counter = Counter()
    for tokens in docs.values():
        for w in set(tokens):
            df[w] += 1
    max_df = int(n_docs * MAX_DOC_FREQ_RATIO)
    return {
        w: math.log((1 + n_docs) / (1 + count)) + 1.0
        for w, count in df.items()
        if MIN_DOC_FREQ <= count <= max_df
    }


def _tfidf_vector(tokens: list[str], idf: dict[str, float]) -> dict[str, float]:
    n = len(tokens)
    if n == 0:
        return {}
    tf = Counter(tokens)
    vec = {w: (count / n) * idf[w] for w, count in tf.items() if w in idf}
    # L2 normalize
    norm = math.sqrt(sum(v * v for v in vec.values()))
    if norm == 0:
        return vec
    return {w: v / norm for w, v in vec.items()}


def _cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(v * b[w] for w, v in a.items() if w in b)


class TextPredictor:
    def __init__(self, vectors: dict[int, dict[str, float]], user_ratings: dict[int, float]):
        self.vectors = vectors
        self.user_ratings = user_ratings
        # Cache rated-only subset for prediction
        self.rated_vectors = {bid: v for bid, v in vectors.items() if bid in user_ratings}

    def predict(self, book_id: int) -> dict[str, Any] | None:
        candidate = self.vectors.get(book_id)
        if not candidate:
            return None
        # Compute cosine to every rated book; keep top K
        sims: list[tuple[float, int]] = []
        for rid, rvec in self.rated_vectors.items():
            if rid == book_id:
                continue  # leave-one-out — never use the candidate's own rating
            s = _cosine(candidate, rvec)
            if s > 0:
                sims.append((s, rid))
        if len(sims) < MIN_NEIGHBORS:
            return None
        sims.sort(key=lambda x: -x[0])
        top = sims[:K_NEIGHBORS]
        avg_sim = sum(s for s, _ in top) / len(top)
        if avg_sim < MIN_AVG_SIM:
            return None
        num = sum(s * self.user_ratings[rid] for s, rid in top)
        den = sum(s for s, _ in top)
        prediction = max(1.0, min(5.0, num / den))
        return {
            "prediction": prediction,
            "neighbors_used": len(top),
            "avg_similarity": avg_sim,
            "top_neighbors": [{"book_id": rid, "similarity": round(s, 3),
                               "your_rating": self.user_ratings[rid]}
                              for s, rid in top[:5]],
        }


def load_predictor(db: Session, user_id: int | None = None) -> TextPredictor | None:
    """Build TF-IDF vectors from BookReviewAgg rows. Returns None if no data."""
    rows = db.query(BookReviewAgg.book_id, BookReviewAgg.text).all()
    if not rows:
        return None

    docs: dict[int, list[str]] = {bid: tokenize(text) for bid, text in rows}
    idf = _build_idf(docs)
    if not idf:
        return None
    vectors = {bid: _tfidf_vector(toks, idf) for bid, toks in docs.items()}
    vectors = {bid: v for bid, v in vectors.items() if v}

    if user_id is not None:
        user_ratings = {
            ub.book_id: float(ub.my_rating)
            for ub in db.query(UserBook).filter(
                UserBook.user_id == user_id,
                UserBook.exclusive_shelf == "read",
                UserBook.my_rating != None,
                UserBook.my_rating > 0,
            ).all()
        }
    else:
        user_ratings = {}
    return TextPredictor(vectors, user_ratings)
