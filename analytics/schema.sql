CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  round_date TEXT,
  photo_index INTEGER,
  category TEXT,
  score INTEGER,
  guess INTEGER,
  answer INTEGER,
  time_to_guess_ms INTEGER,
  round_hash TEXT,
  total_score INTEGER,
  reset_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_round ON events(round_date);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(created_at);
