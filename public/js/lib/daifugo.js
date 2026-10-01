// 大富豪（基本ルール＋革命＋8切り。階段・しばり等のローカルルールなし）
import { makeShoe } from './cards.js';

export const RULES_TEXT = [
  '4人（あなた＋CPU3人）で手札を早くなくした順に 大富豪・富豪・貧民・大貧民 が決まります。',
  '場と同じ枚数で、より強いカードを出せます（1枚・2枚・3枚・4枚の同じ数字）。',
  '強さ：3 < 4 < … < K < A < 2 < ジョーカー。ジョーカーは他の数字の代わりにもなります。',
  '出せない・出したくないときは「パス」。全員がパスすると場が流れ、最後に出した人から再開。',
  '8切り：8を出すとその場で場が流れ、出した人から再開します。',
  '革命：同じ数字を4枚出すと強さが逆転（3が最強、2が最弱）。もう一度革命で元に戻ります。',
  '最初は♦3を持っている人から始めます。',
];

// 通常時の強さ 3=0 … A=11, 2=12, ジョーカー=13
export function baseStrength(c) {
  if (c.joker) return 13;
  return c.r >= 3 ? c.r - 3 : c.r + 10; // A(1)=11, 2=12
}

export function strength(rankStrength, revolution) {
  if (rankStrength === 13) return 13; // ジョーカー単体は常に最強
  return revolution ? 12 - rankStrength : rankStrength;
}

// 出そうとしているカードを解析する。不正なら null
export function analyze(cards) {
  if (!cards.length || cards.length > 4) return null;
  const naturals = cards.filter((c) => !c.joker);
  if (naturals.length === 0) return cards.length === 1 ? { count: 1, rank: 13, cards, hasEight: false } : null;
  const r = naturals[0].r;
  if (!naturals.every((c) => c.r === r)) return null;
  return { count: cards.length, rank: baseStrength(naturals[0]), cards, hasEight: r === 8 };
}

export function canBeat(play, field, revolution) {
  if (!field) return true;
  if (play.count !== field.count) return false;
  return strength(play.rank, revolution) > strength(field.rank, revolution);
}

export const cardId = (c) => (c.joker ? c.id : c.s + c.r);

export function sortHand(hand, revolution = false) {
  const key = (c) => strength(baseStrength(c), revolution);
  return hand.sort((a, b) => key(a) - key(b) || 'SHDCX'.indexOf(a.s) - 'SHDCX'.indexOf(b.s));
}

export class DaifugoGame {
  constructor({ players = 4, jokers = 1, deck } = {}) {
    const cards = deck || makeShoe({ jokers });
    this.n = players;
    this.hands = Array.from({ length: players }, () => []);
    cards.forEach((c, i) => this.hands[i % players].push(c));
    this.hands.forEach((h) => sortHand(h));
    this.field = null; // { count, rank, cards, by }
    this.lastPlayer = -1;
    this.passCount = 0;
    this.revolution = false;
    this.finished = []; // 上がった順
    this.history = [];
    this.turn = this.hands.findIndex((h) => h.some((c) => c.s === 'D' && c.r === 3));
    if (this.turn < 0) this.turn = 0;
    this.over = false;
  }

  isActive(i) {
    return !this.finished.includes(i);
  }

  activePlayers() {
    return [...Array(this.n).keys()].filter((i) => this.isActive(i));
  }

  nextActive(from) {
    for (let k = 1; k <= this.n; k++) {
      const i = (from + k) % this.n;
      if (this.isActive(i)) return i;
    }
    return -1;
  }

  validate(i, cards) {
    if (this.over || i !== this.turn) return { ok: false, error: 'あなたの番ではありません' };
    const ids = new Set(this.hands[i].map(cardId));
    if (!cards.every((c) => ids.has(cardId(c)))) return { ok: false, error: '手札にないカードです' };
    const play = analyze(cards);
    if (!play) return { ok: false, error: '同じ数字のカードだけを選んでください' };
    if (this.field && play.count !== this.field.count) return { ok: false, error: `場と同じ ${this.field.count} 枚を出してください` };
    if (!canBeat(play, this.field, this.revolution)) return { ok: false, error: '場のカードより強いカードを出してください' };
    return { ok: true, play };
  }

  play(i, cards) {
    const v = this.validate(i, cards);
    if (!v.ok) throw new Error(v.error);
    const ids = new Set(cards.map(cardId));
    this.hands[i] = this.hands[i].filter((c) => !ids.has(cardId(c)));
    const events = [];
    this.field = { ...v.play, by: i };
    this.lastPlayer = i;
    this.passCount = 0;
    this.history.push({ type: 'play', player: i, cards });
    if (v.play.count === 4) {
      this.revolution = !this.revolution;
      events.push(this.revolution ? 'revolution' : 'counter-revolution');
    }
    if (this.hands[i].length === 0) {
      this.finished.push(i);
      events.push('finish');
    }
    if (this.finished.length >= this.n - 1) {
      const last = this.activePlayers()[0];
      if (last !== undefined) this.finished.push(last);
      this.over = true;
      events.push('gameover');
      return events;
    }
    if (v.play.hasEight) {
      events.push('eight');
      this.clearField(i);
      return events;
    }
    this.turn = this.nextActive(i);
    this.checkAllPassed(events);
    return events;
  }

  pass(i) {
    if (this.over || i !== this.turn) throw new Error('あなたの番ではありません');
    if (!this.field) throw new Error('場にカードがないのでパスできません');
    this.passCount++;
    this.history.push({ type: 'pass', player: i });
    const events = [];
    this.turn = this.nextActive(i);
    this.checkAllPassed(events);
    return events;
  }

  checkAllPassed(events) {
    if (!this.field) return;
    const others = this.activePlayers().filter((p) => p !== this.lastPlayer).length;
    if (this.passCount >= others) {
      events.push('clear');
      this.clearField(this.lastPlayer);
    }
  }

  clearField(leader) {
    this.field = null;
    this.passCount = 0;
    this.turn = this.isActive(leader) ? leader : this.nextActive(leader);
  }

  rankOf(i) {
    const k = this.finished.indexOf(i);
    return k < 0 ? null : k + 1;
  }

  // 出せる組み合わせをすべて列挙（ジョーカーは代用も含む）
  legalPlays(i) {
    const hand = this.hands[i];
    const jokers = hand.filter((c) => c.joker);
    const byRank = new Map();
    for (const c of hand) if (!c.joker) (byRank.get(c.r) || byRank.set(c.r, []).get(c.r)).push(c);
    const plays = [];
    const counts = this.field ? [this.field.count] : [1, 2, 3, 4];
    for (const cnt of counts) {
      for (const group of byRank.values()) {
        for (let useJ = 0; useJ <= Math.min(jokers.length, cnt - 1); useJ++) {
          const nat = cnt - useJ;
          if (group.length < nat) continue;
          const cards = group.slice(0, nat).concat(jokers.slice(0, useJ));
          const p = analyze(cards);
          if (p && canBeat(p, this.field, this.revolution)) plays.push(p);
        }
      }
      if (cnt === 1 && jokers.length) {
        const p = analyze([jokers[0]]);
        if (canBeat(p, this.field, this.revolution)) plays.push(p);
      }
    }
    return plays;
  }
}

// CPU の思考
export function cpuChoose(game, i, rng = Math.random) {
  const plays = game.legalPlays(i);
  const hand = game.hands[i];
  const rev = game.revolution;
  const s = (p) => strength(p.rank, rev);
  const usesJoker = (p) => p.cards.some((c) => c.joker);
  const naturalCount = (p) => p.cards.filter((c) => !c.joker).length;
  const rankTotal = (p) => hand.filter((c) => !c.joker && baseStrength(c) === p.rank).length;
  if (!plays.length) return null;

  // 上がれるなら上がる
  const finishing = plays.find((p) => p.count === hand.length);
  if (finishing) return finishing.cards;

  // 手札が弱いなら革命を狙う
  const avg = hand.reduce((a, c) => a + strength(baseStrength(c), rev), 0) / hand.length;
  const revo = plays.find((p) => p.count === 4 && !usesJoker(p));
  if (revo && avg < 5.5) return revo.cards;

  // ジョーカーの代用はなるべく避け、同じ数字を崩さない手を優先して弱い順に
  const candidates = plays
    .filter((p) => !(p.count === 4 && !usesJoker(p) && avg >= 5.5))
    .map((p) => ({
      p,
      cost: s(p) * 2 + (usesJoker(p) ? 30 : 0) + (rankTotal(p) > naturalCount(p) ? 6 : 0) + (p.hasEight && game.field ? -4 : 0) + (p.hasEight && !game.field ? 4 : 0),
    }))
    .sort((a, b) => a.cost - b.cost);

  if (!game.field) {
    // 親のときは枚数の多い組を優先して出す
    const lead = candidates.slice().sort((a, b) => a.cost - a.p.count * 3 - (b.cost - b.p.count * 3))[0];
    return lead.p.cards;
  }
  const best = candidates[0];
  // 強いカードを温存するため、手札が多いうちは時々パス
  if (s(best.p) >= 11 && hand.length > 4 && rng() < 0.6) return null;
  if (usesJoker(best.p) && hand.length > 3) return null;
  return best.p.cards;
}
