// トランプ共通（r: 1=A ... 11=J 12=Q 13=K, s: S H D C, joker: true）
export const SUITS = ['S', 'H', 'D', 'C'];
export const SUIT_MARK = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

export function rankLabel(r) {
  return RANK_LABEL[r] || String(r);
}

export function cardLabel(c) {
  if (c.joker) return 'JOKER';
  return SUIT_MARK[c.s] + rankLabel(c.r);
}

export function randomInt(n) {
  if (globalThis.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / n) * n;
    let x;
    do { globalThis.crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
    return x % n;
  }
  return Math.floor(Math.random() * n);
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function makeDeck({ decks = 1, jokers = 0 } = {}) {
  const out = [];
  for (let d = 0; d < decks; d++) {
    for (const s of SUITS) for (let r = 1; r <= 13; r++) out.push({ r, s });
  }
  for (let j = 0; j < jokers; j++) out.push({ joker: true, r: 0, s: 'X', id: `JK${j}` });
  return out;
}

export function makeShoe(opts) {
  return shuffle(makeDeck(opts));
}
