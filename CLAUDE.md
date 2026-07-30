# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Guesstimate" is a static browser-based daily guessing game. Players are shown photos and guess numeric values (capacity, height, or construction year). Each day presents a different category with 4 photos. Scoring uses exponential/linear decay based on guess accuracy (max 1000 points per photo, 4000 per round).

## Running

This is a static site with no build step. Serve with any HTTP server:

```bash
python3 -m http.server 8000
# or
npx serve .
```

A server is required because `game.js` fetches `data/rounds.json` at startup.

## Architecture

- **Single-page app** — `index.html` contains all views (game, calendar, stats), toggled via `.hidden`/`.active` classes
- **`js/game.js`** — entire game logic in one IIFE; handles round loading, scoring, navigation, localStorage persistence, and share functionality
- **`data/rounds.json`** — all game content; array of round objects keyed by date, each with a category, question, unit, and 4 photos with answers and fun facts
- **`css/style.css`** — dark theme with CSS custom properties
- **`media/`** — photo assets referenced by filename in rounds.json

## Key Implementation Details

- **Answer obfuscation**: Answers from `rounds.json` are encoded at load time via reversed base64 (`encode`/`decode` functions) to prevent casual inspection in devtools. The JSON itself stores raw numbers.
- **Scoring formula**: Varies by category — `how_many` and `how_tall` use exponential decay (`1000 * exp(-k * errorRatio)`), `how_old` uses linear decay (`1000 * (1 - errorRatio * k)`). Constants in `SCORE_CONSTANTS`.
- **Storage**: All player data in localStorage under key `guessit_data` — structure is `{ played: { [date]: { scores, guesses, total, category, playedAt } } }`.
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
Photos go in `media/`. Each round must have exactly 4 photos. A single photo can appear in multiple rounds under different categories.
