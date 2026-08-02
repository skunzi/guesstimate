#!/usr/bin/env python3
"""
Rearranges rounds in rounds.json to follow a fixed category pattern starting from 2026-07-08.

Pattern: how_tall -> how_old -> how_many -> how_old -> (repeat)

Each round keeps its original content (photos, answers, question, unit) but gets
reassigned to a new date slot matching the category pattern.

Constraint: If a photo appears in multiple rounds, those rounds must be separated
by at least 7 days.
"""

import json
from datetime import date, timedelta
from pathlib import Path

ROUNDS_PATH = Path(__file__).parent.parent / "data" / "rounds.json"
START_DATE = date(2026, 7, 8)
CATEGORY_PATTERN = ["how_tall", "how_old", "how_many", "how_old"]
MIN_PHOTO_SEPARATION_DAYS = 7


def get_photos(round_data):
    return {p["file"] for p in round_data["photos"]}


def has_photo_conflict(candidate_round, current_date, placed_rounds):
    """Check if placing candidate_round on current_date would violate the separation constraint."""
    candidate_photos = get_photos(candidate_round)
    for placed in placed_rounds:
        placed_date = date.fromisoformat(placed["date"])
        day_diff = abs((current_date - placed_date).days)
        if day_diff < MIN_PHOTO_SEPARATION_DAYS:
            placed_photos = get_photos(placed)
            if candidate_photos & placed_photos:
                return True
    return False


def main():
    with open(ROUNDS_PATH) as f:
        rounds = json.load(f)

    pools = {"how_tall": [], "how_old": [], "how_many": []}
    for r in rounds:
        pools[r["category"]].append(r)

    print(f"Available rounds: how_tall={len(pools['how_tall'])}, "
          f"how_old={len(pools['how_old'])}, how_many={len(pools['how_many'])}")

    total_input = sum(len(p) for p in pools.values())

    result = []
    current_date = START_DATE
    pattern_idx = 0
    skipped = []
    pattern_deviations = 0

    while any(pools[cat] for cat in pools):
        preferred_category = CATEGORY_PATTERN[pattern_idx % len(CATEGORY_PATTERN)]

        categories_to_try = [preferred_category] + [c for c in pools if c != preferred_category]

        placed = False
        for cat in categories_to_try:
            if not pools[cat]:
                continue
            for i, candidate in enumerate(pools[cat]):
                if not has_photo_conflict(candidate, current_date, result):
                    if cat != preferred_category:
                        pattern_deviations += 1
                    round_data = pools[cat].pop(i)
                    round_data["date"] = current_date.isoformat()
                    result.append(round_data)
                    placed = True
                    break
            if placed:
                break

        if not placed:
            skipped.append((current_date.isoformat(), preferred_category))

        current_date += timedelta(days=1)
        pattern_idx += 1

    assert len(result) == total_input, (
        f"Lost rounds! Input had {total_input} rounds but output has {len(result)}. "
        f"This should never happen."
    )

    if pattern_deviations:
        print(f"\n{pattern_deviations} date(s) deviated from the preferred category pattern "
              f"(due to pool exhaustion or photo conflicts).")

    if skipped:
        print(f"\nSkipped {len(skipped)} date slots due to photo conflicts:")
        for dt, cat in skipped:
            print(f"  {dt} - needed {cat}")

    with open(ROUNDS_PATH, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {len(result)} rounds to {ROUNDS_PATH}")
    print("\nNew schedule:")
    for r in result:
        print(f"  {r['date']} - {r['category']}")

    # Verify photo separation
    print("\nVerifying photo separation...")
    photo_dates = {}
    violations = 0
    for r in result:
        rd = date.fromisoformat(r["date"])
        for p in r["photos"]:
            if p["file"] in photo_dates:
                prev_date = photo_dates[p["file"]]
                diff = abs((rd - prev_date).days)
                if diff < MIN_PHOTO_SEPARATION_DAYS:
                    print(f"  VIOLATION: {p['file']} on {r['date']} and "
                          f"{prev_date.isoformat()} ({diff} days apart)")
                    violations += 1
            photo_dates[p["file"]] = rd

    if violations == 0:
        print("  All photos separated by at least 7 days. ✓")
    else:
        print(f"  {violations} violation(s) found!")


if __name__ == "__main__":
    main()
