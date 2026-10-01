import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HoldemTable, cpuDecide } from '../public/js/lib/holdem.js';

const R = { A: 1, J: 11, Q: 12, K: 13 };
const cs = (str) => str.split(/\s+/).map((t) => ({ r: R[t.slice(0, -1)] || Number(t.slice(0, -1)), s: t.slice(-1) }));

function seeded(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

test('ランダムに進めてもチップ総量が保存され、5ハンド完走できる', () => {
  for (let game = 0; game < 200; game++) {
    const rng = seeded(game + 1);
    const t = new HoldemTable({
      seats: [{ name: 'あなた', stack: 100, human: true }, { name: 'A', stack: 100 }, { name: 'B', stack: 100 }, { name: 'C', stack: 100 }],
      smallBlind: 5, bigBlind: 10,
    });
    for (let h = 0; h < 5 && t.activeCount() >= 2; h++) {
      t.startHand();
      let guard = 0;
      while (!t.handOver) {
        assert.ok(guard++ < 200, 'ループしすぎ');
        const L = t.legal();
        const r = rng();
        const a = r < 0.15 ? { type: 'fold' } : r < 0.6 ? { type: 'call' } : r < 0.75 ? { type: 'check' }
          : { type: 'raise', to: L.minRaiseTo + Math.floor(rng() * (L.maxRaiseTo - L.minRaiseTo + 1)) };
        t.act(t.toAct, a);
      }
      const total = t.seats.reduce((a, s) => a + s.stack, 0);
      assert.equal(total, 400, `game ${game} hand ${h}`);
      assert.ok(t.seats.every((s) => s.stack >= 0));
    }
  }
});

test('CPU同士でも進行する', () => {
  const t = new HoldemTable({
    seats: [{ name: 'A', stack: 200 }, { name: 'B', stack: 200 }, { name: 'C', stack: 200 }],
    smallBlind: 10, bigBlind: 20,
  });
  for (let h = 0; h < 5 && t.activeCount() >= 2; h++) {
    t.startHand();
    while (!t.handOver) t.act(t.toAct, cpuDecide(t, t.toAct, { iterations: 50 }));
  }
  assert.equal(t.seats.reduce((a, s) => a + s.stack, 0), 600);
});

test('サイドポットの配分', () => {
  // デッキを固定：pop() で末尾から引かれる
  const order = [
    // 配札: dealer=0 なので seat1, seat2, seat0, seat1, seat2, seat0
    'AS', 'KS', '2C', 'AH', 'KH', '3D',
    // burn, flop, burn, turn, burn, river
    '4C', '7D', '8C', '9H', '4D', 'JS', '4H', 'QD',
  ];
  const deck = cs(order.join(' ')).reverse();
  const t = new HoldemTable({
    seats: [{ name: 'P0', stack: 300 }, { name: 'P1', stack: 50 }, { name: 'P2', stack: 200 }],
    smallBlind: 5, bigBlind: 10, deckFactory: () => deck.slice(),
  });
  t.startHand();
  assert.equal(t.dealer, 0);
  assert.deepEqual(t.seats[1].hole.map((c) => c.r), [1, 1]);
  // P0(UTG) all-in 300, P1 call (all-in 50), P2 call (all-in 200)
  t.act(0, { type: 'raise', to: 300 });
  t.act(1, { type: 'call' });
  t.act(2, { type: 'call' });
  assert.equal(t.handOver, true);
  // P1(AA) がメインポット 150、P2(KK) がサイドポット 300、P0 の余り 100 は返却
  assert.equal(t.seats[1].stack, 150);
  assert.equal(t.seats[2].stack, 300);
  assert.equal(t.seats[0].stack, 100);
});

test('全員フォールドでBBが勝つ', () => {
  const t = new HoldemTable({
    seats: [{ name: 'P0', stack: 100 }, { name: 'P1', stack: 100 }, { name: 'P2', stack: 100 }],
    smallBlind: 5, bigBlind: 10,
  });
  t.startHand();
  t.act(t.toAct, { type: 'fold' });
  t.act(t.toAct, { type: 'fold' });
  assert.equal(t.handOver, true);
  assert.equal(t.seats[t.bbIndex].stack, 105);
});
