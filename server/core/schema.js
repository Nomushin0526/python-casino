// データベースの構造（PC版の SQLite と Cloudflare D1 で共通）
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id              TEXT PRIMARY KEY,
  nickname        TEXT,
  name_key        TEXT,
  password_hash   TEXT,
  chips           INTEGER NOT NULL,
  peak_chips      INTEGER NOT NULL,
  losscut_count   INTEGER NOT NULL DEFAULT 0,
  active_session  TEXT,
  session_token   TEXT,
  session_seen_at INTEGER,
  easy_mode       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     TEXT NOT NULL,
  game          TEXT NOT NULL,
  bet           INTEGER,
  leverage      INTEGER,
  multiplier    REAL,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  detail        TEXT,
  terminal      TEXT,
  reverted_by   INTEGER,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL UNIQUE,
  game       TEXT NOT NULL,
  bet        INTEGER NOT NULL,
  leverage   INTEGER NOT NULL,
  terminal   TEXT,
  started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_player ON transactions(player_id, id);
CREATE INDEX IF NOT EXISTS idx_tx_game_date ON transactions(game, created_at);
CREATE INDEX IF NOT EXISTS idx_players_peak ON players(peak_chips DESC);
CREATE INDEX IF NOT EXISTS idx_players_namekey ON players(name_key);
`;

// SQL文に分割（D1 の batch 用）
export const SCHEMA_STATEMENTS = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
