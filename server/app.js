// PC版：Express で静的ファイルを配り、/api は共通のAPI本体（core/api.js）に渡す
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { ROOT } from './config.js';
import { createApi } from './core/api.js';

// スマホから接続するためのURL（同じWi-Fi内のアドレス）
function lanUrl(port) {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  const lan = ips.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) || ips[0];
  return lan ? `http://${lan}:${port}/` : null;
}

// db: core/db-node.js の openNodeDb() の戻り値
export function createApp(cfg, db, { now = () => Date.now() } = {}) {
  const api = createApi(cfg, db, { now });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // DBファイルのバックアップ（PC版だけの機能）
  function backupTo(dir, label = 'manual') {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date(now()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const file = path.join(dir, `casino-${stamp}-${label}.db`);
    db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    return file;
  }
  app.locals.backupTo = backupTo;
  const backupDir = path.resolve(ROOT, cfg.server.backupDir);
  const adminToken = (req) => req.get('x-admin-token') || req.query.token;

  app.post('/api/admin/backup', async (req, res) => {
    try {
      await api.checkAdmin(adminToken(req));
      res.json({ file: backupTo(backupDir) });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.code || 'BACKUP_FAILED', message: e.message });
    }
  });
  app.get('/api/admin/backup/download', async (req, res) => {
    try {
      await api.checkAdmin(adminToken(req));
      const file = backupTo(backupDir, 'download');
      res.download(file, path.basename(file));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.code || 'BACKUP_FAILED', message: e.message });
    }
  });
  // リセット前には必ずバックアップを取る
  app.post('/api/admin/reset', async (req, res, next) => {
    try {
      await api.checkAdmin(adminToken(req));
      if (req.body?.confirm === 'RESET') req.backupFile = backupTo(backupDir, 'before-reset');
      next();
    } catch (e) {
      res.status(e.status || 500).json({ error: e.code, message: e.message });
    }
  });

  app.use('/api', async (req, res) => {
    const out = await api.handle({
      method: req.method,
      path: req.path,
      query: new URLSearchParams(req.query),
      body: req.body,
      adminToken: adminToken(req),
      joinUrl: lanUrl(cfg.server.port),
    });
    if (req.backupFile && out.status === 200) out.json.backup = req.backupFile;
    res.status(out.status).json(out.json);
  });

  // ---------- 静的ファイル（外部CDNは使わない） ----------
  const pub = path.join(ROOT, 'public');
  app.use(express.static(pub, { extensions: ['html'] }));

  return app;
}
