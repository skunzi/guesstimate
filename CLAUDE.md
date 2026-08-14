# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Guesstimate" is a static browser-based daily guessing game. Players are shown photos and guess numeric values (capacity, height, or construction year). Each day presents a different category with 4 photos. Scoring uses exponential decay based on guess accuracy (max 1000 points per photo, 4000 per round).

## Running

This is a static site with no build step. Serve with any HTTP server:

```bash
python3 -m http.server 8000
# or
npx serve .
```

A server is required because `game.js` fetches `data/rounds.json` at startup.

**Debug mode**: Append `?debug` to the URL when running on localhost — skips directly to the calendar view so you can test any round without waiting for the real date. Analytics are also suppressed on localhost.

## Linting

Pre-commit hooks run all checks automatically. To run manually:

```bash
npx eslint js/
npx stylelint css/
npx html-validate index.html
python3 scripts/validate-rounds.py
python3 scripts/validate-photo-reuse.py
```

Install hooks after cloning: `npm install` (the `prepare` script runs `pre-commit install`).

## Architecture

- **Single-page app** — `index.html` contains all views (game, calendar, stats, friends/leaderboard), toggled via `.hidden`/`.active` classes
- **`js/game.js`** (~1080 lines) — entire game logic in one IIFE; handles round loading, scoring, navigation, localStorage persistence, and share functionality
- **`js/analytics.js`** — event tracking client (IIFE); queues events until consent is granted, then flushes to the Cloudflare Worker API
- **`js/friends.js`** — leaderboard/friends UI (IIFE); calls the analytics worker API for user registration, leaderboards, and score submission
- **`data/rounds.json`** — all game content; array of round objects keyed by date
- **`css/style.css`** — single stylesheet, dark theme with CSS custom properties
- **`media/`** — photo assets referenced by filename in rounds.json

### Cross-file communication

The three JS files communicate via `window` globals:
- `analytics.js` exposes `window.GuessitAnalytics` (`.track()`, `.getOrCreateUserId()`, `.hashRound()`)
- `friends.js` exposes `window.GuessitFriends` (`.checkPendingJoin()`)
- `game.js` consumes both — checks their existence before calling

Load order in `index.html` matters: `analytics.js` → `friends.js` → `game.js`.

## Key Implementation Details

- **Answer obfuscation**: Answers from `rounds.json` are encoded at load time via reversed base64 (`encode`/`decode` functions) to prevent casual inspection in devtools. The JSON itself stores raw numbers.
- **Scoring formula**: All categories use exponential decay (`1000 * exp(-k * error)`). The `k` constants differ per category (defined in `SCORE_CONSTANTS`). For `how_old`, the error denominator is `max(60, currentYear - answer)` rather than the answer itself.
- **Slider ranges**: Each category has hard min/max bounds in `getSliderConfig()`. The `validate-rounds.py` script parses these from `game.js` and rejects answers outside the range — so if you change slider bounds, existing round answers may fail validation.
- **Storage**: All player data in localStorage under key `guessit_data` — structure is `{ played: { [date]: {...} }, inProgress: { [date]: {...} } }`. In-progress state is saved after each photo to survive page reloads.
- **Calendar**: Days with rounds show category color on left border; played days get a checkmark. Future rounds are visible but not playable.

## Adding New Rounds

Add entries to `data/rounds.json` following the existing schema:
```json
{
  "date": "YYYY-MM-DD",
  "category": "how_many" | "how_tall" | "how_old",
  "question": "...",
  "unit": "people" | "meters" | "year",
  "photos": [
    { "file": "filename.jpg", "subject": "Name, Location", "answer": 12345, "fun_fact": "..." }
  ]
}
```

Photos go in `media/`. Each round must have exactly 4 photos.

### Validation constraints enforced by pre-commit

- Answers must be numbers within the slider range for their category (`how_many`: 0–140000, `how_tall`: 1–900, `how_old`: 0–2030)
- Each media file referenced must exist in `media/`
- No duplicate dates
- **Photo reuse rules** (`validate-photo-reuse.py`): a photo must NOT appear twice in the same category; reuse across different categories requires at least 3 days gap

### Helper scripts

- `scripts/reorder_photos.py` — shuffles photo order within rounds while respecting reuse-gap and answer-spread constraints
- `scripts/rearrange_categories.py` — reorders rounds to balance category distribution

## JavaScript Conventions

- `sourceType: "script"` — no ES module import/export in frontend JS
- IIFE pattern wraps each file
- Globals (`localStorage`, `fetch`, `navigator`) declared in `.eslintrc.json`
- Backend analytics worker (`guesstimate_analytics/`) is a separate repo using ES modules
