#!/usr/bin/env python3
"""Validate data/rounds.json schema for pre-commit."""

import json
import os
import re
import sys

VALID_CATEGORIES = {"how_many", "how_tall", "how_old"}
VALID_UNITS = {"people", "meters", "year"}

GAME_JS = "js/game.js"
MEDIA_DIR = "media"


def parse_slider_ranges():
    """Parse slider min/max per category from getSliderConfig() in game.js."""
    import re

    with open(GAME_JS) as f:
        source = f.read()

    match = re.search(
        r"function getSliderConfig\(category\)\s*\{(.+?)\n  \}", source, re.DOTALL
    )
    if not match:
        print("✗ Could not find getSliderConfig() in " + GAME_JS, file=sys.stderr)
        sys.exit(1)

    ranges = {}
    for cat in VALID_CATEGORIES:
        pattern = (
            rf"'{cat}'.*?min:\s*(\d+),\s*max:\s*(\d+)"
        )
        m = re.search(pattern, match.group(1), re.DOTALL)
        if not m:
            # The else branch covers how_many (no explicit category check)
            continue
        ranges[cat] = (int(m.group(1)), int(m.group(2)))

    # The else branch is the fallback — applies to categories not matched above
    else_match = re.search(r"\}\s*else\s*\{[^}]*min:\s*(\d+),\s*max:\s*(\d+)", match.group(1))
    if else_match:
        for cat in VALID_CATEGORIES:
            if cat not in ranges:
                ranges[cat] = (int(else_match.group(1)), int(else_match.group(2)))

    if not ranges:
        print("✗ Could not parse any slider ranges from " + GAME_JS, file=sys.stderr)
        sys.exit(1)

    return ranges


def validate():
    slider_ranges = parse_slider_ranges()

    with open("data/rounds.json") as f:
        data = json.load(f)

    errors = []

    if not isinstance(data, list):
        errors.append("Root must be a JSON array")
        report(errors)
        return 1

    seen_dates = set()
    for i, r in enumerate(data):
        prefix = f"rounds[{i}]"

        for key in ("date", "category", "question", "unit", "photos"):
            if key not in r:
                errors.append(f'{prefix}: missing required key "{key}"')

        date = r.get("date", "")
        if date:
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                errors.append(f'{prefix}: date "{date}" must be YYYY-MM-DD')
            if date in seen_dates:
                errors.append(f'{prefix}: duplicate date "{date}"')
            seen_dates.add(date)

        cat = r.get("category", "")
        if cat and cat not in VALID_CATEGORIES:
            errors.append(f'{prefix}: invalid category "{cat}"')

        unit = r.get("unit", "")
        if unit and unit not in VALID_UNITS:
            errors.append(f'{prefix}: invalid unit "{unit}"')

        photos = r.get("photos", [])
        if not isinstance(photos, list):
            errors.append(f"{prefix}: photos must be an array")
        elif len(photos) != 4:
            errors.append(f"{prefix}: must have exactly 4 photos (got {len(photos)})")
        else:
            for j, p in enumerate(photos):
                pp = f"{prefix}.photos[{j}]"
                for key in ("file", "subject", "answer", "fun_fact"):
                    if key not in p:
                        errors.append(f'{pp}: missing required key "{key}"')
                if "answer" in p and not isinstance(p["answer"], (int, float)):
                    errors.append(f"{pp}: answer must be a number")
                elif "answer" in p and cat in slider_ranges:
                    lo, hi = slider_ranges[cat]
                    ans = p["answer"]
                    if ans < lo or ans > hi:
                        errors.append(
                            f"{pp}: answer {ans} outside slider range "
                            f"[{lo}, {hi}] for category \"{cat}\""
                        )
                if "file" in p and not isinstance(p["file"], str):
                    errors.append(f"{pp}: file must be a string")
                elif "file" in p:
                    path = os.path.join(MEDIA_DIR, p["file"])
                    if not os.path.isfile(path):
                        errors.append(f'{pp}: media file "{path}" does not exist')

    if errors:
        report(errors)
        return 1

    print(f"✓ {len(data)} rounds validated successfully")
    return 0


def report(errors):
    print(f"✗ rounds.json validation failed ({len(errors)} error(s)):", file=sys.stderr)
    for e in errors:
        print(f"  • {e}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(validate())
