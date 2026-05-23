"""KNN predictor: given a candidate book, predict the user's rating using
their ratings of the K most-similar books."""
from typing import Any

from sqlalchemy.orm import Session

from db.models import Book, BookSimilarity, UserBook

K_NEIGHBORS = 20      # use top-K similar books from user's rated library
MIN_AVG_SIM = 0.15    # require average similarity of used neighbors above this
MIN_NEIGHBORS = 5     # require at least N neighbors for any prediction


def load_predictor(db: Session, user_id: int) -> "Predictor":
    """Load similarity edges and user ratings into memory once."""
    user_ratings: dict[int, float] = {}
    for ub in db.query(UserBook).filter(
        UserBook.user_id == user_id,
        UserBook.exclusive_shelf == "read",
        UserBook.my_rating != None,
        UserBook.my_rating > 0,
    ).all():
        user_ratings[ub.book_id] = float(ub.my_rating)

    sim_edges: dict[int, list[tuple[float, int]]] = {}  # book_id → [(sim, neighbor_id), ...]
    for s in db.query(BookSimilarity.book_a_id, BookSimilarity.book_b_id, BookSimilarity.similarity).all():
        sim_edges.setdefault(s.book_a_id, []).append((s.similarity, s.book_b_id))

    return Predictor(user_ratings, sim_edges)


class Predictor:
    def __init__(self, user_ratings: dict[int, float], sim_edges: dict[int, list[tuple[float, int]]]):
        self.user_ratings = user_ratings
        self.sim_edges = sim_edges

    def predict(self, book_id: int) -> dict[str, Any] | None:
        """Predict user rating for a candidate book.
        Returns {prediction, neighbors_used, top_neighbors} or None if no signal."""
        edges = self.sim_edges.get(book_id, [])
        # Filter to neighbors the user has rated
        rated_neighbors = [(sim, nid) for sim, nid in edges if nid in self.user_ratings]
        if not rated_neighbors:
            return None
        rated_neighbors.sort(key=lambda x: -x[0])
        top = rated_neighbors[:K_NEIGHBORS]
        if len(top) < MIN_NEIGHBORS:
            return None

        # Confidence gate: only trust prediction if average similarity is meaningful
        avg_sim = sum(abs(s) for s, _ in top) / len(top)
        if avg_sim < MIN_AVG_SIM:
            return None

        # Weighted average: sum(sim * rating) / sum(|sim|)
        num = sum(sim * self.user_ratings[nid] for sim, nid in top)
        den = sum(abs(sim) for sim, _ in top)
        if den <= 0:
            return None
        prediction = num / den
        prediction = max(1.0, min(5.0, prediction))

        return {
            "prediction": prediction,
            "neighbors_used": len(top),
            "top_neighbors": [{"book_id": nid, "similarity": round(sim, 3),
                               "your_rating": self.user_ratings[nid]}
                              for sim, nid in top[:5]],
        }
