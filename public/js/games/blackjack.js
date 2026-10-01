// ブラックジャック（6デッキ・毎回シャッフル・ディーラー17でスタンド・スプリットなし）
import { el, clear, cardEl, sleep, turnTimer, gameLayout, sideRow, miniCards, multLabel } from '../ui.js';
import { makeShoe } from '../lib/cards.js';
import { handValue, isBlackjack, dealerShouldHit, judge } from '../lib/blackjack.js';

const TURN_SEC = 20;

export default {
  id: 'blackjack',
  title: 'ブラックジャック',
  icon: '🂡',
  desc: 'カードの合計を21に近づけてディーラーに勝とう。21を超えたら負け！',
  payout: (cfg) => [['勝ち', cfg.multipliers.win], ['BJ', cfg.multipliers.blackjack], ['引分', cfg.multipliers.push], ['負け', cfg.multipliers.lose]],
  maxLoss: (cfg) => -cfg.multipliers.lose * 2, // ダブルダウン時
  intro: (cfg) => el('div',
    el('ul',
      el('li', 'ディーラー（親）と1対1。カードの合計を 21 に近づけた方が勝ち。21 を超えたら「バースト」で負け。'),
      el('li', '最初に2枚配られます。もっと引くか、そこで止めるかを決めます。'),
      el('li', `ディーラーは合計が ${cfg.dealerStandsOn} 以上になるまで必ず引きます。`),
      el('li', '最初の2枚で「A ＋ 10点のカード」＝ ブラックジャック！ ふつうの勝ちより多くもらえます。')),
    el('h3', 'ボタンの意味'),
    el('table', el('tbody',
      el('tr', el('th', 'もう1枚引く'), el('td', 'カードをもう1枚もらう（ヒット）')),
      el('tr', el('th', 'これで勝負'), el('td', '今の合計で止めて、ディーラーと比べる（スタンド）')),
      el('tr', el('th', '賭け2倍で1枚だけ'), el('td', '結果が2倍になる代わりに、あと1枚だけ引いて終わり（ダブルダウン）')))),
    el('h3', 'カードの数え方'), cardValueRows()),
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
    const btnHit = el('button.btn.big.blue', { on: { click: () => hit() } }, 'もう1枚引く', el('kbd', 'H'), el('span.easy-label', 'ヒット'));
    const btnStand = el('button.btn.big', { on: { click: () => stand() } }, 'これで勝負', el('kbd', 'S'), el('span.easy-label', 'スタンド'));
    const btnDouble = el('button.btn.big.danger', { on: { click: () => doubleDown() } }, '賭け2倍で1枚だけ', el('kbd', 'D'), el('span.easy-label', 'ダブルダウン'));
    const hint = el('div.muted', { style: { fontSize: '15px', minHeight: '22px', textAlign: 'center' } });
    const timer = turnTimer(timerHost, TURN_SEC, () => stand());

    const { main, side } = gameLayout(root, 'ブラックジャック早見表');
    clear(side,
      sideRow({ title: '目標', desc: '合計を 21 に近づける。21 を超えたら負け（バースト）' }),
      el('h4', 'カードの数え方'), cardValueRows(),
      el('h4', 'ディーラーのルール'),
      sideRow({ title: `${cfg.dealerStandsOn - 1}以下 → 必ず引く`, desc: `${cfg.dealerStandsOn} 以上になったら止まる` }),
      el('h4', 'もらえるチップ（倍率）'),
      sideRow({ title: 'ブラックジャック', note: multLabel(cfg.multipliers.blackjack), desc: '最初の2枚が A と 10点札', visual: miniCards('AS KH', 26) }),
      sideRow({ title: '勝ち', note: multLabel(cfg.multipliers.win), desc: 'ディーラーより21に近い／ディーラーがバースト' }),
      sideRow({ title: '引き分け', note: multLabel(cfg.multipliers.push), desc: '同じ合計' }),
      sideRow({ title: '負け', note: multLabel(cfg.multipliers.lose), desc: '21を超えた／ディーラーの方が近い' }),
      sideRow({ title: '賭け2倍で1枚だけ', desc: '勝ちも負けも倍率が2倍になる' }));
    clear(main,
      el('div.table-felt.col', { style: { width: '100%', flex: 1, padding: '24px', alignItems: 'center', justifyContent: 'space-around' } },
        el('div.col', { style: { alignItems: 'center' } }, el('div.muted', `ディーラー（${cfg.dealerStandsOn}以上で止まる）`), dealerCards, dealerVal),
        status,
        el('div.col', { style: { alignItems: 'center' } }, playerCards, playerVal, el('div.muted', 'あなた'))),
      el('div.col', { style: { alignItems: 'center', marginTop: '12px', gap: '6px' } }, el('div.actions', btnHit, btnStand, btnDouble), hint, timerHost),
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
      const t = pv.total;
      hint.textContent = !canAct || !player.length ? ''
        : t <= 11 ? `合計 ${t}：次に何が来ても21を超えないので「もう1枚引く」が安心`
          : t >= 17 ? `合計 ${t}：もう1枚引くと21を超えやすい`
            : `合計 ${t}：ディーラーの見えているカードが7以上なら引く人が多い`;
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
      status.textContent = 'もう1枚引く？ これで勝負？';
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
        status.textContent = '21を超えた！バースト…';
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
      status.textContent = '賭け2倍！（あと1枚だけ引きます）';
      sound.chip();
      await draw(player);
      if (handValue(player).total > 21) {
        status.textContent = '21を超えた！バースト…';
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

function cardValueRows() {
  return el('div.col', { style: { gap: '6px' } },
    sideRow({ title: 'A（エース）', note: '1 か 11', desc: '都合のいい方で数えてくれます', visual: miniCards('AS AH', 26) }),
    sideRow({ title: '2〜10', note: '数字どおり', visual: miniCards('2D 5C 7H 10S', 26) }),
    sideRow({ title: 'J・Q・K', note: '10', desc: '絵札はすべて10点', visual: miniCards('JC QD KS', 26) }));
}
