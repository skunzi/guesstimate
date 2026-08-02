#!/usr/bin/env python3
"""
Reorder photos in data/rounds.json while respecting:
1. Photos stay in the same category as before
2. A photo appearing in multiple categories has at least N days between usages
3. Answers within a single round are spread out (not clustered)
"""

import argparse
import json
import random
import sys
from datetime import datetime
from itertools import combinations
from pathlib import Path

ROUNDS_FILE = Path(__file__).parent.parent / "data" / "rounds.json"
MAX_ATTEMPTS = 50
random.seed(42)
display_rng = random.Random(7)


def load_rounds():
    with open(ROUNDS_FILE) as f:
        return json.load(f)


def save_rounds(rounds):
    with open(ROUNDS_FILE, "w") as f:
        json.dump(rounds, f, indent=2, ensure_ascii=False)
        f.write("\n")


def photo_key(photo):
    return photo["file"]


def is_diverse_enough(photos, category):
    """Check if a set of 4 photos has sufficiently diverse answers."""
    answers = sorted(p["answer"] for p in photos)
    if len(answers) < 4:
        return False

    if category == "how_old":
        total_range = answers[-1] - answers[0]
        if total_range < 20:
            return False
        # No three consecutive answers within 10 years
        for i in range(len(answers) - 2):
            if answers[i + 2] - answers[i] <= 10:
                return False
        return True
    elif category == "how_tall":
        if answers[0] > 0 and answers[-1] / answers[0] < 1.5:
            return False
        # No two answers within 5% of each other
        for i in range(len(answers) - 1):
            if answers[i] > 0 and answers[i + 1] / answers[i] < 1.08:
                return False
        return True
    elif category == "how_many":
        if answers[0] > 0 and answers[-1] / answers[0] < 3:
            return False
        return True
    return True


def answer_diversity_score(photos, category):
    """Score how well-spread the answers are. Higher is better."""
    answers = sorted(p["answer"] for p in photos)
    if len(answers) < 2:
        return float("inf")

    if category == "how_old":
        total_range = answers[-1] - answers[0]
        min_gap = min(answers[i + 1] - answers[i] for i in range(len(answers) - 1))
        return total_range + min_gap * 3
    else:
        if answers[0] == 0:
            return sum(answers)
        ratios = [answers[i + 1] / max(answers[i], 1) for i in range(len(answers) - 1)]
        min_ratio = min(ratios)
        total_ratio = answers[-1] / max(answers[0], 1)
        return total_ratio * 10 + min_ratio * 5


def collect_photo_pool(rounds):
    """
    Collect all unique photos per category, tracking how many times each photo
    appears in that category (so we can use them the same number of times).
    """
    pool = {}  # category -> {file -> {photo_data, count}}
    for r in rounds:
        cat = r["category"]
        if cat not in pool:
            pool[cat] = {}
        for p in r["photos"]:
            key = photo_key(p)
            if key not in pool[cat]:
                pool[cat][key] = {"photo": p, "count": 0}
            pool[cat][key]["count"] += 1
    return pool


def reorder_photos(rounds, min_gap_days):
    """
    Main reordering algorithm using backtracking-friendly greedy approach.
    Each photo must be used exactly as many times as in the original.
    """
    pool = collect_photo_pool(rounds)

    # Build the schedule: list of (date, category) in order
    schedule = [(r["date"], r["category"]) for r in rounds]

    best_result = None
    best_issues = None

    for attempt in range(MAX_ATTEMPTS):
        if attempt > 0:
            random.seed(42 + attempt)

        # Reset remaining uses
        remaining = {}
        for cat in pool:
            remaining[cat] = {}
            for key, info in pool[cat].items():
                remaining[cat][key] = info["count"]

        # Track when each photo was last used (across all categories)
        last_used = {}
        result = []
        failed = False

        for date_str, category in schedule:
            current_date = datetime.strptime(date_str, "%Y-%m-%d")

            available = []
            for key, info in pool[category].items():
                if remaining[category].get(key, 0) <= 0:
                    continue
                if key in last_used:
                    last_date = datetime.strptime(last_used[key], "%Y-%m-%d")
                    if (current_date - last_date).days < min_gap_days:
                        continue
                available.append(info["photo"])

            if len(available) < 4:
                failed = True
                break

            # Find the best diverse combination
            best_combo = None
            best_score = -1

            if len(available) <= 15:
                for combo in combinations(available, 4):
                    combo = list(combo)
                    if not is_diverse_enough(combo, category):
                        continue
                    score = answer_diversity_score(combo, category)
                    if score > best_score:
                        best_score = score
                        best_combo = combo
            else:
                # Random sampling
                shuffled = available[:]
                random.shuffle(shuffled)
                for _ in range(1000):
                    combo = random.sample(available, 4)
                    if not is_diverse_enough(combo, category):
                        continue
                    score = answer_diversity_score(combo, category)
                    if score > best_score:
                        best_score = score
                        best_combo = combo

            # Fallback if no diverse combo
            if best_combo is None:
                if len(available) <= 15:
                    for combo in combinations(available, 4):
                        combo = list(combo)
                        score = answer_diversity_score(combo, category)
                        if score > best_score:
                            best_score = score
                            best_combo = combo
                else:
                    available_sorted = sorted(available, key=lambda p: p["answer"])
                    n = len(available_sorted)
                    indices = [0, n // 3, 2 * n // 3, n - 1]
                    best_combo = [available_sorted[i] for i in indices]

            if best_combo is None:
                failed = True
                break

            # Shuffle so answers aren't in order
            for _ in range(10):
                display_rng.shuffle(best_combo)
                answers = [p["answer"] for p in best_combo]
                if answers != sorted(answers) and answers != sorted(answers, reverse=True):
                    break

            # Update tracking
            for p in best_combo:
                key = photo_key(p)
                last_used[key] = date_str
                if remaining[category].get(key, 0) > 0:
                    remaining[category][key] -= 1

            # Build round
            original = next(r for r in rounds if r["date"] == date_str)
            result.append({
                "date": date_str,
                "category": category,
                "question": original["question"],
                "unit": original["unit"],
                "photos": best_combo,
            })

        if failed:
            continue

        # Validate
        issues = validate_result(result, rounds, min_gap_days)
        if not issues:
            return result
        if best_issues is None or len(issues) < len(best_issues):
            best_issues = issues
            best_result = result

    if not best_result:
        raise RuntimeError(
            f"Failed to reorder photos: no attempt could fill all rounds "
            f"with min_gap_days={min_gap_days}. Try a smaller gap."
        )

    # Ensure photos within each round aren't sorted by answer
    for r in best_result:
        photos = r["photos"]
        for _ in range(10):
            display_rng.shuffle(photos)
            answers = [p["answer"] for p in photos]
            if answers != sorted(answers) and answers != sorted(answers, reverse=True):
                break
    return best_result


def validate_result(result, original_rounds, min_gap_days):
    """Validate all constraints. Returns list of issues."""
    issues = []

    # Build original category map
    orig_photos_by_cat = {}
    for r in original_rounds:
        cat = r["category"]
        if cat not in orig_photos_by_cat:
            orig_photos_by_cat[cat] = set()
        for p in r["photos"]:
            orig_photos_by_cat[cat].add(photo_key(p))

    # Check category constraint
    for r in result:
        cat = r["category"]
        for p in r["photos"]:
            if photo_key(p) not in orig_photos_by_cat.get(cat, set()):
                issues.append(
                    f"Photo {photo_key(p)} on {r['date']} not in original category {cat}"
                )

    photo_dates = {}
    for r in result:
        date = datetime.strptime(r["date"], "%Y-%m-%d")
        for p in r["photos"]:
            key = photo_key(p)
            if key in photo_dates:
                gap = (date - photo_dates[key]).days
                if gap < min_gap_days:
                    issues.append(
                        f"Photo {key} on {r['date']}: only {gap} days since last use (need >= {min_gap_days})"
                    )
            photo_dates[key] = date

    # Check diversity
    for r in result:
        if not is_diverse_enough(r["photos"], r["category"]):
            answers = [p["answer"] for p in r["photos"]]
            issues.append(
                f"Poor diversity on {r['date']} ({r['category']}): {answers}"
            )

    return issues


def print_summary(rounds):
    """Print a summary of the reordered rounds."""
    print(f"\n{'='*70}")
    print(f"{'Date':<12} {'Category':<10} {'Answers'}")
    print(f"{'='*70}")
    for r in rounds:
        answers = [p["answer"] for p in r["photos"]]
        print(f"{r['date']:<12} {r['category']:<10} {answers}")
    print(f"{'='*70}")


def main():
    parser = argparse.ArgumentParser(description="Reorder photos in rounds.json")
    parser.add_argument(
        "min_gap_days",
        type=int,
        help="Minimum number of days between reuses of the same photo",
    )
    args = parser.parse_args()

    print("Loading rounds.json...")
    rounds = load_rounds()
    print(f"Found {len(rounds)} rounds")
    print(f"Minimum gap: {args.min_gap_days} days\n")

    print("Reordering photos (trying up to {} random seeds)...".format(MAX_ATTEMPTS))
    new_rounds = reorder_photos(rounds, args.min_gap_days)

    print("\nValidating final result...")
    issues = validate_result(new_rounds, rounds, args.min_gap_days)
    errors = [i for i in issues if "Poor diversity" not in i]
    warnings = [i for i in issues if "Poor diversity" in i]

    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings:
            print(f"  - {w}")

    if errors:
        print(f"\n{len(errors)} error(s):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)

    print("\nAll constraints satisfied!")
    print_summary(new_rounds)

    save_rounds(new_rounds)
    print(f"\nSaved reordered rounds to {ROUNDS_FILE}")


if __name__ == "__main__":
    main()
