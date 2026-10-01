// 花札こいこい
import { shuffle } from './cards.js';

export const MONTHS = [
  null,
  { name: '松', en: 'pine', color: '#2e7d32' },
  { name: '梅', en: 'plum', color: '#c2185b' },
  { name: '桜', en: 'cherry', color: '#f48fb1' },
  { name: '藤', en: 'wisteria', color: '#7e57c2' },
  { name: '菖蒲', en: 'iris', color: '#3949ab' },
  { name: '牡丹', en: 'peony', color: '#d81b60' },
  { name: '萩', en: 'clover', color: '#ad1457' },
  { name: '芒', en: 'pampas', color: '#8d6e63' },
  { name: '菊', en: 'chrysanthemum', color: '#f9a825' },
  { name: '紅葉', en: 'maple', color: '#e64a19' },
  { name: '柳', en: 'willow', color: '#558b2f' },
  { name: '桐', en: 'paulownia', color: '#6d4c41' },
];

export const TYPE_NAMES = { hikari: '光', tane: 'タネ', tan: '短冊', kasu: 'カス' };

// [月, 種類, 名前, 特別フラグ]
const DEFS = [
  [1, 'hikari', '松に鶴'], [1, 'tan', '松に赤短', 'aka'], [1, 'kasu', '松'], [1, 'kasu', '松'],
  [2, 'tane', '梅に鶯'], [2, 'tan', '梅に赤短', 'aka'], [2, 'kasu', '梅'], [2, 'kasu', '梅'],
  [3, 'hikari', '桜に幕', 'curtain'], [3, 'tan', '桜に赤短', 'aka'], [3, 'kasu', '桜'], [3, 'kasu', '桜'],
  [4, 'tane', '藤に不如帰'], [4, 'tan', '藤に短冊'], [4, 'kasu', '藤'], [4, 'kasu', '藤'],
  [5, 'tane', '菖蒲に八橋'], [5, 'tan', '菖蒲に短冊'], [5, 'kasu', '菖蒲'], [5, 'kasu', '菖蒲'],
  [6, 'tane', '牡丹に蝶', 'ino'], [6, 'tan', '牡丹に青短', 'ao'], [6, 'kasu', '牡丹'], [6, 'kasu', '牡丹'],
  [7, 'tane', '萩に猪', 'ino'], [7, 'tan', '萩に短冊'], [7, 'kasu', '萩'], [7, 'kasu', '萩'],
  [8, 'hikari', '芒に月', 'moon'], [8, 'tane', '芒に雁'], [8, 'kasu', '芒'], [8, 'kasu', '芒'],
  [9, 'tane', '菊に盃', 'sake'], [9, 'tan', '菊に青短', 'ao'], [9, 'kasu', '菊'], [9, 'kasu', '菊'],
  [10, 'tane', '紅葉に鹿', 'ino'], [10, 'tan', '紅葉に青短', 'ao'], [10, 'kasu', '紅葉'], [10, 'kasu', '紅葉'],
  [11, 'hikari', '柳に小野道風', 'rain'], [11, 'tane', '柳に燕'], [11, 'tan', '柳に短冊'], [11, 'kasu', '柳に雷'],
  [12, 'hikari', '桐に鳳凰'], [12, 'kasu', '桐'], [12, 'kasu', '桐'], [12, 'kasu', '桐'],
];

export const CARDS = DEFS.map(([month, type, name, flag], i) => ({ id: `h${i}`, month, type, name, flag: flag || null }));
export const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export const YAKU_LIST = [
  { name: '五光', points: '10点', desc: '光札5枚すべて' },
  { name: '四光', points: '8点', desc: '小野道風（雨）以外の光札4枚' },
  { name: '雨四光', points: '7点', desc: '小野道風を含む光札4枚' },
  { name: '三光', points: '5点', desc: '小野道風以外の光札3枚' },
  { name: '花見で一杯', points: '5点', desc: '桜に幕 ＋ 菊に盃' },
  { name: '月見で一杯', points: '5点', desc: '芒に月 ＋ 菊に盃' },
  { name: '猪鹿蝶', points: '5点', desc: '萩に猪・紅葉に鹿・牡丹に蝶' },
  { name: '赤短', points: '5点', desc: '松・梅・桜の赤短（他の短冊1枚ごとに+1）' },
  { name: '青短', points: '5点', desc: '牡丹・菊・紅葉の青短（他の短冊1枚ごとに+1）' },
  { name: 'タネ', points: '1点〜', desc: 'タネ札5枚で1点、1枚ごとに+1' },
  { name: 'タン', points: '1点〜', desc: '短冊5枚で1点、1枚ごとに+1' },
  { name: 'カス', points: '1点〜', desc: 'カス札10枚で1点、1枚ごとに+1' },
];

// 取り札から役を計算
export function calcYaku(captured) {
  const cs = captured.map((c) => (typeof c === 'string' ? byId[c] : c));
  const has = (flag) => cs.some((c) => c.flag === flag);
  const count = (type) => cs.filter((c) => c.type === type).length;
  const yaku = [];
  const lights = count('hikari');
  const rain = has('rain');
  if (lights === 5) yaku.push({ name: '五光', points: 10 });
  else if (lights === 4) yaku.push(rain ? { name: '雨四光', points: 7 } : { name: '四光', points: 8 });
  else if (lights === 3 && !rain) yaku.push({ name: '三光', points: 5 });
  if (has('sake') && has('curtain')) yaku.push({ name: '花見で一杯', points: 5 });
  if (has('sake') && has('moon')) yaku.push({ name: '月見で一杯', points: 5 });
  if (cs.filter((c) => c.flag === 'ino').length === 3) yaku.push({ name: '猪鹿蝶', points: 5 });
  const tan = count('tan');
  const aka = cs.filter((c) => c.flag === 'aka').length === 3;
  const ao = cs.filter((c) => c.flag === 'ao').length === 3;
  if (aka) yaku.push({ name: '赤短', points: 5 + (ao ? 0 : tan - 3) });
  if (ao) yaku.push({ name: '青短', points: 5 + (aka ? 0 : tan - 3) });
  const tane = count('tane');
  if (tane >= 5) yaku.push({ name: 'タネ', points: tane - 4 });
  if (tan >= 5) yaku.push({ name: 'タン', points: tan - 4 });
  const kasu = count('kasu');
  if (kasu >= 10) yaku.push({ name: 'カス', points: kasu - 9 });
  return { yaku, total: yaku.reduce((a, y) => a + y.points, 0) };
}

export function cardValue(c) {
  const card = typeof c === 'string' ? byId[c] : c;
  const base = { hikari: 20, tane: 8, tan: 5, kasu: 1 }[card.type];
  return base + (card.flag && card.flag !== 'rain' ? 6 : 0) - (card.flag === 'rain' ? 6 : 0);
}

export function dealRound() {
  // 場に同じ月が4枚そろったら配り直し
  for (;;) {
    const deck = shuffle(CARDS.map((c) => c.id));
    const hands = [deck.splice(0, 8), deck.splice(0, 8)];
    const field = deck.splice(0, 8);
    const months = {};
    for (const id of field) months[byId[id].month] = (months[byId[id].month] || 0) + 1;
    if (Object.values(months).every((n) => n < 4)) return { hands, field, deck };
  }
}

// 1か月（1局）分の進行
export class KoikoiRound {
  // oya: 0=プレイヤー, 1=CPU
  constructor({ oya = 0, deal, koikoiDoubles = true, sevenPointsDoubles = false } = {}) {
    const d = deal || dealRound();
    this.hands = d.hands.map((h) => h.slice());
    this.field = d.field.slice();
    this.deck = d.deck.slice();
    this.captured = [[], []];
    this.koikoi = [false, false];
    this.lastScore = [0, 0];
    this.turn = oya;
    this.oya = oya;
    this.phase = 'play'; // play | chooseHand | chooseDraw | decide | end
    this.pending = null;
    this.result = null;
    this.koikoiDoubles = koikoiDoubles;
    this.sevenPointsDoubles = sevenPointsDoubles;
    this.events = [];
  }

  matches(cardId) {
    const m = byId[cardId].month;
    return this.field.filter((id) => byId[id].month === m);
  }

  // 手札から1枚出す
  playCard(player, cardId) {
    if (this.phase !== 'play' || player !== this.turn) throw new Error('今は出せません');
    if (!this.hands[player].includes(cardId)) throw new Error('手札にありません');
    this.hands[player] = this.hands[player].filter((id) => id !== cardId);
    const m = this.matches(cardId);
    if (m.length === 2) {
      this.phase = 'chooseHand';
      this.pending = { cardId, options: m, source: 'hand' };
      return;
    }
    this.resolve(player, cardId, m, 'hand');
    this.drawStep(player);
  }

  // 2枚合う場合に取る札を選ぶ
  chooseField(player, fieldId) {
    if ((this.phase !== 'chooseHand' && this.phase !== 'chooseDraw') || player !== this.turn) throw new Error('今は選べません');
    if (!this.pending.options.includes(fieldId)) throw new Error('その札は選べません');
    const src = this.pending.source;
    this.resolve(player, this.pending.cardId, [fieldId], src);
    this.pending = null;
    if (src === 'hand') this.drawStep(player);
    else this.afterTurn(player);
  }

  resolve(player, cardId, matched, source) {
    if (matched.length === 0) {
      this.field.push(cardId);
      this.events.push({ player, source, cardId, captured: [] });
      return;
    }
    const take = matched.length === 3 ? matched : [matched[0]];
    this.field = this.field.filter((id) => !take.includes(id));
    this.captured[player].push(cardId, ...take);
    this.events.push({ player, source, cardId, captured: take });
  }

  drawStep(player) {
    const drawn = this.deck.shift();
    this.lastDrawn = drawn;
    const m = this.matches(drawn);
    if (m.length === 2) {
      this.phase = 'chooseDraw';
      this.pending = { cardId: drawn, options: m, source: 'draw' };
      return;
    }
    this.resolve(player, drawn, m, 'draw');
    this.afterTurn(player);
  }

  afterTurn(player) {
    const { total } = calcYaku(this.captured[player]);
    if (total > this.lastScore[player]) {
      this.lastScore[player] = total;
      // 手札が残っていなければ自動で上がり
      if (this.hands[player].length === 0) return this.finish(player);
      this.phase = 'decide';
      return;
    }
    this.nextTurn(player);
  }

  // こいこい（true）か上がり（false）か
  decide(player, koikoi) {
    if (this.phase !== 'decide' || player !== this.turn) throw new Error('今は選べません');
    if (!koikoi) return this.finish(player);
    this.koikoi[player] = true;
    this.events.push({ player, koikoi: true });
    this.nextTurn(player);
  }

  nextTurn(player) {
    const other = 1 - player;
    if (this.hands[0].length === 0 && this.hands[1].length === 0) {
      this.phase = 'end';
      this.result = { winner: null, points: [0, 0], yaku: null };
      return;
    }
    this.turn = this.hands[other].length ? other : player;
    this.phase = 'play';
  }

  finish(player) {
    const { yaku, total } = calcYaku(this.captured[player]);
    let points = total;
    const notes = [];
    if (this.sevenPointsDoubles && points >= 7) { points *= 2; notes.push('7点以上で2倍'); }
    if (this.koikoiDoubles && this.koikoi[1 - player]) { points *= 2; notes.push('相手のこいこい返しで2倍'); }
    const pts = [0, 0];
    pts[player] = points;
    this.phase = 'end';
    this.result = { winner: player, points: pts, yaku, notes };
  }
}

// CPU：どの手札を出すか
export function cpuPickCard(round, player) {
  let best = null;
  for (const id of round.hands[player]) {
    const m = round.matches(id);
    let score;
    if (m.length === 0) {
      // 取れない札は価値の低いものを捨てる
      score = -cardValue(id) - 50;
    } else {
      const take = m.length === 3 ? m : [m.slice().sort((a, b) => cardValue(b) - cardValue(a))[0]];
      score = cardValue(id) + take.reduce((a, t) => a + cardValue(t), 0);
    }
    if (!best || score > best.score) best = { id, score };
  }
  return best.id;
}

export function cpuPickField(round) {
  return round.pending.options.slice().sort((a, b) => cardValue(b) - cardValue(a))[0];
}

export function cpuDecideKoikoi(round, player, rng = Math.random) {
  const score = round.lastScore[player];
  const handLeft = round.hands[player].length;
  const oppScore = calcYaku(round.captured[1 - player]).total;
  if (score >= 5 || handLeft <= 2 || oppScore > 0 || round.koikoi[1 - player]) return false;
  return rng() < 0.4;
}
