// SQLite（Node.js 標準の node:sqlite を使用。追加のネイティブモジュール不要）
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const NOW = "strftime('%Y-%m-%d %H:%M:%S','now','localtime')";

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS players (
      id              TEXT PRIMARY KEY,
      nickname        TEXT,
      chips           INTEGER NOT NULL,
      peak_chips      INTEGER NOT NULL,
      losscut_count   INTEGER NOT NULL DEFAULT 0,
      active_session  TEXT,
      session_token   TEXT,
      session_seen_at INTEGER,
      easy_mode       INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (${NOW}),
      updated_at      TEXT NOT NULL DEFAULT (${NOW})
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id     TEXT NOT NULL REFERENCES players(id),
      game          TEXT NOT NULL,
      bet           INTEGER,
      leverage      INTEGER,
      multiplier    REAL,
      delta         INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      detail        TEXT,
      terminal      TEXT,
      reverted_by   INTEGER,
      created_at    TEXT NOT NULL DEFAULT (${NOW})
    );
    CREATE INDEX IF NOT EXISTS idx_tx_player ON transactions(player_id, id);
    CREATE INDEX IF NOT EXISTS idx_tx_game_date ON transactions(game, created_at);
    CREATE INDEX IF NOT EXISTS idx_players_peak ON players(peak_chips DESC);
  `);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export class Store {
  constructor(db) {
    this.db = db;
    const q = (sql) => db.prepare(sql);
    this.s = {
      get: q('SELECT * FROM players WHERE id = ?'),
      insert: q('INSERT INTO players (id, chips, peak_chips) VALUES (?, ?, ?)'),
      setChips: q(`UPDATE players SET chips = ?, peak_chips = MAX(peak_chips, ?), losscut_count = losscut_count + ?, updated_at = ${NOW} WHERE id = ?`),
      addTx: q(`INSERT INTO transactions (player_id, game, bet, leverage, multiplier, delta, balance_after, detail, terminal)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      countToday: q(`SELECT COUNT(*) AS n FROM transactions
                     WHERE player_id = ? AND game = ? AND reverted_by IS NULL AND substr(created_at, 1, 10) = date('now','localtime')`),
    };
  }

  getPlayer(id) {
    return this.s.get.get(id) || null;
  }

  createPlayer(id, initialChips, terminal = null) {
    return tx(this.db, () => {
      const existing = this.getPlayer(id);
      if (existing) return existing;
      this.s.insert.run(id, initialChips, initialChips);
      this.s.addTx.run(id, 'initial', null, null, null, initialChips, initialChips, null, terminal);
      return this.getPlayer(id);
    });
  }

  // チップを増減して transactions に記録する（必ずこの関数を通す）
  applyDelta(id, { game, delta, bet = null, leverage = null, multiplier = null, detail = null, terminal = null, countLosscut = false }) {
    return tx(this.db, () => this.applyDeltaNoTx(id, { game, delta, bet, leverage, multiplier, detail, terminal, countLosscut }));
  }

  applyDeltaNoTx(id, { game, delta, bet = null, leverage = null, multiplier = null, detail = null, terminal = null, countLosscut = false }) {
    const p = this.getPlayer(id);
    if (!p) throw new Error('player not found');
    const d = Math.max(Math.trunc(delta), -p.chips);
    const after = p.chips + d;
    const losscut = countLosscut && p.chips > 0 && after <= 0 ? 1 : 0;
    this.s.setChips.run(after, after, losscut, id);
    const r = this.s.addTx.run(id, game, bet, leverage, multiplier, d, after,
      detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail), terminal);
    return { player: this.getPlayer(id), delta: d, losscut: !!losscut, txId: Number(r.lastInsertRowid) };
  }

  countToday(id, game) {
    return this.s.countToday.get(id, game).n;
  }
}
