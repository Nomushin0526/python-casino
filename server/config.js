// 設定ファイルの読み込み（config.json に config.local.json を深くマージ）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepMerge } from './core/public-config.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

export { publicConfig } from './core/public-config.js';
