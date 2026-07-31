#!/usr/bin/env python3
"""Validate data/rounds.json schema for pre-commit."""

import json
import re
import sys

VALID_CATEGORIES = {"how_many", "how_tall", "how_old"}
VALID_UNITS = {"people", "meters", "year"}


def validate():
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
                if "file" in p and not isinstance(p["file"], str):
                    errors.append(f"{pp}: file must be a string")

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
