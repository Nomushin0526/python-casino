// テキサスホールデム（あなた vs CPU、5ハンド）
import { el, clear, cardEl, sleep, fmt, turnTimer } from '../ui.js';
import { HoldemTable, cpuDecide, STREET_NAMES } from '../lib/holdem.js';

const TURN_SEC = 25;
const CPU_NAMES = ['CPU アカネ', 'CPU ゲンジ', 'CPU ミドリ'];
const CPU_STYLE = [0.1, -0.1, 0.3];

export default {
  id: 'holdem',
  title: 'テキサスホールデム',
  icon: '♠',
  desc: '賭けチップをバイインにしてCPUと5ハンド勝負。増えた分×レバレッジが結果に！',
  payout: (cfg) => [['持ち込みの増減', 1], ['全員から取れば', cfg.cpuCount]],
  maxLoss: () => 1,
  intro: (cfg) => el('div',
    el('ul',
      el('li', `賭けたチップを「バイイン」としてテーブルに持ち込み、CPU ${cfg.cpuCount}人と ${cfg.hands} ハンド勝負します。`),
      el('li', '手札2枚＋場の5枚から一番強い5枚の役で勝負。賭け → フロップ(3枚) → ターン → リバーの順に進みます。'),
      el('li', '「チェック」=賭けずに回す、「コール」=同じ額を出す、「レイズ」=上乗せ、「フォールド」=降りる。'),
      el('li', `終了時の持ち込みチップの増減 × レバレッジ が結果になります（持ち込み以上は負けません）。`)),
    el('div.muted', '役の強さ：ストレートフラッシュ > フォーカード > フルハウス > フラッシュ > ストレート > スリーカード > ツーペア > ワンペア > ハイカード')),
  mount(root, ctx) {
    const { cfg, sound, bet } = ctx;
    let alive = true;
    const sb = Math.max(1, Math.round(bet * cfg.smallBlindRate));
    const bb = Math.max(sb * 2, Math.round(bet * cfg.bigBlindRate));
    const seats = [{ name: 'あなた', stack: bet, human: true }];
    for (let i = 0; i < cfg.cpuCount; i++) seats.push({ name: CPU_NAMES[i % CPU_NAMES.length], stack: bet, style: CPU_STYLE[i % CPU_STYLE.length] });
    const table = new HoldemTable({ seats, smallBlind: sb, bigBlind: bb });
    let waitingHuman = null;
    let reveal = false;

    // ---------- 画面 ----------
    const seatEls = table.seats.map(() => el('div.panel.col', { style: { padding: '8px 12px', gap: '4px', alignItems: 'center', minWidth: '170px', transition: 'box-shadow .2s' } }));
    const board = el('div.cards', { style: { '--cw': '66px', minHeight: '93px' } });
    const potEl = el('div.num', { style: { fontSize: '26px', fontWeight: 900, color: 'var(--gold)' } });
    const info = el('div.status-line');
    const handNoEl = el('div.muted');
    const timerHost = el('div', { style: { height: '22px' } });
    const btnFold = el('button.btn.danger', { on: { click: () => human({ type: 'fold' }) } }, 'フォールド', el('kbd', 'F'));
    const btnCall = el('button.btn.blue', { on: { click: () => human({ type: 'call' }) } }, 'コール', el('kbd', 'C'));
    const raiseBtns = el('div.row');
    const actions = el('div.col', { style: { alignItems: 'center', gap: '8px' } }, el('div.actions', btnFold, btnCall), raiseBtns);
    const nextBtn = el('button.btn.big.hidden', { on: { click: () => nextResolve?.() } }, '次のハンドへ', el('kbd', 'Enter'));
    let nextResolve = null;
    const timer = turnTimer(timerHost, TURN_SEC, () => human({ type: table.legal(0).canCheck ? 'check' : 'fold' }));

    const top = el('div.row', { style: { justifyContent: 'center', gap: '24px' } }, ...seatEls.slice(1));
    clear(root,
      el('div.row', { style: { width: 'min(1200px, 100%)', justifyContent: 'space-between' } }, handNoEl, el('div.muted', `ブラインド ${sb}/${bb}`)),
      el('div.table-felt.col', { style: { width: 'min(1200px, 100%)', flex: 1, padding: '12px 16px', alignItems: 'center', justifyContent: 'space-between', minHeight: 0, gap: '6px' } },
        top,
        el('div.col', { style: { alignItems: 'center', gap: '4px' } }, el('div', 'ポット ', potEl), board, info),
        el('div.row', { style: { gap: '20px', alignItems: 'center' } },
          seatEls[0],
          el('div.col', { style: { alignItems: 'center', gap: '8px', minWidth: '420px' } }, actions, nextBtn, timerHost))));

    function renderSeat(i) {
      const s = table.seats[i];
      const node = seatEls[i];
      const isTurn = table.toAct === i && !table.handOver;
      const showCards = s.human || (reveal && !s.folded && !s.out);
      const isWinner = table.winners?.some((w) => w.seat === i);
      node.style.boxShadow = isTurn ? '0 0 0 3px var(--gold), 0 0 30px rgba(246,196,83,.5)' : isWinner ? '0 0 0 3px var(--green), 0 0 30px rgba(61,220,132,.5)' : '';
      node.style.opacity = s.out ? 0.35 : s.folded ? 0.6 : 1;
      const cards = s.hole.length
        ? s.hole.map((c) => cardEl(c, { back: !showCards, size: s.human ? 72 : 44, cls: s.folded ? 'dim' : '' }))
        : [];
      clear(node,
        el('div.row', { style: { gap: '8px' } },
          el('b', s.name),
          table.dealer === i ? el('span', { style: { background: '#fff', color: '#000', borderRadius: '50%', width: '22px', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 900 } }, 'D') : null),
        el('div.cards', { style: { minHeight: 'auto', gap: '4px' } }, cards),
        el('div.num', { style: { color: 'var(--gold)', fontWeight: 800 } }, s.out ? '脱落' : `${fmt(s.stack)} チップ`),
        el('div.muted', { style: { fontSize: '15px', minHeight: '20px' } },
          isWinner ? `🏆 +${fmt(table.winners.find((w) => w.seat === i).amount)}${s.hand && reveal ? `（${s.hand.name}）` : ''}`
            : s.hand && reveal && !s.folded ? s.hand.name
              : [s.lastAction || '', s.bet ? `（場 ${s.bet}）` : ''].join(' ')));
    }

    function render() {
      table.seats.forEach((_, i) => renderSeat(i));
      board.replaceChildren(...(table.board || []).map((c) => cardEl(c, { size: 66 })));
      potEl.textContent = fmt(table.pot);
      handNoEl.textContent = `ハンド ${table.handNo} / ${cfg.hands}　${STREET_NAMES[table.street] || ''}`;
      const myTurn = !!waitingHuman;
      actions.style.visibility = myTurn ? 'visible' : 'hidden';
      if (myTurn) {
        const L = table.legal(0);
        btnCall.firstChild.textContent = L.canCheck ? 'チェック' : L.toCall >= table.seats[0].stack ? `オールイン ${L.toCall}` : `コール ${L.toCall}`;
        const pot = table.pot;
        const opts = [];
        if (L.canRaise) {
          const add = (label, to) => {
            to = Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, Math.floor(to)));
            if (!opts.some((o) => o.to === to)) opts.push({ label, to });
          };
          add(table.currentBet ? 'ミニマムレイズ' : 'ミニマムベット', L.minRaiseTo);
          add('½ポット', table.currentBet + pot / 2);
          add('ポット', table.currentBet + pot);
          add('オールイン', L.maxRaiseTo);
        }
        raiseBtns.replaceChildren(...opts.map((o, k) => el('button.btn.small', { on: { click: () => human({ type: 'raise', to: o.to }) } },
          `${o.label} ${o.to}`, el('kbd', String(k + 1)))));
        btnFold.disabled = L.canCheck; // チェックできるときに降りる必要はない
      }
    }

    function human(action) {
      if (!waitingHuman) return;
      const r = waitingHuman;
      waitingHuman = null;
      timer.stop();
      sound.chip();
      table.act(0, action);
      r();
    }

    async function playHand() {
      reveal = false;
      table.startHand();
      sound.card();
      render();
      let lastStreet = table.street;
      while (alive && !table.handOver) {
        const i = table.toAct;
        if (table.seats[i].human) {
          info.textContent = 'あなたの番です';
          await new Promise((res) => { waitingHuman = res; render(); timer.start(); });
        } else {
          info.textContent = `${table.seats[i].name} が考え中…`;
          render();
          await sleep(650 + Math.random() * 500);
          if (!alive) return;
          table.act(i, cpuDecide(table, i, { style: table.seats[i].style }));
          sound.chip();
        }
        if (table.street !== lastStreet && table.street !== 'showdown') {
          lastStreet = table.street;
          sound.card();
          info.textContent = STREET_NAMES[table.street];
          render();
          await sleep(500);
        }
        render();
      }
      if (!alive) return;
      reveal = table.street === 'showdown';
      if (reveal) sound.card();
      const w = table.winners || [];
      const names = w.map((x) => table.seats[x.seat].name).join('・');
      info.textContent = w.some((x) => x.seat === 0) ? `あなたの勝ち！（${names}）` : `${names} の勝ち`;
      if (w.some((x) => x.seat === 0)) sound.win();
      render();
    }

    async function run() {
      await sleep(400);
      for (let h = 0; h < cfg.hands && alive; h++) {
        if (table.seats[0].stack <= 0 || table.seats.slice(1).every((s) => s.stack <= 0)) break;
        await playHand();
        if (!alive) return;
        const last = h === cfg.hands - 1 || table.seats[0].stack <= 0 || table.seats.slice(1).every((s) => s.stack <= 0);
        nextBtn.firstChild.textContent = last ? '結果を見る' : '次のハンドへ';
        nextBtn.classList.remove('hidden');
        await Promise.race([new Promise((r) => { nextResolve = r; }), sleep(6000)]);
        nextResolve = null;
        nextBtn.classList.add('hidden');
      }
      if (!alive) return;
      const stack = table.seats[0].stack;
      info.textContent = `終了！ 持ち込み ${fmt(bet)} → ${fmt(stack)}`;
      await sleep(1200);
      if (alive) ctx.finish({ finalStack: stack });
    }

    const onKey = (e) => {
      if (e.key === 'Enter' && nextResolve) return nextResolve();
      if (!waitingHuman) return;
      const k = e.key.toLowerCase();
      if (k === 'f' && !btnFold.disabled) human({ type: 'fold' });
      else if (k === 'c') human({ type: 'call' });
      else if (/^[1-4]$/.test(k)) raiseBtns.children[Number(k) - 1]?.click();
    };
    window.addEventListener('keydown', onKey);
    run();
    return () => {
      alive = false;
      timer.stop();
      window.removeEventListener('keydown', onKey);
    };
  },
};
