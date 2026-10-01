import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, canBeat, baseStrength, DaifugoGame, cpuChoose } from '../public/js/lib/daifugo.js';

const c = (r, s = 'S') => ({ r, s });
const J = { joker: true, r: 0, s: 'X', id: 'JK0' };

test('強さと出し方の判定', () => {
  assert.ok(baseStrength(c(2)) > baseStrength(c(1)));
  assert.ok(baseStrength(c(1)) > baseStrength(c(13)));
  assert.ok(baseStrength(J) > baseStrength(c(2)));
  assert.equal(analyze([c(5), c(6)]), null);
  assert.equal(analyze([c(5), c(5, 'H'), J]).count, 3);
  const two = analyze([c(2)]);
  const three = analyze([c(3)]);
  assert.ok(canBeat(two, { ...three }, false));
  assert.ok(!canBeat(two, { ...three }, true)); // 革命中は3が最強
  assert.ok(canBeat(analyze([J]), two, false));
  assert.ok(canBeat(analyze([J]), three, true));
  assert.ok(!canBeat(analyze([c(4), c(4, 'H')]), three, false)); // 枚数違い
});

test('8切り・全員パスで場が流れる・革命', () => {
  const deck = [];
  // 4人に配る（i % 4）。プレイヤー0に ♦3 を持たせる
  const hands = [
    [c(3, 'D'), c(8, 'S'), c(9, 'S'), c(5, 'S'), c(5, 'H'), c(5, 'D'), c(5, 'C')],
    [c(4, 'S'), c(7, 'S'), c(11, 'S'), c(12, 'S'), c(13, 'S'), c(1, 'S'), c(2, 'S')],
    [c(4, 'H'), c(10, 'H'), c(11, 'H'), c(12, 'H'), c(13, 'H'), c(1, 'H'), c(2, 'H')],
    [c(4, 'D'), c(10, 'D'), c(11, 'D'), c(12, 'D'), c(13, 'D'), c(1, 'D'), c(2, 'D')],
  ];
  for (let k = 0; k < 7; k++) for (let p = 0; p < 4; p++) deck.push(hands[p][k]);
  const g = new DaifugoGame({ deck });
  assert.equal(g.turn, 0);
  g.play(0, [c(3, 'D')]);
  assert.equal(g.turn, 1);
  g.play(1, [c(4, 'S')]);
  g.pass(2); g.pass(3); g.pass(0);
  assert.equal(g.field, null); // 流れた
  assert.equal(g.turn, 1);
  g.play(1, [c(7, 'S')]);
  g.pass(2);
  g.pass(3);
  const ev = g.play(0, [c(8, 'S')]);
  assert.ok(ev.includes('eight'));
  assert.equal(g.field, null);
  assert.equal(g.turn, 0);
  const ev2 = g.play(0, [c(5, 'S'), c(5, 'H'), c(5, 'D'), c(5, 'C')]);
  assert.ok(ev2.includes('revolution'));
  assert.equal(g.revolution, true);
  assert.throws(() => g.play(1, [c(1, 'S')])); // 枚数が違う
});

test('CPUだけで最後まで進み、順位が決まる', () => {
  for (let t = 0; t < 200; t++) {
    const g = new DaifugoGame();
    let guard = 0;
    while (!g.over) {
      assert.ok(guard++ < 1000);
      const i = g.turn;
      const cards = cpuChoose(g, i);
      if (cards) g.play(i, cards);
      else if (g.field) g.pass(i);
      else assert.fail('親なのに出せない');
    }
    assert.deepEqual([...g.finished].sort(), [0, 1, 2, 3]);
  }
});
