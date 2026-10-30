// PC版：Node.js 標準の node:sqlite を、共通の非同期インターフェースで包む
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema.js';

export function openNodeDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  // QRカード版の古いDBからの移行（列とテーブルを足す）
  const has = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'players'").get();
  if (has) {
    const cols = raw.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
    if (!cols.includes('name_key')) raw.exec('ALTER TABLE players ADD COLUMN name_key TEXT');
    if (!cols.includes('password_hash')) raw.exec('ALTER TABLE players ADD COLUMN password_hash TEXT');
    raw.exec('DROP INDEX IF EXISTS idx_players_name');
  }
  raw.exec(SCHEMA);
  return nodeAdapter(raw);
}

export function nodeAdapter(raw) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const runOne = (sql, params) => {
    const r = stmt(sql).run(...params);
    return { lastId: Number(r.lastInsertRowid), changes: Number(r.changes) };
  };
  return {
    raw,
    async get(sql, ...params) { return stmt(sql).get(...params) || null; },
    async all(sql, ...params) { return stmt(sql).all(...params); },
    async run(sql, ...params) { return runOne(sql, params); },
    // まとめて実行（全部成功か全部失敗）
    async batch(list) {
      raw.exec('BEGIN');
      try {
        const out = list.map(([sql, params = []]) => runOne(sql, params));
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    close() { raw.close(); },
  };
}
