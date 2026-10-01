import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, compare, estimateEquity } from '../public/js/lib/poker.js';
import { makeDeck } from '../public/js/lib/cards.js';

// "AS KH 10D" のような表記からカードを作る
const R = { A: 1, J: 11, Q: 12, K: 13 };
const cs = (str) => str.split(/\s+/).map((t) => ({ r: R[t.slice(0, -1)] || Number(t.slice(0, -1)), s: t.slice(-1) }));
const ev = (str) => evaluate(cs(str));

test('役の種類を正しく判定する', () => {
  assert.equal(ev('AS KS QS JS 10S 2D 3C').name, 'ストレートフラッシュ');
  assert.equal(ev('5H 4H 3H 2H AH KD KC').name, 'ストレートフラッシュ');
  assert.equal(ev('9C 9D 9H 9S 2D 3C 4H').name, 'フォーカード');
  assert.equal(ev('9C 9D 9H 2S 2D 3C 4H').name, 'フルハウス');
  assert.equal(ev('9C 9D 9H 2S 2D 2C 4H').name, 'フルハウス');
  assert.equal(ev('AH 9H 7H 4H 2H KD KC').name, 'フラッシュ');
  assert.equal(ev('AH 2D 3C 4S 5H KD QC').name, 'ストレート');
  assert.equal(ev('10H JD QC KS AH 2D 3C').name, 'ストレート');
  assert.equal(ev('QH QD QC 4S 5H 9D 2C').name, 'スリーカード');
  assert.equal(ev('QH QD 4C 4S 5H 9D 2C').name, 'ツーペア');
  assert.equal(ev('QH QD 4C 7S 5H 9D 2C').name, 'ワンペア');
  assert.equal(ev('QH 3D 4C 7S 5H 9D JC').name, 'ハイカード');
  // A,K,Q,J,9 + 10ではなく 2 → ストレートではない
  assert.equal(ev('AH KD QC JS 9H 3D 2C').name, 'ハイカード');
});

test('役の強さの比較', () => {
  const order = [
    'QH 3D 4C 7S 5H 9D JC',
    'QH QD 4C 7S 5H 9D 2C',
    'QH QD 4C 4S 5H 9D 2C',
    'QH QD QC 4S 5H 9D 2C',
    'AH 2D 3C 4S 5H KD QC',
    '6H 2D 3C 4S 5H KD QC',
    'AH 9H 7H 4H 2H KD KC',
    '9C 9D 9H 2S 2D 3C 4H',
    '9C 9D 9H 9S 2D 3C 4H',
    '5H 4H 3H 2H AH KD KC',
    'AS KS QS JS 10S 2D 3C',
  ].map(ev);
  for (let i = 1; i < order.length; i++) assert.ok(compare(order[i], order[i - 1]) > 0, `index ${i}`);
});

test('キッカー・引き分け', () => {
  assert.ok(compare(ev('AH AD KC 7S 5H 3D 2C'), ev('AS AC QC 7D 5S 3H 2D')) > 0);
  assert.equal(compare(ev('AH AD KC 7S 5H 3D 2C'), ev('AS AC KD 7D 5S 3H 2D')), 0);
  // ボードで5枚が決まる場合は引き分け（6番目のカードは関係ない）
  assert.equal(compare(ev('2H 3D 10C JS QH KD AC'), ev('4H 5D 10C JS QH KD AC')), 0);
  // ツーペアは上位2ペア＋キッカー
  assert.ok(compare(ev('KH KD 9C 9S 4H 4D AC'), ev('KS KC 9D 9H 8H 8D 7C')) > 0);
  // フルハウス：トリップス優先
  assert.ok(compare(ev('3H 3D 3C 2S 2H 9D 8C'), ev('2D 2C 2H AS AH 9S 8D')) > 0);
  // フラッシュは高い5枚で比較
  assert.ok(compare(ev('AH QH 9H 5H 3H 2H KD'), ev('AH QH 9H 5H 2H 3D KD')) > 0);
});

test('エクイティ推定はおおよそ妥当', () => {
  const deck = makeDeck();
  const hole = cs('AS AH');
  const rest = deck.filter((c) => !hole.some((h) => h.r === c.r && h.s === c.s));
  const eq = estimateEquity(hole, [], 1, rest, 2000);
  assert.ok(eq > 0.78 && eq < 0.9, `AA vs 1 = ${eq}`);
});
