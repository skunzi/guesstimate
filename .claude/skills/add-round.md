---
name: add-round
description: Process new photos from media/new/, research their details, and create a new round entry in data/rounds.json
whenToUse: When the user wants to add new game rounds from photos placed in media/new/
---

# Add Round from New Photos

This skill processes new photos that have been placed in `media/new/` subfolders and creates new round entries in `data/rounds.json`.

## Workflow

### 1. Scan `media/new/` subfolders

List all images in the subfolders of `media/new/`. The subfolder determines which categories the photo can be used in:

| Subfolder | Usable in categories |
|-----------|---------------------|
| `height` | `how_tall` only |
| `capacity` | `how_many` only |
| `age` | `how_old` only |
| `age_and_height` | `how_old` and `how_tall` |
| `capacity_and_height` | `how_many` and `how_tall` |
| `capacity_and_age` | `how_many` and `how_old` |

### 2. Identify each photo

Use the filename to identify what the image shows. Don't look at the image itself, only determine by the filename the content.

### 3. Research facts for each photo

For each identified subject, research and collect the data needed for its category:

- **`how_tall`** (`unit: "meters"`): Find the height in meters. The `answer` is an integer.
- **`how_many`** (`unit: "people"`): Find the seating/passenger capacity. The `answer` is an integer.
- **`how_old`** (`unit: "year"`): Find the construction/completion/release year. The `answer` is the year as integer (e.g. `1889`).

For photos in combo folders (e.g. `age_and_height`), collect ALL relevant data points — the photo may be used in multiple rounds.

Also find one interesting **fun fact** per photo — something surprising, non-obvious, or memorable about the subject. Keep it to one sentence.

### 4. Select photos for a round

Group exactly **4 photos** of the same category into a round. When selecting:

- Pick photos that create an interesting range of answers (e.g. small to large capacity, old to modern)
- Sort photos by answer value ascending within the round
- A single photo can appear in multiple rounds if it's in a combo folder

### 5. Determine the round date

Look at the last entry in `data/rounds.json` to find the most recent date, then assign the next consecutive date to the new round. If creating multiple rounds, assign consecutive dates.

### 6. Move used photos

Move each photo used in a round from `media/new/<subfolder>/` to `media/<subfolder>/`:

```bash
mv media/new/height/example.jpg media/height/example.jpg
```

Leave any unused photos in `media/new/` for future rounds.

### 7. Add the round entry to `data/rounds.json`

Append the new round(s) to the JSON array. Follow this exact schema:

```json
{
  "date": "YYYY-MM-DD",
  "category": "how_many" | "how_tall" | "how_old",
  "question": "How many people can it hold?" | "How tall is this structure?" | "How old is this?",
  "unit": "people" | "meters" | "year",
  "photos": [
    {
      "file": "<subfolder>/<filename>",
      "subject": "<Name>, <Location>",
      "answer": <integer>,
      "fun_fact": "<one sentence>"
    }
  ]
}
```

**Important details:**
- The `file` path is relative to `media/` (the destination folder, not `new/`)
- The `subject` format is `"Name, Location"` (e.g. `"Eiffel Tower, Paris"`)
- The `answer` is always an integer (no decimals, no strings)
- Each round has exactly 4 photos
- Photos within a round are ordered by answer ascending
- The category-specific question text must match exactly as shown above

### 8. Report to the user

After processing, report:
- Which rounds were created (date, category, subjects)
- Which photos remain unused in `media/new/`
- Any photos that couldn't be identified or researched
