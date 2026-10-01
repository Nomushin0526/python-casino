import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { cardCode } from '../server/codes.js';

let server, base, cfg, clock = 1_000_000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-test-'));

before(async () => {
  cfg = loadConfig({ server: { backupDir: path.join(tmp, 'backups') }, admin: { password: 'pw' }, card: { secret: 'test' } });
  const app = createApp(cfg, openDb(':memory:'), { now: () => clock });
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

test('不正なQRは拒否、正しいQRで初期チップ', async () => {
  assert.equal((await post('/api/login', { code: 'P0001', terminalId: 'A' })).status, 404);
  assert.equal((await post('/api/login', { code: 'P0001-ZZZZ', terminalId: 'A' })).status, 404);
  const r = await post('/api/login', { code: cardCode(cfg, 'P0001'), terminalId: 'A' });
  assert.equal(r.status, 200);
  assert.equal(r.body.player.chips, 100);
  assert.equal(r.body.player.needsNickname, true);
});

test('2台同時ロックとタイムアウト解除', async () => {
  const code = cardCode(cfg, 'P0002');
  const a = await post('/api/login', { code, terminalId: 'A' });
  assert.equal(a.status, 200);
  const b = await post('/api/login', { code, terminalId: 'B' });
  assert.equal(b.status, 423);
  clock += cfg.session.lockTimeoutSec * 1000 + 1;
  const b2 = await post('/api/login', { code, terminalId: 'B' });
  assert.equal(b2.status, 200);
  // 古い端末のトークンは無効
  const hb = await post('/api/heartbeat', { playerId: 'P0002', token: a.body.token });
  assert.equal(hb.status, 409);
});

test('ニックネームNG・ラウンド精算・ロスカット', async () => {
  const { body: { token } } = await post('/api/login', { code: cardCode(cfg, 'P0003'), terminalId: 'C' });
  const auth = { playerId: 'P0003', token };
  assert.equal((await post('/api/profile', { ...auth, nickname: 'バカ太郎' })).status, 400);
  assert.equal((await post('/api/profile', { ...auth, nickname: '12345678901' })).status, 400);
  assert.equal((await post('/api/profile', { ...auth, nickname: 'たろう' })).status, 200);

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

  const again = await post('/api/login', { code: cardCode(cfg, 'P0003'), terminalId: 'C' });
  assert.equal(again.body.status, 'no_chips');
});

test('途中放棄は負け扱い・ホールデムの持ち込み精算', async () => {
  const { body: { token } } = await post('/api/login', { code: cardCode(cfg, 'P0004'), terminalId: 'D' });
  const auth = { playerId: 'P0004', token };
  await post('/api/profile', { ...auth, nickname: 'はなこ' });
  await post('/api/round/start', { ...auth, game: 'pinball', bet: 10, leverage: 5 });
  const a = await post('/api/round/abort', { ...auth, reason: 'idle' });
  assert.equal(a.body.delta, -50);
  const s = await post('/api/round/start', { ...auth, game: 'holdem', bet: 20, leverage: 2 });
  assert.equal((await post('/api/round/finish', { ...auth, roundId: s.body.roundId, result: { finalStack: 999 } })).status, 400);
  const f = await post('/api/round/finish', { ...auth, roundId: s.body.roundId, result: { finalStack: 35 } });
  assert.equal(f.body.delta, 30); // (35-20)*2
});

test('管理画面：VRボーナス1日1回・復活・取消・カード生成', async () => {
  assert.equal((await post('/api/admin/login', { password: 'x' })).status, 401);
  const { body: { token } } = await post('/api/admin/login', { password: 'pw' });
  const h = { 'x-admin-token': token };
  assert.equal((await get('/api/admin/stats')).status, 401);

  let r = await post('/api/admin/players/P0004/chips', { kind: 'vr_bonus' }, h);
  assert.equal(r.status, 200);
  assert.equal(r.body.delta, 50);
  r = await post('/api/admin/players/P0004/chips', { kind: 'vr_bonus' }, h);
  assert.equal(r.status, 400);
  r = await post('/api/admin/players/4/chips', { kind: 'revive' }, h);
  assert.equal(r.status, 400); // 0ではない
  r = await post('/api/admin/players/P0003/chips', { kind: 'revive' }, h);
  assert.equal(r.body.player.chips, 50);
  assert.equal((await post('/api/admin/players/P0003/chips', { kind: 'revive' }, h)).status, 400);

  const detail = await get('/api/admin/players/P0004', h);
  const vr = detail.body.transactions.find((t) => t.game === 'vr_bonus');
  r = await post(`/api/admin/transactions/${vr.id}/revert`, {}, h);
  assert.equal(r.body.delta, -50);
  assert.equal((await post(`/api/admin/transactions/${vr.id}/revert`, {}, h)).status, 400);
  // 取り消したのでもう一度付与できる
  assert.equal((await post('/api/admin/players/P0004/chips', { kind: 'vr_bonus' }, h)).status, 200);

  const cards = await get('/api/admin/cards?from=1&count=3', h);
  assert.equal(cards.body.cards.length, 3);
  assert.match(cards.body.cards[0].svg, /<svg/);

  const rank = await get('/api/ranking');
  assert.equal(rank.body.ranking[0].nickname, 'たろう');
  assert.ok(!('id' in rank.body.ranking[0]));

  r = await post('/api/admin/reset', { confirm: 'RESET' }, h);
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(r.body.backup));
  assert.equal((await get('/api/ranking')).body.ranking.length, 0);
});
