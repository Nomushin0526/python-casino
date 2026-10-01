// ブラックジャック（6デッキ・毎回シャッフル・ディーラー17でスタンド・スプリットなし）
import { el, clear, cardEl, sleep, turnTimer } from '../ui.js';
import { makeShoe } from '../lib/cards.js';
import { handValue, isBlackjack, dealerShouldHit, judge } from '../lib/blackjack.js';

const TURN_SEC = 20;

export default {
  id: 'blackjack',
  title: 'ブラックジャック',
  icon: '🂡',
  desc: '21に近づけてディーラーに勝とう。ヒット・スタンド・ダブルダウン。',
  payout: (cfg) => [['勝ち', cfg.multipliers.win], ['BJ', cfg.multipliers.blackjack], ['引分', cfg.multipliers.push], ['負け', cfg.multipliers.lose]],
  maxLoss: (cfg) => -cfg.multipliers.lose * 2, // ダブルダウン時
  mount(root, ctx) {
    const { sound, cfg } = ctx;
    const shoe = makeShoe({ decks: cfg.decks });
    const player = [];
    const dealer = [];
    let doubled = false;
    let holeHidden = true;
    let busy = true;
    let alive = true;

    const dealerCards = el('div.cards');
    const playerCards = el('div.cards');
    const dealerVal = el('div.status-line');
    const playerVal = el('div.status-line');
    const status = el('div.status-line', { style: { fontSize: '30px', color: 'var(--gold)' } });
    const timerHost = el('div', { style: { height: '24px' } });
    const btnHit = el('button.btn.big.blue', { on: { click: () => hit() } }, 'ヒット', el('kbd', 'H'));
    const btnStand = el('button.btn.big', { on: { click: () => stand() } }, 'スタンド', el('kbd', 'S'));
    const btnDouble = el('button.btn.big.danger', { on: { click: () => doubleDown() } }, 'ダブルダウン', el('kbd', 'D'));
    const timer = turnTimer(timerHost, TURN_SEC, () => stand());

    clear(root,
      el('div.table-felt.col', { style: { width: 'min(1100px, 100%)', flex: 1, padding: '24px', alignItems: 'center', justifyContent: 'space-around' } },
        el('div.col', { style: { alignItems: 'center' } }, el('div.muted', 'ディーラー（17以上でスタンド）'), dealerCards, dealerVal),
        status,
        el('div.col', { style: { alignItems: 'center' } }, playerCards, playerVal, el('div.muted', 'あなた'))),
      el('div.col', { style: { alignItems: 'center', marginTop: '12px' } }, el('div.actions', btnHit, btnStand, btnDouble), timerHost),
    );

    function render() {
      dealerCards.replaceChildren(...dealer.map((c, i) => cardEl(c, { back: i === 1 && holeHidden, cls: c._new ? 'deal' : '' })));
      playerCards.replaceChildren(...player.map((c) => cardEl(c, { cls: c._new ? 'deal' : '' })));
      for (const c of [...dealer, ...player]) c._new = false;
      const pv = handValue(player);
      playerVal.textContent = player.length ? `${pv.soft && pv.total <= 21 ? 'ソフト ' : ''}${pv.total}` : '';
      if (holeHidden) dealerVal.textContent = dealer.length ? `${handValue([dealer[0]]).total} + ?` : '';
      else dealerVal.textContent = String(handValue(dealer).total);
      const canAct = !busy && alive;
      btnHit.disabled = !canAct;
      btnStand.disabled = !canAct;
      btnDouble.disabled = !canAct || player.length !== 2;
    }

    async function draw(hand) {
      const c = shoe.pop();
      c._new = true;
      hand.push(c);
      sound.card();
      render();
      await sleep(380);
    }

    async function start() {
      await sleep(300);
      await draw(player);
      await draw(dealer);
      await draw(player);
      await draw(dealer);
      if (isBlackjack(player) || isBlackjack(dealer)) {
        holeHidden = false;
        render();
        return end();
      }
      busy = false;
      render();
      status.textContent = 'ヒット？ スタンド？';
      timer.start();
    }

    async function hit() {
      if (busy) return;
      busy = true;
      timer.stop();
      sound.click();
      await draw(player);
      const v = handValue(player).total;
      if (v > 21) {
        status.textContent = 'バースト！';
        return end();
      }
      if (v === 21) return dealerTurn();
      busy = false;
      render();
      timer.start();
    }

    function stand() {
      if (busy) return;
      busy = true;
      timer.stop();
      sound.click();
      dealerTurn();
    }

    async function doubleDown() {
      if (busy || player.length !== 2) return;
      busy = true;
      timer.stop();
      doubled = true;
      status.textContent = 'ダブルダウン！（倍率2倍・1枚だけ引く）';
      sound.chip();
      await draw(player);
      if (handValue(player).total > 21) {
        status.textContent = 'バースト！';
        return end();
      }
      dealerTurn();
    }

    async function dealerTurn() {
      render();
      status.textContent = 'ディーラーの番';
      await sleep(400);
      holeHidden = false;
      sound.card();
      render();
      await sleep(500);
      while (alive && dealerShouldHit(dealer, cfg.dealerStandsOn)) await draw(dealer);
      end();
    }

    async function end() {
      busy = true;
      timer.stop();
      holeHidden = false;
      render();
      const outcome = judge(player, dealer);
      const msg = { win: 'あなたの勝ち！', blackjack: 'ブラックジャック！', push: '引き分け', lose: 'ディーラーの勝ち…' }[outcome];
      const dv = handValue(dealer).total;
      status.textContent = (dv > 21 ? 'ディーラーがバースト！ ' : '') + msg;
      await sleep(1600);
      if (alive) ctx.finish({ outcome, doubled });
    }

    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'h') hit();
      else if (k === 's') stand();
      else if (k === 'd') doubleDown();
    };
    window.addEventListener('keydown', onKey);
    render();
    start();
    return () => {
      alive = false;
      timer.stop();
      window.removeEventListener('keydown', onKey);
    };
  },
};
