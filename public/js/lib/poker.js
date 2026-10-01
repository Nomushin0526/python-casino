// テキサスホールデムの役判定（5〜7枚から最強の5枚）
export const HAND_NAMES = ['ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート', 'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ'];

const pv = (c) => (c.r === 1 ? 14 : c.r); // A=14

// 降順のユニークなランク列から最上位のストレートの最高位を返す（A-5 は 5）
function straightHigh(ranksDesc) {
  const set = new Set(ranksDesc);
  if (set.has(14)) set.add(1);
  for (let hi = 14; hi >= 5; hi--) {
    let ok = true;
    for (let k = 0; k < 5; k++) if (!set.has(hi - k)) { ok = false; break; }
    if (ok) return hi;
  }
  return 0;
}

// 戻り値: { cat, ranks: [比較用の値...], name, score }
export function evaluate(cards) {
  if (cards.length < 5) throw new Error('5枚以上必要です');
  const bySuit = {};
  const counts = new Map();
  for (const c of cards) {
    const v = pv(c);
    (bySuit[c.s] ||= []).push(v);
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const make = (cat, ranks) => {
    let score = cat;
    for (let i = 0; i < 5; i++) score = score * 15 + (ranks[i] || 0);
    return { cat, ranks, name: HAND_NAMES[cat], score };
  };

  // フラッシュ / ストレートフラッシュ
  let flush = null;
  for (const vs of Object.values(bySuit)) {
    if (vs.length >= 5) {
      const desc = [...new Set(vs)].sort((a, b) => b - a);
      const sf = straightHigh(desc);
      if (sf) return make(8, [sf]);
      flush = vs.sort((a, b) => b - a).slice(0, 5);
    }
  }

  // 枚数の多い順→ランクの高い順
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const uniqDesc = [...counts.keys()].sort((a, b) => b - a);
  const kickers = (exclude, n) => uniqDesc.filter((v) => !exclude.includes(v)).slice(0, n);

  if (groups[0][1] === 4) return make(7, [groups[0][0], ...kickers([groups[0][0]], 1)]);
  const trips = groups.filter((g) => g[1] === 3).map((g) => g[0]);
  const pairs = groups.filter((g) => g[1] === 2).map((g) => g[0]);
  if (trips.length >= 2) return make(6, [trips[0], trips[1]]);
  if (trips.length === 1 && pairs.length >= 1) return make(6, [trips[0], pairs[0]]);
  if (flush) return make(5, flush);
  const st = straightHigh(uniqDesc);
  if (st) return make(4, [st]);
  if (trips.length === 1) return make(3, [trips[0], ...kickers([trips[0]], 2)]);
  if (pairs.length >= 2) return make(2, [pairs[0], pairs[1], ...kickers([pairs[0], pairs[1]], 1)]);
  if (pairs.length === 1) return make(1, [pairs[0], ...kickers([pairs[0]], 3)]);
  return make(0, uniqDesc.slice(0, 5));
}

export function compare(a, b) {
  return a.score - b.score;
}

// プリフロップの手札の強さ（0〜1のおおよその値）
export function preflopStrength(hole) {
  const [a, b] = hole.map(pv).sort((x, y) => y - x);
  const suited = hole[0].s === hole[1].s;
  let s;
  if (a === b) s = 0.5 + (a - 2) * 0.04; // 22=0.5 ... AA=0.98
  else {
    s = (a + b - 5) / 40; // 72o ≒ 0.1, AK ≒ 0.55
    if (suited) s += 0.06;
    const gap = a - b - 1;
    if (gap === 0) s += 0.05;
    else if (gap === 1) s += 0.02;
    else if (gap >= 3) s -= 0.04;
    if (a === 14) s += 0.05;
  }
  return Math.max(0, Math.min(1, s));
}

// モンテカルロで勝率を推定（opponents 人に対して）
export function estimateEquity(hole, board, opponents, deckRemaining, iterations = 300, rng = Math.random) {
  const need = 5 - board.length;
  let wins = 0;
  const pool = deckRemaining.slice();
  for (let it = 0; it < iterations; it++) {
    // 部分シャッフル
    const take = need + opponents * 2;
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const fullBoard = board.concat(pool.slice(0, need));
    const mine = evaluate(hole.concat(fullBoard)).score;
    let best = 0;
    let tie = 1;
    for (let o = 0; o < opponents; o++) {
      const opp = [pool[need + o * 2], pool[need + o * 2 + 1]];
      const s = evaluate(opp.concat(fullBoard)).score;
      if (s > best) { best = s; tie = 1; } else if (s === best) tie++;
    }
    if (mine > best) wins += 1;
    else if (mine === best) wins += 1 / (tie + 1);
  }
  return wins / iterations;
}
