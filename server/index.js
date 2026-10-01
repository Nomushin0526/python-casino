// サーバー起動スクリプト
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig, ROOT } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const cfg = loadConfig();
const dbFile = path.resolve(ROOT, cfg.server.dbFile);
const db = openDb(dbFile);
const app = createApp(cfg, db);

if (cfg.admin.password === 'casino-admin' || cfg.card.secret === 'change-me-before-printing') {
  console.warn('\n[注意] 管理パスワードまたはカードのsecretが初期値のままです。config.local.json で変更してください。\n');
}

// 自動バックアップ（古いものは削除）
const backupDir = path.resolve(ROOT, cfg.server.backupDir);
function autoBackup() {
  try {
    const file = app.locals.backupTo(backupDir, 'auto');
    const autos = fs.readdirSync(backupDir).filter((f) => f.endsWith('-auto.db')).sort();
    for (const f of autos.slice(0, Math.max(0, autos.length - cfg.server.autoBackupKeep))) fs.unlinkSync(path.join(backupDir, f));
    console.log(`[backup] ${path.relative(ROOT, file)}`);
  } catch (e) {
    console.error('[backup] 失敗:', e.message);
  }
}
if (cfg.server.autoBackupMinutes > 0) setInterval(autoBackup, cfg.server.autoBackupMinutes * 60e3).unref();

const server = app.listen(cfg.server.port, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  const line = '='.repeat(60);
  console.log(line);
  console.log(' 学祭カジノ サーバー起動しました（このウィンドウは閉じないでください）');
  console.log(line);
  console.log(` このPC      : http://localhost:${cfg.server.port}/`);
  for (const ip of ips) console.log(` 他のPCから  : http://${ip}:${cfg.server.port}/`);
  console.log(` ランキング  : http://localhost:${cfg.server.port}/ranking`);
  console.log(` 管理画面    : http://localhost:${cfg.server.port}/admin`);
  console.log(` DBファイル  : ${dbFile}`);
  console.log(line);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[エラー] ポート ${cfg.server.port} は使用中です。サーバーが既に起動していないか確認してください。`);
  } else {
    console.error('[エラー] サーバーを起動できません:', e.message);
  }
  process.exit(1);
});

function shutdown() {
  console.log('\n終了します。最終バックアップを作成中...');
  autoBackup();
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown); // Windows でコンソールを閉じたとき
