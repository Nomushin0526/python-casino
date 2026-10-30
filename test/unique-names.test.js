// allowDuplicateNames: false（同じ名前を禁止する設定）の動作
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';
import { openNodeDb } from '../server/core/db-node.js';
import { createApp } from '../server/app.js';

let server, base;
before(async () => {
  const cfg = loadConfig({ account: { allowDuplicateNames: false } });
  const app = createApp(cfg, openNodeDb(':memory:'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = async (url, body) => {
  const r = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test('同じ名前は登録できない', async () => {
  assert.equal((await post('/api/register', { username: 'ゆき', password: 'aaaa1', terminalId: 'A' })).status, 200);
  assert.equal((await post('/api/register', { username: 'ゆき', password: 'bbbb2', terminalId: 'B' })).status, 409);
  const chk = await (await fetch(`${base}/api/name-check?name=${encodeURIComponent('ゆき')}`)).json();
  assert.equal(chk.ok, false);
});
