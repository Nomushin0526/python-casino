// 大富豪（基本ルール＋選べるローカルルール）
import { makeShoe } from './cards.js';

// 選べるローカルルール（default: 初期状態でONか）
export const LOCAL_RULES = [
  { id: 'revolution', name: '革命', default: true, desc: '同じ数字を4枚出すと強さが逆転（3が最強・2が最弱）。もう一度で元に戻る' },
  { id: 'eightCut', name: '8切り', default: true, desc: '8を出すとその場で場が流れ、出した人からもう一度出せる' },
  { id: 'elevenBack', name: '11バック', default: false, desc: 'J（11）を出すと、場が流れるまで強さが逆転する' },
  { id: 'shibari', name: 'しばり', default: false, desc: '同じマークが2回続けて出たら、場が流れるまでそのマークしか出せない' },
  { id: 'spade3', name: 'スペ3返し', default: false, desc: 'ジョーカー1枚に ♠3 を出して返せる（場が流れる）' },
  { id: 'stairs', name: '階段', default: false, desc: '同じマークで3枚以上の連番（例 ♥4・5・6）を出せる。いちばん弱いカード同士で比べる' },
  { id: 'fiveSkip', name: '5飛ばし', default: false, desc: '5を出すと、出した枚数だけ次の人の番を飛ばす' },
];

export function defaultRules() {
  return Object.fromEntries(LOCAL_RULES.map((r) => [r.id, r.default]));
}

export const BASIC_RULES_TEXT = [
  '4人（あなた＋CPU3人）で、手札を早くなくした順に 大富豪・富豪・貧民・大貧民 が決まります。',
  '場と同じ枚数で、より強いカードを出せます（1枚・2枚・3枚・4枚の同じ数字）。',
  '強さ：3 < 4 < … < K < A < 2 < ジョーカー。ジョーカーは他の数字の代わりにもなります。',
  '出せない・出したくないときは「パス」。全員がパスすると場が流れ、最後に出した人から再開。',
  '最初は♦3を持っている人から始めます。',
];

// 通常時の強さ 3=0 … A=11, 2=12, ジョーカー=13
export function baseStrength(c) {
  if (c.joker) return 13;
  return c.r >= 3 ? c.r - 3 : c.r + 10; // A(1)=11, 2=12
}

export function strength(rankStrength, reversed) {
  if (rankStrength === 13) return 13; // ジョーカー単体は常に最強
  return reversed ? 12 - rankStrength : rankStrength;
}

const SUIT_ORDER = 'SHDC';
const suitKey = (cards) => cards.filter((c) => !c.joker).map((c) => c.s).sort().join('');

// 出そうとしているカードを解析する。不正なら null
//  group: 同じ数字 { type, count, rank }   stairs: 階段 { type, count, low, high, suit }
export function analyze(cards, rules = {}) {
  if (!cards.length) return null;
  const naturals = cards.filter((c) => !c.joker);
  const jokers = cards.length - naturals.length;
  const base = { cards, count: cards.length, hasJoker: jokers > 0 };
  if (cards.length <= 4) {
    if (naturals.length === 0) {
      if (cards.length === 1) return { ...base, type: 'group', rank: 13, hasEight: false, elevens: 0, fives: 0 };
    } else if (naturals.every((c) => c.r === naturals[0].r)) {
      const r = naturals[0].r;
      return {
        ...base, type: 'group', rank: baseStrength(naturals[0]), suits: suitKey(cards),
        hasEight: r === 8, elevens: r === 11 ? 1 : 0, fives: r === 5 ? naturals.length : 0,
        spade3: cards.length === 1 && r === 3 && naturals[0].s === 'S',
      };
    }
  }
  if (rules.stairs && cards.length >= 3 && naturals.length >= 1 && naturals.every((c) => c.s === naturals[0].s)) {
    const ss = naturals.map(baseStrength).sort((a, b) => a - b);
    if (new Set(ss).size !== ss.length) return null;
    let low = ss[0];
    let high = ss[ss.length - 1];
    const gaps = high - low + 1 - ss.length;
    if (gaps > jokers) return null;
    let extra = jokers - gaps; // 余ったジョーカーは上（なければ下）に伸ばす
    while (extra > 0 && high < 12) { high++; extra--; }
    while (extra > 0 && low > 0) { low--; extra--; }
    if (extra > 0) return null;
    return {
      ...base, type: 'stairs', low, high, suit: naturals[0].s, suits: suitKey(cards),
      hasEight: naturals.some((c) => c.r === 8), elevens: naturals.filter((c) => c.r === 11).length,
      fives: naturals.filter((c) => c.r === 5).length,
    };
  }
  return null;
}

// play の「いちばん弱いカード」の強さ（逆転中を考慮）
function weakest(play, reversed) {
  if (play.type === 'stairs') return Math.min(strength(play.low, reversed), strength(play.high, reversed));
  return strength(play.rank, reversed);
}

export function canBeat(play, field, reversed, rules = {}) {
  if (!field) return true;
  if (play.type !== field.type || play.count !== field.count) return false;
  // スペ3返し：ジョーカー単体に ♠3
  if (rules.spade3 && field.type === 'group' && field.count === 1 && field.rank === 13 && play.spade3) return true;
  return weakest(play, reversed) > weakest(field, reversed);
}

export const cardId = (c) => (c.joker ? c.id : c.s + c.r);

export function sortHand(hand, reversed = false) {
  const key = (c) => strength(baseStrength(c), reversed);
  return hand.sort((a, b) => key(a) - key(b) || 'SHDCX'.indexOf(a.s) - 'SHDCX'.indexOf(b.s));
}

export function playLabel(play) {
  if (play.type === 'stairs') return `階段${play.count}枚`;
  return `${play.count}枚`;
}

export class DaifugoGame {
  constructor({ players = 4, jokers = 1, deck, rules = defaultRules() } = {}) {
    const cards = deck || makeShoe({ jokers });
    this.rules = { ...defaultRules(), ...rules };
    this.n = players;
    this.hands = Array.from({ length: players }, () => []);
    cards.forEach((c, i) => this.hands[i % players].push(c));
    this.hands.forEach((h) => sortHand(h));
    this.field = null; // { ...play, by }
    this.prevPlay = null; // しばり判定用（同じ場の1つ前の出し札）
    this.lock = null; // しばり中のマーク
    this.elevenBack = false;
    this.lastPlayer = -1;
    this.passCount = 0;
    this.revolution = false;
    this.finished = []; // 上がった順
    this.history = [];
    this.turn = this.hands.findIndex((h) => h.some((c) => c.s === 'D' && c.r === 3));
    if (this.turn < 0) this.turn = 0;
    this.over = false;
  }

  // 今の強さの向き（革命と11バックが重なると元に戻る）
  get reversed() {
    return this.revolution !== this.elevenBack;
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

  // しばりのマークに合っているか（ジョーカーはどのマークにもなれる）
  matchesLock(play) {
    if (!this.lock) return true;
    const need = this.lock.split('');
    for (const c of play.cards) {
      if (c.joker) continue;
      const k = need.indexOf(c.s);
      if (k < 0) return false;
      need.splice(k, 1);
    }
    return true;
  }

  check(play) {
    if (!play) return '出せない組み合わせです';
    if (this.field) {
      if (play.type !== this.field.type) return this.field.type === 'stairs' ? '場は階段です。同じ枚数の階段を出してください' : '場と同じ形（同じ数字のカード）で出してください';
      if (play.count !== this.field.count) return `場と同じ ${this.field.count} 枚を出してください`;
      if (!canBeat(play, this.field, this.reversed, this.rules)) return '場のカードより強いカードを出してください';
      if (!this.matchesLock(play)) return `しばり中です（${this.lock.split('').map((s) => ({ S: '♠', H: '♥', D: '♦', C: '♣' }[s])).join('')} だけ出せます）`;
    }
    return null;
  }

  validate(i, cards) {
    if (this.over || i !== this.turn) return { ok: false, error: 'あなたの番ではありません' };
    const ids = new Set(this.hands[i].map(cardId));
    if (!cards.every((c) => ids.has(cardId(c)))) return { ok: false, error: '手札にないカードです' };
    const play = analyze(cards, this.rules);
    if (!play) {
      return { ok: false, error: this.rules.stairs ? '同じ数字のカード、または同じマークの3枚以上の連番を選んでください' : '同じ数字のカードだけを選んでください' };
    }
    const err = this.check(play);
    return err ? { ok: false, error: err } : { ok: true, play };
  }

  play(i, cards) {
    const v = this.validate(i, cards);
    if (!v.ok) throw new Error(v.error);
    const play = v.play;
    const ids = new Set(cards.map(cardId));
    this.hands[i] = this.hands[i].filter((c) => !ids.has(cardId(c)));
    const events = [];
    const isSpade3Return = this.rules.spade3 && this.field && this.field.rank === 13 && this.field.type === 'group' && play.spade3;
    // しばり：同じマーク構成が2回続いたらロック
    if (this.rules.shibari && this.field && !this.lock && !play.hasJoker && !this.field.hasJoker && play.suits === this.field.suits) {
      this.lock = play.suits;
      events.push('shibari');
    }
    this.prevPlay = this.field;
    this.field = { ...play, by: i };
    this.lastPlayer = i;
    this.passCount = 0;
    this.history.push({ type: 'play', player: i, cards });
    if (this.rules.revolution && play.type === 'group' && play.count === 4) {
      this.revolution = !this.revolution;
      events.push(this.revolution ? 'revolution' : 'counter-revolution');
    }
    if (this.rules.elevenBack && play.elevens > 0 && !this.elevenBack) {
      this.elevenBack = true;
      events.push('eleven');
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
    if (isSpade3Return) {
      events.push('spade3');
      this.clearField(i);
      return events;
    }
    if (this.rules.eightCut && play.hasEight) {
      events.push('eight');
      this.clearField(i);
      return events;
    }
    this.turn = this.nextActive(i);
    // 5飛ばし：出した5の枚数だけ次の人を飛ばす（飛ばされた人はパス扱い）
    if (this.rules.fiveSkip && play.fives > 0) {
      events.push('skip');
      const skipped = [];
      for (let k = 0; k < play.fives; k++) {
        if (this.turn === i) break;
        skipped.push(this.turn);
        this.passCount++;
        if (this.allPassed()) break;
        this.turn = this.nextActive(this.turn);
      }
      this.skipped = skipped;
    }
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

  allPassed() {
    const others = this.activePlayers().filter((p) => p !== this.lastPlayer).length;
    return this.passCount >= others;
  }

  checkAllPassed(events) {
    if (!this.field) return;
    if (this.allPassed()) {
      events.push('clear');
      this.clearField(this.lastPlayer);
    }
  }

  clearField(leader) {
    this.field = null;
    this.prevPlay = null;
    this.lock = null;
    this.elevenBack = false;
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
    const candidates = [];
    const wantGroup = !this.field || this.field.type === 'group';
    const counts = this.field ? [this.field.count] : [1, 2, 3, 4];
    if (wantGroup) {
      for (const cnt of counts) {
        if (cnt > 4) continue;
        for (const group of byRank.values()) {
          // しばり中は合うマークのカードを優先して選ぶ
          const ordered = this.lock ? group.slice().sort((a, b) => (this.lock.includes(b.s) ? 1 : 0) - (this.lock.includes(a.s) ? 1 : 0)) : group;
          for (let useJ = 0; useJ <= Math.min(jokers.length, cnt - 1); useJ++) {
            const nat = cnt - useJ;
            if (ordered.length < nat) continue;
            candidates.push(ordered.slice(0, nat).concat(jokers.slice(0, useJ)));
          }
        }
        if (cnt === 1 && jokers.length) candidates.push([jokers[0]]);
      }
    }
    if (this.rules.stairs && (!this.field || this.field.type === 'stairs')) {
      for (const s of SUIT_ORDER) {
        const own = new Map(hand.filter((c) => !c.joker && c.s === s).map((c) => [baseStrength(c), c]));
        for (let lo = 0; lo <= 10; lo++) {
          for (let len = 3; lo + len - 1 <= 12; len++) {
            if (this.field && len !== this.field.count) continue;
            const cards = [];
            let usedJ = 0;
            for (let k = lo; k < lo + len; k++) {
              if (own.has(k)) cards.push(own.get(k));
              else if (usedJ < jokers.length) cards.push(jokers[usedJ++]);
              else { cards.length = 0; break; }
            }
            if (cards.length === len && cards.some((c) => !c.joker)) candidates.push(cards);
          }
        }
      }
    }
    const plays = [];
    for (const cards of candidates) {
      const p = analyze(cards, this.rules);
      if (p && !this.check(p)) plays.push(p);
    }
    return plays;
  }
}

// CPU の思考
export function cpuChoose(game, i, rng = Math.random) {
  const plays = game.legalPlays(i);
  const hand = game.hands[i];
  const rev = game.reversed;
  const s = (p) => (p.type === 'stairs' ? Math.max(strength(p.low, rev), strength(p.high, rev)) : strength(p.rank, rev));
  const usesJoker = (p) => p.cards.some((c) => c.joker);
  const naturalCount = (p) => p.cards.filter((c) => !c.joker).length;
  const rankTotal = (p) => (p.type === 'group' ? hand.filter((c) => !c.joker && baseStrength(c) === p.rank).length : 0);
  if (!plays.length) return null;

  // 上がれるなら上がる
  const finishing = plays.find((p) => p.count === hand.length);
  if (finishing) return finishing.cards;

  // 手札が弱いなら革命を狙う
  const avg = hand.reduce((a, c) => a + strength(baseStrength(c), rev), 0) / hand.length;
  const isRevo = (p) => game.rules.revolution && p.type === 'group' && p.count === 4;
  const revo = plays.find((p) => isRevo(p) && !usesJoker(p));
  if (revo && avg < 5.5) return revo.cards;

  // ジョーカーの代用はなるべく避け、同じ数字を崩さない手を優先して弱い順に
  const cut = (p) => (game.rules.eightCut && p.hasEight) || p.spade3;
  const notRevo = plays.filter((p) => !(isRevo(p) && !usesJoker(p) && avg >= 5.5));
  if (!notRevo.length && game.field) return null; // 革命したくないならパス
  const candidates = (notRevo.length ? notRevo : plays)
    .map((p) => ({
      p,
      cost: s(p) * 2 + (usesJoker(p) ? 30 : 0) + (rankTotal(p) > naturalCount(p) ? 6 : 0)
        + (cut(p) && game.field ? -4 : 0) + (cut(p) && !game.field ? 4 : 0) - (p.type === 'stairs' ? 4 : 0),
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
