import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { openNodeDb } from '../server/core/db-node.js';
import { createApp } from '../server/app.js';

let server, base, cfg, clock = 1_000_000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-test-'));

before(async () => {
  cfg = loadConfig({ server: { backupDir: path.join(tmp, 'backups') }, admin: { password: 'pw' } });
  const app = createApp(cfg, openNodeDb(':memory:'), { now: () => clock });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function post(url, body, headers = {}) {
  const r = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
async function get(url, headers = {}) {
  const r = await fetch(base + url, { headers });
  return { status: r.status, body: await r.json() };
}

const reg = (username, terminalId = 'A', password = 'pass1234', extra = {}) => post('/api/register', { username, password, terminalId, ...extra });
const login = (username, terminalId = 'A', password = 'pass1234') => post('/api/login', { username, password, terminalId });

test('新規登録：初期チップ・同じ名前は使えない・NGワード・パスワードの長さ', async () => {
  const r = await reg('たろう');
  assert.equal(r.status, 200);
  assert.equal(r.body.player.chips, 100);
  assert.equal(r.body.player.nickname, 'たろう');
  // 同じ名前＋同じパスワードは区別できないので登録できない（空白・全角半角・大小文字の違いも同じ名前）
  assert.equal((await reg('たろう', 'B')).status, 409);
  assert.equal((await reg(' たろう ', 'B')).status, 409);
  assert.equal((await reg('ＡＢＣ', 'B')).status, 200);
  assert.equal((await reg('abc', 'C')).status, 409);
  // パスワードが違えば同じ名前でも登録できる
  const t2 = await reg('たろう', 'E', 'other-pw');
  assert.equal(t2.status, 200);
  assert.notEqual(t2.body.player.id, r.body.player.id);
  assert.equal((await reg('バカ太郎', 'B')).status, 400);
  assert.equal((await reg('12345678901', 'B')).status, 400);
  assert.equal((await reg('みじかい', 'B', '123')).status, 400);
  assert.equal((await reg('ぜんかく', 'B', 'ぱすわーど')).status, 400);
  const chk = await get(`/api/name-check?name=${encodeURIComponent('たろう')}`);
  assert.equal(chk.body.ok, true);
  assert.equal(chk.body.same, true);
  // ログインはパスワードで本人を区別する
  await post('/api/logout', { playerId: t2.body.player.id, token: t2.body.token });
  assert.equal((await login('たろう', 'F', 'other-pw')).body.player.id, t2.body.player.id);
  assert.equal((await get(`/api/name-check?name=${encodeURIComponent('じろう')}`)).body.ok, true);
});

test('ログイン：パスワード確認', async () => {
  await reg('ログイン君', 'L1', 'secret1');
  assert.equal((await login('ログイン君', 'L1', 'wrong')).status, 401);
  assert.equal((await login('いない人', 'L1', 'secret1')).status, 401);
  const ok = await login('ログイン君', 'L1', 'secret1');
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
});

test('2台同時ロックとタイムアウト解除', async () => {
  const a = await reg('じろう', 'A');
  assert.equal(a.status, 200);
  const b = await login('じろう', 'B');
  assert.equal(b.status, 423);
  clock += cfg.session.lockTimeoutSec * 1000 + 1;
  const b2 = await login('じろう', 'B');
  assert.equal(b2.status, 200);
  // 古い端末のトークンは無効
  const hb = await post('/api/heartbeat', { playerId: a.body.player.id, token: a.body.token });
  assert.equal(hb.status, 409);
});

test('ラウンド精算・ロスカット', async () => {
  const { body: { token, player } } = await reg('さぶろう', 'C');
  const auth = { playerId: player.id, token };

  assert.equal((await post('/api/round/start', { ...auth, game: 'blackjack', bet: 5, leverage: 1 })).status, 400);
  assert.equal((await post('/api/round/start', { ...auth, game: 'blackjack', bet: 10, leverage: 3 })).status, 400);
  let s = await post('/api/round/start', { ...auth, game: 'blackjack', bet: 20, leverage: 2 });
  assert.equal(s.status, 200);
  let f = await post('/api/round/finish', { ...auth, roundId: s.body.roundId, result: { outcome: 'blackjack' } });
  assert.equal(f.body.delta, 60); // 20 * 1.5 * 2
  assert.equal(f.body.player.chips, 160);
  assert.equal(f.body.player.peakChips, 160);
  // 同じラウンドは二重精算できない
  assert.equal((await post('/api/round/finish', { ...auth, roundId: s.body.roundId, result: { outcome: 'win' } })).status, 404);

  s = await post('/api/round/start', { ...auth, game: 'baccarat', bet: 100, leverage: 10 });
  f = await post('/api/round/finish', { ...auth, roundId: s.body.roundId, result: { choice: 'player', winner: 'banker' } });
  assert.equal(f.body.delta, -160); // 損失は所持チップまで
  assert.equal(f.body.losscut, true);
  assert.equal(f.body.player.chips, 0);
  assert.equal(f.body.player.peakChips, 160);
  assert.equal(f.body.player.losscutCount, 1);

  // チップ0のまま遊び続けることはできない
  assert.equal((await post('/api/round/start', { ...auth, game: 'blackjack', bet: 10, leverage: 1 })).status, 400);
  // ログインし直しても 0 のまま（やり直しを案内）
  const again = await login('さぶろう', 'C');
  assert.equal(again.body.status, 'no_chips');
  const auth2 = { playerId: player.id, token: again.body.token };
  // 最初からやり直す：チップは初期値に戻り、最高記録は残る
  const rs = await post('/api/restart', auth2);
  assert.equal(rs.status, 200);
  assert.equal(rs.body.player.chips, 100);
  assert.equal(rs.body.player.peakChips, 160);
  assert.equal((await post('/api/restart', auth2)).status, 400); // チップがあるうちはできない
});

test('途中放棄は負け扱い・ホールデムの持ち込み精算', async () => {
  const { body: { token, player } } = await reg('はなこ', 'D');
  const auth = { playerId: player.id, token };
  await post('/api/round/start', { ...auth, game: 'pinball', bet: 10, leverage: 5 });
  const a = await post('/api/round/abort', { ...auth, reason: 'idle' });
  assert.equal(a.body.delta, -50);
  const s = await post('/api/round/start', { ...auth, game: 'holdem', bet: 20, leverage: 2 });
  assert.equal((await post('/api/round/finish', { ...auth, roundId: s.body.roundId, result: { finalStack: 999 } })).status, 400);
  const f = await post('/api/round/finish', { ...auth, roundId: s.body.roundId, result: { finalStack: 35 } });
  assert.equal(f.body.delta, 30); // (35-20)*2
});

test('管理画面：VRボーナス1日1回・取消・パスワード再設定・名前変更', async () => {
  assert.equal((await post('/api/admin/login', { password: 'x' })).status, 401);
  const { body: { token } } = await post('/api/admin/login', { password: 'pw' });
  const h = { 'x-admin-token': token };
  assert.equal((await get('/api/admin/stats')).status, 401);

  const hanako = encodeURIComponent('はなこ');
  let r = await post(`/api/admin/players/${hanako}/chips`, { kind: 'vr_bonus' }, h);
  assert.equal(r.status, 200);
  assert.equal(r.body.delta, 50);
  r = await post(`/api/admin/players/${hanako}/chips`, { kind: 'vr_bonus' }, h);
  assert.equal(r.status, 400);
  assert.equal((await post(`/api/admin/players/${hanako}/chips`, { kind: 'revive' }, h)).status, 400); // 復活は廃止
  assert.equal((await post(`/api/admin/players/${encodeURIComponent('いない人')}/chips`, { kind: 'vr_bonus' }, h)).status, 404);

  const detail = await get(`/api/admin/players/${hanako}`, h);
  const vr = detail.body.transactions.find((t) => t.game === 'vr_bonus');
  r = await post(`/api/admin/transactions/${vr.id}/revert`, {}, h);
  assert.equal(r.body.delta, -50);
  assert.equal((await post(`/api/admin/transactions/${vr.id}/revert`, {}, h)).status, 400);
  // 取り消したのでもう一度付与できる
  assert.equal((await post(`/api/admin/players/${hanako}/chips`, { kind: 'vr_bonus' }, h)).status, 200);

  // パスワード再設定
  assert.equal((await post(`/api/admin/players/${hanako}/password`, { password: 'new-pass' }, h)).status, 200);
  assert.equal((await login('はなこ', 'D', 'pass1234')).status, 401);
  // 同じ名前が2人いると名前では特定できない
  assert.equal((await get(`/api/admin/players/${encodeURIComponent('たろう')}`, h)).status, 409);
  assert.equal((await post(`/api/admin/players/${hanako}/update`, { nickname: 'はなこ2' }, h)).status, 200);
  assert.equal((await post(`/api/admin/players/${encodeURIComponent('はなこ2')}/unlock`, {}, h)).status, 200);
  assert.equal((await login('はなこ2', 'D', 'new-pass')).status, 200);

  const rank = await get('/api/ranking');
  assert.equal(rank.body.ranking[0].nickname, 'さぶろう');
  assert.ok(!('id' in rank.body.ranking[0]));

  r = await post('/api/admin/reset', { confirm: 'RESET' }, h);
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(r.body.backup));
  assert.equal((await get('/api/ranking')).body.ranking.length, 0);
});
