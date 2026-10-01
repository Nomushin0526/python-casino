// 設定ファイルの読み込み（config.json に config.local.json を深くマージ）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function deepMerge(base, over) {
  if (Array.isArray(over) || typeof over !== 'object' || over === null) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = k in out && typeof out[k] === 'object' && !Array.isArray(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadConfig(overrides = {}) {
  let cfg = readJson(path.join(ROOT, 'config.json'));
  const localFile = process.env.CASINO_CONFIG || path.join(ROOT, 'config.local.json');
  if (fs.existsSync(localFile)) cfg = deepMerge(cfg, readJson(localFile));
  cfg = deepMerge(cfg, overrides);
  if (process.env.PORT) cfg.server.port = Number(process.env.PORT);
  return cfg;
}

// "_" で始まるキー（コメント）を取り除く
function stripComments(v) {
  if (Array.isArray(v)) return v.map(stripComments);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => [k, stripComments(x)]));
  }
  return v;
}

// フロントに渡してよい設定だけを抜き出す（パスワード・secretは除外）
export function publicConfig(cfg) {
  const games = {};
  for (const [id, g] of Object.entries(cfg.games)) if (g.enabled) games[id] = g;
  return stripComments({
    chips: cfg.chips,
    session: cfg.session,
    nickname: cfg.nickname,
    ranking: cfg.ranking,
    card: { idPrefix: cfg.card.idPrefix, idDigits: cfg.card.idDigits },
    games,
  });
}
