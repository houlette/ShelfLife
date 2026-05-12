"""Random search over recommendation-score weights.

Splits rated, read books 75/25. Builds the user profile on the train set so
genre/author/subject offsets are not contaminated by the held-out book.
Text and CF predictors already do leave-one-out internally.

Evaluates MAE between predicted score and actual user rating on the holdout.
"""
import random
import statistics
import time

import recommend
from cf.predict import load_predictor as load_cf
from cf.text_features import load_predictor as load_text
from db.database import SessionLocal
from db.models import Book

SEED = 42
TEST_FRAC = 0.25
N_TRIALS = 250


def evaluate(weights: dict, profile, cf, text, test_books) -> tuple[float, int]:
    # Patch module-level weights
    for k, v in weights.items():
        setattr(recommend, k, v)

    errors = []
    for b in test_books:
        cf_p = cf.predict(b.id) if cf else None
        text_p = text.predict(b.id) if text else None
        s = recommend._score_book(b, profile, cf_pred=cf_p, text_pred=text_p)
        if s is None:
            continue
        errors.append(abs(s["score"] - b.my_rating))
    if not errors:
        return float("inf"), 0
    return statistics.fmean(errors), len(errors)


def main():
    db = SessionLocal()
    cf = load_cf(db)
    text = load_text(db)

    all_read = db.query(Book).filter(
        Book.exclusive_shelf == "read",
        Book.my_rating != None,
        Book.my_rating > 0,
    ).all()

    rng = random.Random(SEED)
    shuffled = list(all_read)
    rng.shuffle(shuffled)
    n_test = int(len(shuffled) * TEST_FRAC)
    test_books = shuffled[:n_test]
    train_books = shuffled[n_test:]
    print(f"train={len(train_books)} test={len(test_books)}")

    profile = recommend._build_profile(db, read=train_books)

    # Baseline: current weights
    baseline = {
        "BETA": recommend.BETA, "GAMMA": recommend.GAMMA, "ZETA": recommend.ZETA,
        "THETA": recommend.THETA, "ETA": recommend.ETA,
        "DELTA": recommend.DELTA, "EPSILON": recommend.EPSILON,
    }
    base_mae, base_n = evaluate(baseline, profile, cf, text, test_books)
    print(f"baseline MAE={base_mae:.4f} on n={base_n}  weights={baseline}")

    # Bound trivial "predict the mean" comparison
    mean_pred = statistics.fmean(b.my_rating for b in train_books)
    mean_mae = statistics.fmean(abs(b.my_rating - mean_pred) for b in test_books)
    print(f"naive-mean MAE={mean_mae:.4f} (pred={mean_pred:.3f})")

    # Random search ranges
    ranges = {
        "BETA":    (0.0, 1.2),
        "GAMMA":   (0.0, 0.8),
        "ZETA":    (0.0, 1.0),
        "THETA":   (0.0, 0.6),
        "ETA":     (0.0, 0.8),
        "DELTA":   (0.0, 0.4),
        "EPSILON": (0.0, 0.4),
    }

    best = (base_mae, baseline)
    t0 = time.time()
    for i in range(N_TRIALS):
        cand = {k: round(rng.uniform(lo, hi), 3) for k, (lo, hi) in ranges.items()}
        mae, _ = evaluate(cand, profile, cf, text, test_books)
        if mae < best[0]:
            best = (mae, cand)
            print(f"  [{i:3d}] new best MAE={mae:.4f}  {cand}")
    print(f"\nrandom search done in {time.time()-t0:.1f}s")
    print(f"best random MAE={best[0]:.4f}  weights={best[1]}")
    print(f"improvement over baseline: {base_mae - best[0]:+.4f}")

    # Coordinate-descent refine around best
    print("\nRefining via coordinate descent…")
    current = dict(best[1])
    current_mae = best[0]
    improved = True
    iters = 0
    while improved and iters < 8:
        improved = False
        iters += 1
        for k, (lo, hi) in ranges.items():
            for delta in (-0.05, -0.02, +0.02, +0.05):
                test = dict(current)
                test[k] = max(lo, min(hi, round(current[k] + delta, 3)))
                mae, _ = evaluate(test, profile, cf, text, test_books)
                if mae < current_mae - 1e-5:
                    current_mae = mae
                    current = test
                    improved = True
        print(f"  iter {iters}: MAE={current_mae:.4f}")
    print(f"\nfinal MAE={current_mae:.4f}")
    print(f"final weights: {current}")
    print(f"total improvement over baseline: {base_mae - current_mae:+.4f}")
    db.close()


if __name__ == "__main__":
    main()
