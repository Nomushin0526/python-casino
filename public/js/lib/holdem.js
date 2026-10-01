// テキサスホールデムの進行ロジック（UIから独立。テスト可能）
import { makeShoe } from './cards.js';
import { evaluate, estimateEquity } from './poker.js';

export const STREETS = ['preflop', 'flop', 'turn', 'river'];
export const STREET_NAMES = { preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー', showdown: 'ショーダウン' };

export class HoldemTable {
  // seats: [{ name, stack, human }]
  constructor({ seats, smallBlind, bigBlind, deckFactory = () => makeShoe() }) {
    this.seats = seats.map((s, i) => ({ ...s, index: i, hole: [], bet: 0, committed: 0, folded: false, allIn: false, acted: false, out: s.stack <= 0 }));
    this.sb = smallBlind;
    this.bb = bigBlind;
    this.deckFactory = deckFactory;
    this.dealer = -1;
    this.handNo = 0;
    this.log = [];
    this.street = null;
    this.handOver = true;
  }

  get pot() {
    return this.seats.reduce((a, s) => a + s.committed, 0);
  }

  live() { // フォールドしていない参加者
    return this.seats.filter((s) => !s.out && !s.folded);
  }

  canAct(s) {
    return !s.out && !s.folded && !s.allIn;
  }

  nextIndex(from, pred) {
    const n = this.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (pred(this.seats[i])) return i;
    }
    return -1;
  }

  activeCount() {
    // ハンド間はチップが残っている人数、ハンド中は参加人数
    return this.seats.filter((s) => (this.handOver ? s.stack > 0 : !s.out)).length;
  }

  emit(msg) {
    this.log.push(msg);
  }

  startHand() {
    for (const s of this.seats) {
      s.out = s.stack <= 0;
      Object.assign(s, { hole: [], bet: 0, committed: 0, folded: false, allIn: false, acted: false, lastAction: null, result: null, hand: null });
    }
    if (this.seats.filter((s) => !s.out).length < 2) throw new Error('プレイヤーが足りません');
    this.handNo++;
    this.handOver = false;
    this.winners = null;
    this.deck = this.deckFactory();
    this.board = [];
    this.dealer = this.nextIndex(this.dealer, (s) => !s.out);
    const headsUp = this.activeCount() === 2;
    const sbi = headsUp ? this.dealer : this.nextIndex(this.dealer, (s) => !s.out);
    const bbi = this.nextIndex(sbi, (s) => !s.out);
    this.sbIndex = sbi;
    this.bbIndex = bbi;
    this.postBlind(sbi, this.sb, 'SB');
    this.postBlind(bbi, this.bb, 'BB');
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < this.seats.length; i++) {
        const s = this.seats[(this.dealer + 1 + i) % this.seats.length];
        if (!s.out) s.hole.push(this.deck.pop());
      }
    }
    this.street = 'preflop';
    this.currentBet = this.bb;
    this.minRaise = this.bb;
    this.toAct = this.nextIndex(bbi, (s) => this.canAct(s));
    this.emit({ type: 'hand', handNo: this.handNo, dealer: this.dealer });
    this.checkRoundEnd();
  }

  postBlind(i, amount, label) {
    const s = this.seats[i];
    const a = Math.min(amount, s.stack);
    s.stack -= a;
    s.bet += a;
    s.committed += a;
    if (s.stack === 0) s.allIn = true;
    s.lastAction = `${label} ${a}`;
  }

  legal(i = this.toAct) {
    const s = this.seats[i];
    const toCall = Math.min(this.currentBet - s.bet, s.stack);
    const maxTo = s.bet + s.stack;
    const minTo = Math.min(this.currentBet + this.minRaise, maxTo);
    return {
      toCall,
      canCheck: toCall === 0,
      canRaise: maxTo > this.currentBet && this.seats.some((o) => o !== s && this.canAct(o)),
      minRaiseTo: minTo,
      maxRaiseTo: maxTo,
    };
  }

  // action: { type: 'fold'|'check'|'call'|'raise', to? }
  act(i, action) {
    if (this.handOver) throw new Error('ハンドは終了しています');
    if (i !== this.toAct) throw new Error('手番ではありません');
    const s = this.seats[i];
    const L = this.legal(i);
    let { type } = action;
    if (type === 'check' && !L.canCheck) type = 'call';
    if (type === 'call' && L.toCall === 0) type = 'check';
    if (type === 'raise' && !L.canRaise) type = L.canCheck ? 'check' : 'call';

    if (type === 'fold') {
      s.folded = true;
      s.lastAction = 'フォールド';
    } else if (type === 'check') {
      s.lastAction = 'チェック';
    } else if (type === 'call') {
      this.put(s, L.toCall);
      s.lastAction = s.allIn ? `オールイン ${s.bet}` : `コール ${s.bet}`;
    } else if (type === 'raise') {
      const to = Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, Math.floor(action.to)));
      const raiseBy = to - this.currentBet;
      this.put(s, to - s.bet);
      if (raiseBy >= this.minRaise) this.minRaise = raiseBy;
      if (to > this.currentBet) {
        this.currentBet = to;
        for (const o of this.seats) if (o !== s) o.acted = false;
      }
      s.lastAction = s.allIn ? `オールイン ${s.bet}` : `レイズ ${to}`;
    }
    s.acted = true;
    this.emit({ type: 'action', seat: i, action: s.lastAction });
    this.toAct = this.nextIndex(i, (o) => this.canAct(o));
    this.checkRoundEnd();
  }

  put(s, amount) {
    const a = Math.min(amount, s.stack);
    s.stack -= a;
    s.bet += a;
    s.committed += a;
    if (s.stack === 0) s.allIn = true;
  }

  checkRoundEnd() {
    const live = this.live();
    if (live.length === 1) return this.finishUncontested(live[0]);
    const actors = live.filter((s) => !s.allIn);
    const pending = actors.filter((s) => !s.acted || s.bet < this.currentBet);
    // 全員オールイン、または1人以外オールインで額がそろっている
    if (pending.length === 0 || (actors.length <= 1 && pending.every((s) => s.bet >= this.currentBet))) {
      if (actors.length <= 1) {
        // これ以上アクションできないのでボードを最後まで配る
        while (this.street !== 'river') this.nextStreet(true);
        return this.showdown();
      }
      if (this.street === 'river') return this.showdown();
      this.nextStreet();
      return this.checkRoundEnd();
    }
    if (this.toAct === -1 || !pending.includes(this.seats[this.toAct])) {
      // 手番を待ちのプレイヤーへ
      const from = this.toAct === -1 ? this.dealer : this.toAct;
      this.toAct = this.nextIndex(from - 1 + this.seats.length, (o) => pending.includes(o));
    }
  }

  nextStreet(silent = false) {
    for (const s of this.seats) {
      s.bet = 0;
      s.acted = false;
      if (!silent && !s.folded && !s.out && !s.allIn) s.lastAction = null;
    }
    this.currentBet = 0;
    this.minRaise = this.bb;
    const idx = STREETS.indexOf(this.street);
    this.street = STREETS[idx + 1];
    const n = this.street === 'flop' ? 3 : 1;
    this.deck.pop(); // バーンカード
    for (let k = 0; k < n; k++) this.board.push(this.deck.pop());
    this.toAct = this.nextIndex(this.dealer, (s) => this.canAct(s));
    this.emit({ type: 'street', street: this.street });
  }

  finishUncontested(winner) {
    const pot = this.pot;
    winner.stack += pot;
    winner.result = { won: pot };
    this.winners = [{ seat: winner.index, amount: pot, hand: null }];
    this.endHand();
  }

  // サイドポットを考慮して配分
  showdown() {
    this.street = 'showdown';
    const contenders = this.live();
    for (const s of contenders) s.hand = evaluate(s.hole.concat(this.board));
    const levels = [...new Set(this.seats.filter((s) => s.committed > 0).map((s) => s.committed))].sort((a, b) => a - b);
    const won = new Map();
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const s of this.seats) amount += Math.max(0, Math.min(s.committed, level) - prev);
      const eligible = contenders.filter((s) => s.committed >= level);
      prev = level;
      if (amount === 0) continue;
      if (eligible.length === 0) {
        // 全員フォールド済みの層（通常起こらない）は残っている人で分ける
        eligible.push(...contenders);
      }
      const best = Math.max(...eligible.map((s) => s.hand.score));
      const winners = eligible.filter((s) => s.hand.score === best);
      // 余りはディーラーの左から順に
      winners.sort((a, b) => ((a.index - this.dealer + this.seats.length - 1) % this.seats.length) - ((b.index - this.dealer + this.seats.length - 1) % this.seats.length));
      const share = Math.floor(amount / winners.length);
      let rest = amount - share * winners.length;
      for (const w of winners) {
        const add = share + (rest > 0 ? 1 : 0);
        if (rest > 0) rest--;
        won.set(w.index, (won.get(w.index) || 0) + add);
      }
    }
    this.winners = [];
    for (const [i, amount] of won) {
      this.seats[i].stack += amount;
      this.seats[i].result = { won: amount };
      this.winners.push({ seat: i, amount, hand: this.seats[i].hand });
    }
    this.endHand();
  }

  endHand() {
    this.handOver = true;
    this.toAct = -1;
    this.emit({ type: 'end', winners: this.winners });
  }

  remainingDeckFor(seat) {
    // CPU から見えないカード（自分の手札とボード以外）
    const known = new Set(seat.hole.concat(this.board).map((c) => c.r + c.s));
    const out = [];
    for (const s of ['S', 'H', 'D', 'C']) for (let r = 1; r <= 13; r++) if (!known.has(r + s)) out.push({ r, s });
    return out;
  }
}

// CPU の簡易思考（難易度：普通）
export function cpuDecide(table, i, { rng = Math.random, iterations = 250, style = 0 } = {}) {
  const s = table.seats[i];
  const L = table.legal(i);
  const opponents = table.live().length - 1;
  const equity = estimateEquity(s.hole, table.board, Math.max(1, opponents), table.remainingDeckFor(s), iterations, rng);
  const pot = table.pot;
  const potOdds = L.toCall / (pot + L.toCall || 1);
  // 人数が多いほど必要な勝率は下がる。style>0 で強気
  const fair = 1 / (opponents + 1);
  const strength = equity / fair; // 1 で平均的
  const r = rng();
  const raiseTo = (frac) => Math.min(L.maxRaiseTo, Math.max(L.minRaiseTo, table.currentBet + Math.floor(pot * frac)));

  if (L.canCheck) {
    if (L.canRaise && (strength > 1.6 - style * 0.2 || (strength > 1.2 && r < 0.35) || r < 0.06)) {
      return { type: 'raise', to: raiseTo(strength > 2 ? 0.8 : 0.5) };
    }
    return { type: 'check' };
  }
  if (equity < potOdds * (0.9 - style * 0.1) && r > 0.06) return { type: 'fold' };
  if (L.canRaise && strength > 1.8 - style * 0.2 && r < 0.55) return { type: 'raise', to: raiseTo(0.7) };
  // 大きなベットには慎重に
  if (L.toCall > s.stack * 0.5 && strength < 1.3 && r > 0.15) return { type: 'fold' };
  return { type: 'call' };
}
