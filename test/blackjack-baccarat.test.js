import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handValue, judge, dealerShouldHit, isBlackjack } from '../public/js/lib/blackjack.js';
import { bankerDraws, playCoup, total } from '../public/js/lib/baccarat.js';

const c = (...rs) => rs.map((r) => ({ r, s: 'S' }));

test('ブラックジャック：手札の合計', () => {
  assert.deepEqual(handValue(c(1, 13)), { total: 21, soft: true });
  assert.deepEqual(handValue(c(1, 1, 9)), { total: 21, soft: true });
  assert.deepEqual(handValue(c(1, 9, 5)), { total: 15, soft: false });
  assert.equal(isBlackjack(c(1, 12)), true);
  assert.equal(isBlackjack(c(7, 7, 7)), false);
  assert.equal(dealerShouldHit(c(10, 6)), true);
  assert.equal(dealerShouldHit(c(1, 6)), false); // ソフト17はスタンド
  assert.equal(dealerShouldHit(c(10, 7)), false);
});

test('ブラックジャック：勝敗', () => {
  assert.equal(judge(c(1, 13), c(10, 9)), 'blackjack');
  assert.equal(judge(c(1, 13), c(1, 10)), 'push');
  assert.equal(judge(c(10, 9, 2), c(1, 10)), 'lose');
  assert.equal(judge(c(10, 9), c(10, 8)), 'win');
  assert.equal(judge(c(10, 5, 9), c(10, 6, 9)), 'lose'); // プレイヤーのバーストが先
  assert.equal(judge(c(10, 8), c(10, 6, 9)), 'win');
  assert.equal(judge(c(10, 8), c(9, 9)), 'push');
});

test('バカラ：3枚目ルール', () => {
  assert.equal(bankerDraws(5, null), true);
  assert.equal(bankerDraws(6, null), false);
  assert.equal(bankerDraws(3, { r: 8 }), false);
  assert.equal(bankerDraws(3, { r: 9 }), true);
  assert.equal(bankerDraws(4, { r: 1 }), false);
  assert.equal(bankerDraws(4, { r: 2 }), true);
  assert.equal(bankerDraws(5, { r: 4 }), true);
  assert.equal(bankerDraws(5, { r: 3 }), false);
  assert.equal(bankerDraws(6, { r: 6 }), true);
  assert.equal(bankerDraws(6, { r: 5 }), false);
  assert.equal(bankerDraws(7, { r: 6 }), false);
  assert.equal(total(c(13, 9, 5)), 4);
});

test('バカラ：1ゲームの進行', () => {
  const seq = (rs) => { const q = c(...rs); return () => q.shift(); };
  // P:1,2 B:3,4 → P=3 で3枚目(10→3) / B=7 スタンド
  let r = playCoup(seq([1, 3, 2, 4, 10]));
  assert.equal(r.player.length, 3);
  assert.equal(r.banker.length, 2);
  assert.equal(r.winner, 'banker');
  // ナチュラル
  r = playCoup(seq([4, 1, 4, 1]));
  assert.equal(r.natural, true);
  assert.equal(r.winner, 'player');
  // P:6,1=7 スタンド、B:2,3=5 → 引く(9) → 4
  r = playCoup(seq([6, 2, 1, 3, 9]));
  assert.equal(r.player.length, 2);
  assert.equal(r.banker.length, 3);
  assert.equal(r.winner, 'player');
});
