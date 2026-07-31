#!/usr/bin/env python3
"""Validate photo reuse rules in data/rounds.json for pre-commit.

Rules:
1. An image must NOT appear twice in the same category.
2. An image used in different categories must be at least DESIRED_GAP_DAYS days apart.
"""

import json
import sys
from collections import defaultdict
from datetime import date

DESIRED_GAP_DAYS = 3

def validate():
    with open("data/rounds.json") as f:
        data = json.load(f)

    # Build mapping: file -> list of (date, category)
    usages = defaultdict(list)
    for rnd in data:
        rnd_date = date.fromisoformat(rnd["date"])
        cat = rnd["category"]
        for photo in rnd.get("photos", []):
            usages[photo["file"]].append((rnd_date, cat))

    errors_diff_cat = []
    errors_same_cat = []

    for file, appearances in sorted(usages.items()):
        if len(appearances) < 2:
            continue

        # Check rule 1: same category used twice
        cat_dates = defaultdict(list)
        for d, cat in appearances:
            cat_dates[cat].append(d)

        for cat, dates in cat_dates.items():
            if len(dates) > 1:
                dates_str = ", ".join(d.isoformat() for d in sorted(dates))
                errors_same_cat.append(
                    f'"{file}" used {len(dates)} times in category "{cat}": {dates_str}'
                )

        # Check rule 2: different categories < DESIRED_GAP_DAYS days apart
        sorted_appearances = sorted(appearances, key=lambda x: x[0])
        for i in range(len(sorted_appearances)):
            for j in range(i + 1, len(sorted_appearances)):
                d1, cat1 = sorted_appearances[i]
                d2, cat2 = sorted_appearances[j]
                if cat1 == cat2:
                    continue
                gap = (d2 - d1).days
                if gap < DESIRED_GAP_DAYS:
                    errors_diff_cat.append(
                        f'"{file}" reused across categories only {gap} days apart: '
                        f"{cat1} on {d1.isoformat()} → {cat2} on {d2.isoformat()}"
                    )

    if errors_same_cat or errors_diff_cat:
        print(
            f"✗ Photo reuse validation failed ({len(errors_same_cat) + len(errors_diff_cat)} error(s)):",
            file=sys.stderr,
        )
        print("Photo used multiple times in the same category:", file=sys.stderr)
        for e in errors_same_cat:
            print(f"  • {e}", file=sys.stderr)
        print("Photo reused across different categories:", file=sys.stderr)
        for e in errors_diff_cat:
            print(f"  • {e}", file=sys.stderr)
        return 1

    print("✓ Photo reuse rules passed")
    return 0


if __name__ == "__main__":
    sys.exit(validate())
