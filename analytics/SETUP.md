# Analytics Worker Setup

## 1. Create the D1 database

```bash
cd analytics
npm run db:create
```

Copy the `database_id` from the output into `wrangler.toml`.

## 2. Run the schema migration

```bash
# For local development:
npm run db:migrate:local

# For production:
npm run db:migrate
```

## 3. Set the endpoint in the frontend

Edit `js/analytics.js` and set `ANALYTICS_ENDPOINT` to your Worker URL:

```js
var ANALYTICS_ENDPOINT = 'https://guessit-analytics.<your-subdomain>.workers.dev';
```

## 4. Local development

```bash
npm run dev
```

This starts the Worker locally with a local D1 SQLite database. Set `ANALYTICS_ENDPOINT` to `http://localhost:8787` for testing.

## 5. Deploy

```bash
npm run deploy
```

## Querying data

```bash
# Local
npm run db:query:local "SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type"

# Production
npm run db:query "SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type"
```

## Event types

| Event | Fields | Description |
|-------|--------|-------------|
| `game_start` | round_date, category, round_hash | Player starts a round |
| `guess_submit` | round_date, photo_index, category, score, guess, answer, time_to_guess_ms, round_hash | Player submits a guess |
| `game_complete` | round_date, category, total_score, round_hash | Player finishes all 4 photos |
| `progress_reset` | reset_count | Player resets all progress |

## Useful queries

```sql
-- Average score per round
SELECT round_date, AVG(total_score) as avg_score, COUNT(DISTINCT user_id) as players
FROM events WHERE event_type = 'game_complete'
GROUP BY round_date ORDER BY round_date DESC;

-- Hardest photos (lowest avg score)
SELECT round_date, photo_index, AVG(score) as avg_score, COUNT(*) as guesses
FROM events WHERE event_type = 'guess_submit'
GROUP BY round_date, photo_index ORDER BY avg_score ASC LIMIT 20;

-- Average time to guess by category
SELECT category, AVG(time_to_guess_ms) / 1000.0 as avg_seconds
FROM events WHERE event_type = 'guess_submit' AND time_to_guess_ms IS NOT NULL
GROUP BY category;

-- Daily active users
SELECT DATE(created_at) as day, COUNT(DISTINCT user_id) as users
FROM events GROUP BY day ORDER BY day DESC LIMIT 30;

-- Export all data as CSV-friendly output
SELECT * FROM events ORDER BY created_at;
```
