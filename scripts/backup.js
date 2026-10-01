// DBのバックアップ（サーバー起動中でも安全にコピーできる）
//   node scripts/backup.js [保存先フォルダ]   例: node scripts/backup.js E:\casino-backup
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, ROOT } from '../server/config.js';

const cfg = loadConfig();
const src = path.resolve(ROOT, cfg.server.dbFile);
const dir = path.resolve(process.argv[2] || path.resolve(ROOT, cfg.server.backupDir));
if (!fs.existsSync(src)) {
  console.error(`DBファイルが見つかりません: ${src}`);
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const file = path.join(dir, `casino-${stamp}-usb.db`);
const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
const n = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
db.close();
console.log(`バックアップしました: ${file}（プレイヤー ${n} 人）`);
