// ネット公開版（Cloudflare Pages）の初回セットアップ
//   npm run cf:setup
// 1. Cloudflare にログイン  2. データベース（D1）を作成  3. Pages プロジェクトを作成
// 4. 管理画面のパスワードを設定  5. 公開（デプロイ）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tomlPath = path.join(root, 'wrangler.toml');
let toml = fs.readFileSync(tomlPath, 'utf8');
const project = toml.match(/^name\s*=\s*"([^"]+)"/m)[1];
const dbName = toml.match(/database_name\s*=\s*"([^"]+)"/)[1];

const isWin = process.platform === 'win32';
function wrangler(args, { capture = false } = {}) {
  const r = spawnSync(isWin ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    cwd: root, encoding: 'utf8', stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit', shell: isWin,
  });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}
const step = (n, msg) => console.log(`\n========== ${n}. ${msg} ==========`);

step(1, 'Cloudflare にログイン');
if (!wrangler(['whoami'], { capture: true }).out.match(/You are logged in|associated with the email/i)) {
  console.log('ブラウザが開くので、Cloudflare のアカウントでログインして「Allow（許可）」を押してください');
  if (!wrangler(['login']).ok) { console.error('ログインできませんでした'); process.exit(1); }
} else {
  console.log('ログイン済みです');
}

step(2, `データベース（D1）「${dbName}」を用意`);
if (/database_id\s*=\s*"REPLACE_ME"/.test(toml)) {
  let id = null;
  const created = wrangler(['d1', 'create', dbName], { capture: true });
  console.log(created.out.trim());
  id = created.out.match(/"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/)?.[1];
  if (!id) {
    // すでにある場合は一覧から探す
    const list = wrangler(['d1', 'list', '--json'], { capture: true });
    try {
      const json = JSON.parse(list.out.slice(list.out.indexOf('[')));
      id = json.find((d) => d.name === dbName)?.uuid;
    } catch { /* 下でエラー */ }
  }
  if (!id) { console.error('データベースIDが取得できませんでした。上のメッセージを確認してください'); process.exit(1); }
  toml = toml.replace(/database_id\s*=\s*"REPLACE_ME"/, `database_id = "${id}"`);
  fs.writeFileSync(tomlPath, toml);
  console.log(`wrangler.toml に database_id = "${id}" を書き込みました`);
} else {
  console.log('wrangler.toml に設定済みです');
}

step(3, `Pages プロジェクト「${project}」を用意`);
const pc = wrangler(['pages', 'project', 'create', project, '--production-branch', 'main'], { capture: true });
console.log(pc.ok ? '作成しました' : (/already exists|exists/i.test(pc.out) ? 'すでにあります' : pc.out.trim()));

step(4, '管理画面のパスワードを設定');
console.log('「Enter a secret value:」と出たら、管理画面で使うパスワードを入力して Enter（入力した文字は表示されません）');
if (!wrangler(['pages', 'secret', 'put', 'ADMIN_PASSWORD', '--project-name', project]).ok) {
  console.error('パスワードを設定できませんでした（あとで npm run cf:password でも設定できます）');
}

step(5, '公開（デプロイ）');
const dep = wrangler(['pages', 'deploy', '--project-name', project, '--branch', 'main', '--commit-dirty=true'], { capture: true });
console.log(dep.out.trim());
if (!dep.ok) process.exit(1);
console.log(`\n公開しました！ 通常は https://${project}.pages.dev/ で遊べます（上に表示されたURLも確認してください）`);
console.log(`管理画面: https://${project}.pages.dev/admin`);
