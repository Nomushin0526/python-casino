// 動いているサーバーに対する簡単な動作確認（PC版・Cloudflare版どちらにも使える）
//   node scripts/smoke.js http://localhost:3000 [管理パスワード]
//   node scripts/smoke.js https://xxxx.pages.dev 管理パスワード
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const adminPw = process.argv[3];
const name = 'sm' + Math.floor(Math.random() * 1e6);

async function call(method, path, body, headers = {}) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}
function check(label, cond, extra = '') {
  console.log(`${cond ? 'OK ' : 'NG '} ${label} ${extra}`);
  if (!cond) process.exitCode = 1;
}

const cfg = await call('GET', '/api/config');
check('設定を取得', cfg.status === 200 && cfg.json.games.pinball);
const reg = await call('POST', '/api/register', { username: name, password: 'pass1234', terminalId: 'SMOKE' });
check('新規登録', reg.status === 200 && reg.json.player.chips === cfg.json.chips.initial, JSON.stringify(reg.json).slice(0, 80));
const auth = { playerId: reg.json.player.id, token: reg.json.token };
const start = await call('POST', '/api/round/start', { ...auth, game: 'blackjack', bet: 10, leverage: 2 });
check('ゲーム開始', start.status === 200 && start.json.roundId);
const fin = await call('POST', '/api/round/finish', { ...auth, roundId: start.json.roundId, result: { outcome: 'win' } });
check('ゲーム精算（勝ち +20）', fin.status === 200 && fin.json.delta === 20, `chips=${fin.json?.player?.chips}`);
const again = await call('POST', '/api/round/finish', { ...auth, roundId: start.json.roundId, result: { outcome: 'win' } });
check('同じゲームは二重精算できない', again.status === 404);
await call('POST', '/api/round/start', { ...auth, game: 'pinball', bet: 10, leverage: 1 });
const ab = await call('POST', '/api/round/abort', { ...auth, reason: 'idle' });
check('途中放棄は負け', ab.status === 200 && ab.json.delta === -10);
await call('POST', '/api/logout', auth);
const bad = await call('POST', '/api/login', { username: name, password: 'wrong', terminalId: 'SMOKE2' });
check('パスワード違いは拒否', bad.status === 401);
const login = await call('POST', '/api/login', { username: name, password: 'pass1234', terminalId: 'SMOKE2' });
check('ログイン', login.status === 200 && login.json.player.chips === fin.json.player.chips - 10);
const rank = await call('GET', '/api/ranking');
check('ランキング', rank.status === 200 && rank.json.ranking.some((r) => r.nickname === name), `joinUrl=${rank.json.joinUrl}`);
const nc = await call('GET', `/api/name-check?name=${encodeURIComponent(name)}`);
check('名前チェック（同名あり）', nc.status === 200 && nc.json.same === true);
if (adminPw) {
  const al = await call('POST', '/api/admin/login', { password: adminPw });
  check('管理ログイン', al.status === 200 && al.json.token);
  const h = { 'x-admin-token': al.json.token };
  const vr = await call('POST', `/api/admin/players/${login.json.player.id}/chips`, { kind: 'vr_bonus' }, h);
  check('VRボーナス', vr.status === 200 && vr.json.delta === cfg.json.chips.vrBonus);
  const vr2 = await call('POST', `/api/admin/players/${login.json.player.id}/chips`, { kind: 'vr_bonus' }, h);
  check('VRボーナスは1日1回', vr2.status === 400);
  const ex = await call('GET', '/api/admin/export', undefined, h);
  check('データの書き出し', ex.status === 200 && ex.json.players.length > 0);
  const st = await call('GET', '/api/admin/stats', undefined, h);
  check('状況', st.status === 200 && st.json.totals.players > 0);
} else {
  const al = await call('POST', '/api/admin/login', { password: 'casino-admin' });
  console.log(`--  管理ログイン（パスワード未指定）: ${al.status} ${al.json?.message || ''}`);
}
await call('POST', '/api/logout', { playerId: login.json.player.id, token: login.json.token });
console.log(process.exitCode ? '一部失敗しました' : 'すべてOK');
