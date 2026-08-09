-- Mr. Burger backend schema (Cloudflare D1 / SQLite)

-- One row per player. `id` is a random token minted on first play and kept in
-- the browser; there are no passwords. Moving to another device is done with a
-- short-lived transfer code, not an account.
CREATE TABLE IF NOT EXISTS players (
  id           TEXT PRIMARY KEY,
  name         TEXT    NOT NULL DEFAULT 'Cook',
  save         TEXT,                          -- JSON blob, opaque to the server
  best_day     INTEGER NOT NULL DEFAULT 0,
  best_earned  INTEGER NOT NULL DEFAULT 0,    -- cents, lifetime takings
  updated_at   INTEGER NOT NULL DEFAULT 0
);

-- The leaderboard is "furthest day, then most money" - the index matches.
CREATE INDEX IF NOT EXISTS players_rank
  ON players (best_day DESC, best_earned DESC);

-- Transfer codes for moving a save to a second device. Short lived on purpose:
-- anyone holding a live code can claim the save.
CREATE TABLE IF NOT EXISTS link_codes (
  code       TEXT PRIMARY KEY,
  player_id  TEXT    NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS link_codes_expiry ON link_codes (expires_at);
