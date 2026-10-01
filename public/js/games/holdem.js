// テキサスホールデム（あなた vs CPU、5ハンド）
import { el, clear, cardEl, sleep, fmt, turnTimer, gameLayout, sideRow, miniCards } from '../ui.js';
import { HoldemTable, cpuDecide } from '../lib/holdem.js';
import { evaluate, estimateEquity } from '../lib/poker.js';

const TURN_SEC = 25;
const CPU_NAMES = ['CPU アカネ', 'CPU ゲンジ', 'CPU ミドリ'];
const CPU_STYLE = [0.1, -0.1, 0.3];

// 進行段階のやさしい名前
const STAGE = {
  preflop: '① 手札2枚が配られた',
  flop: '② 場に3枚オープン',
  turn: '③ 場に4枚目',
  river: '④ 場に5枚目（最後）',
  showdown: '⑤ 手札を見せ合って勝負',
};

// 役の一覧（強い順）。例のカードも表示する
export const HANDS = [
  { cat: 8, name: 'ストレートフラッシュ', desc: '同じマークで数字が5つ連続', ex: '5H 6H 7H 8H 9H' },
  { cat: 7, name: 'フォーカード', desc: '同じ数字が4枚', ex: 'KS KH KD KC 2D' },
  { cat: 6, name: 'フルハウス', desc: '同じ数字3枚 ＋ 同じ数字2枚', ex: 'QS QH QD 7C 7H' },
  { cat: 5, name: 'フラッシュ', desc: '同じマークが5枚（数字はバラバラでOK）', ex: '2C 5C 8C JC AC' },
  { cat: 4, name: 'ストレート', desc: '数字が5つ連続（マークは何でもOK）', ex: '4D 5S 6H 7C 8D' },
  { cat: 3, name: 'スリーカード', desc: '同じ数字が3枚', ex: '9S 9H 9D KC 3H' },
  { cat: 2, name: 'ツーペア', desc: '同じ数字2枚の組が2つ', ex: 'JS JD 4H 4C AS' },
  { cat: 1, name: 'ワンペア', desc: '同じ数字が2枚', ex: '10S 10H KD 6C 2S' },
  { cat: 0, name: '役なし（ハイカード）', desc: '役がないときは一番強いカードで比べる', ex: 'AS KD 9H 5C 2D' },
];

// エンジンのアクション表記 → やさしい言葉
function friendly(action) {
  if (!action) return '';
  return action
    .replace(/^SB (\d+)/, '参加料 $1')
    .replace(/^BB (\d+)/, '参加料 $1')
    .replace('フォールド', '降りた')
    .replace('チェック', '様子見')
    .replace(/^コール (\d+)/, '同額 $1')
    .replace(/^レイズ (\d+)/, '上乗せ → $1')
    .replace(/^オールイン (\d+)/, '全部賭け！ $1');
}

// 2枚以上の手札＋場から今の役のカテゴリを出す
function currentCategory(hole, board) {
  const all = hole.concat(board);
  if (all.length >= 5) return evaluate(all);
  if (all.length === 2 && all[0].r === all[1].r) return { cat: 1, name: 'ワンペア' };
  return { cat: 0, name: '役なし' };
}

export default {
  id: 'holdem',
  title: 'テキサスホールデム',
  icon: '♠',
  desc: '賭けチップを持ち込んでCPUと5回勝負。増えた分×レバレッジが結果に！',
  payout: (cfg) => [['持ち込みの増減', 1], ['全員から取れば', cfg.cpuCount]],
  maxLoss: () => 1,
  intro: (cfg) => el('div',
    el('ul',
      el('li', `賭けたチップをテーブルに持ち込み、CPU ${cfg.cpuCount}人と ${cfg.hands} 回勝負します。`),
      el('li', '自分の手札2枚 ＋ 全員共通の場のカード5枚 から、いちばん強い5枚の「役」で勝負します。'),
      el('li', '場のカードは 3枚 → 4枚目 → 5枚目 と順番に開いていき、そのたびに賭けるかどうか決めます。'),
      el('li', '最後まで残った人の中で役がいちばん強い人が、場に集まったチップを全部もらえます。')),
    el('h3', 'ボタンの意味'),
    el('table', el('tbody',
      el('tr', el('th', '様子見'), el('td', 'チップを出さずに次の人へ（誰も賭けていないときだけ）')),
      el('tr', el('th', '同額を出す'), el('td', '前の人と同じだけチップを出して勝負を続ける')),
      el('tr', el('th', '上乗せ'), el('td', 'もっとチップを出して相手にプレッシャーをかける')),
      el('tr', el('th', '降りる'), el('td', 'この回は勝負をあきらめる（それまでに出したチップは戻らない）')),
      el('tr', el('th', '参加料'), el('td', '毎回2人が自動で出す最初のチップ（ブラインド）')))),
    el('p.muted', `終わったときの持ち込みチップの増減 × レバレッジ が結果になります（持ち込んだ分より多くは負けません）。`),
    el('h3', '役の強さ（上ほど強い）'),
    el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } },
      HANDS.map((h) => sideRow({ title: h.name, desc: h.desc, visual: miniCards(h.ex, 26) })))),
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

    const { main, side } = gameLayout(root, '役の強さ（上ほど強い）');

    // ---------- 早見表 ----------
    const myHandEl = el('div', { style: { fontSize: '20px', fontWeight: 900, color: 'var(--green)' } }, '—');
    const meterBar = el('div', { style: { height: '100%', width: '0%', background: 'linear-gradient(90deg, #ff4d5e, #f6c453, #3ddc84)', transition: 'width .4s' } });
    const meterText = el('span.muted', { style: { fontSize: '12px' } }, '');
    const handRows = HANDS.map((h) => sideRow({ title: h.name, desc: h.desc, visual: miniCards(h.ex, 24) }));
    clear(side,
      el('div.side-row', { style: { background: 'rgba(61,220,132,.08)' } },
        el('div.muted', { style: { fontSize: '13px' } }, 'あなたの今の役'), myHandEl,
        el('div.muted', { style: { fontSize: '13px', marginTop: '6px' } }, '勝てそう度 ', meterText),
        el('div', { style: { height: '10px', borderRadius: '5px', background: 'rgba(255,255,255,.12)', overflow: 'hidden' } }, meterBar)),
      ...handRows);

    let equityKey = '';
    function updateSide() {
      const me = table.seats[0];
      if (!me.hole.length) return;
      const cur = currentCategory(me.hole, table.board || []);
      myHandEl.textContent = cur.name;
      handRows.forEach((row, k) => row.classList.toggle('on', HANDS[k].cat === cur.cat));
      // 勝てそう度（残っている相手に対する勝率の目安）
      const opp = table.live().length - 1;
      const key = `${table.handNo}-${(table.board || []).length}-${opp}-${me.folded}`;
      if (key !== equityKey) {
        equityKey = key;
        if (me.folded || opp <= 0) {
          meterBar.style.width = '0%';
          meterText.textContent = me.folded ? '（降りました）' : '';
        } else {
          const eq = estimateEquity(me.hole, table.board || [], opp, table.remainingDeckFor(me), 300);
          meterBar.style.width = Math.round(eq * 100) + '%';
          meterText.textContent = eq > 0.6 ? '★★★ かなり強い！' : eq > 0.4 ? '★★ まあまあ' : eq > 0.25 ? '★ ちょっと弱い' : '△ 厳しい';
        }
      }
    }

    // ---------- 画面 ----------
    const seatEls = table.seats.map(() => el('div.panel.col', { style: { padding: '8px 12px', gap: '4px', alignItems: 'center', minWidth: '160px', transition: 'box-shadow .2s' } }));
    const board = el('div.cards', { style: { '--cw': '62px', minHeight: '87px' } });
    const potEl = el('div.num', { style: { fontSize: '26px', fontWeight: 900, color: 'var(--gold)' } });
    const info = el('div.status-line');
    const handNoEl = el('div.muted');
    const stageEl = el('div', { style: { fontWeight: 800, color: 'var(--gold)' } });
    const timerHost = el('div', { style: { height: '22px' } });
    const btnFold = el('button.btn.danger', { on: { click: () => human({ type: 'fold' }) } }, '降りる', el('kbd', 'F'));
    const btnCall = el('button.btn.blue', { on: { click: () => human({ type: 'call' }) } }, '同額を出す', el('kbd', 'C'));
    const raiseBtns = el('div.row.wrap', { style: { justifyContent: 'center' } });
    const hint = el('div.muted', { style: { fontSize: '13px', textAlign: 'center' } });
    const actions = el('div.col', { style: { alignItems: 'center', gap: '6px' } }, el('div.actions', btnFold, btnCall), raiseBtns, hint);
    const nextBtn = el('button.btn.big.hidden', { on: { click: () => nextResolve?.() } }, '次の勝負へ', el('kbd', 'Enter'));
    let nextResolve = null;
    const timer = turnTimer(timerHost, TURN_SEC, () => human({ type: table.legal(0).canCheck ? 'check' : 'fold' }));

    const top = el('div.row', { style: { justifyContent: 'center', gap: '18px' } }, ...seatEls.slice(1));
    clear(main,
      el('div.row', { style: { width: '100%', justifyContent: 'space-between' } }, handNoEl, stageEl, el('div.muted', `参加料 ${sb}/${bb}`)),
      el('div.table-felt.col', { style: { width: '100%', flex: 1, padding: '10px 14px', alignItems: 'center', justifyContent: 'space-between', minHeight: 0, gap: '6px' } },
        top,
        el('div.col', { style: { alignItems: 'center', gap: '4px' } }, el('div', '場に集まったチップ ', potEl), board, info),
        el('div.row', { style: { gap: '16px', alignItems: 'center' } },
          seatEls[0],
          el('div.col', { style: { alignItems: 'center', gap: '8px', minWidth: '400px' } }, actions, nextBtn, timerHost))));

    function renderSeat(i) {
      const s = table.seats[i];
      const node = seatEls[i];
      const isTurn = table.toAct === i && !table.handOver;
      const showCards = s.human || (reveal && !s.folded && !s.out);
      const isWinner = table.winners?.some((w) => w.seat === i);
      node.style.boxShadow = isTurn ? '0 0 0 3px var(--gold), 0 0 30px rgba(246,196,83,.5)' : isWinner ? '0 0 0 3px var(--green), 0 0 30px rgba(61,220,132,.5)' : '';
      node.style.opacity = s.out ? 0.35 : s.folded ? 0.6 : 1;
      const cardsEls = s.hole.length
        ? s.hole.map((c) => cardEl(c, { back: !showCards, size: s.human ? 70 : 42, cls: s.folded ? 'dim' : '' }))
        : [];
      clear(node,
        el('div.row', { style: { gap: '8px' } },
          el('b', s.name),
          table.dealer === i ? el('span', { title: '親', style: { background: '#fff', color: '#000', borderRadius: '50%', width: '22px', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 900 } }, '親') : null),
        el('div.cards', { style: { minHeight: 'auto', gap: '4px' } }, cardsEls),
        el('div.num', { style: { color: 'var(--gold)', fontWeight: 800 } }, s.out ? 'チップ切れ' : `${fmt(s.stack)} チップ`),
        el('div.muted', { style: { fontSize: '15px', minHeight: '20px' } },
          isWinner ? `🏆 +${fmt(table.winners.find((w) => w.seat === i).amount)}${s.hand && reveal ? `（${s.hand.name}）` : ''}`
            : s.hand && reveal && !s.folded ? s.hand.name
              : [friendly(s.lastAction), s.bet ? `（出した ${s.bet}）` : ''].join(' ')));
    }

    function render() {
      table.seats.forEach((_, i) => renderSeat(i));
      board.replaceChildren(...(table.board || []).map((c) => cardEl(c, { size: 62 })),
        ...Array.from({ length: 5 - (table.board || []).length }, () => cardEl(null, { back: true, size: 62, cls: 'dim' })));
      potEl.textContent = fmt(table.pot);
      handNoEl.textContent = `${table.handNo} / ${cfg.hands} 回目`;
      stageEl.textContent = STAGE[table.street] || '';
      updateSide();
      const myTurn = !!waitingHuman;
      actions.style.visibility = myTurn ? 'visible' : 'hidden';
      if (myTurn) {
        const L = table.legal(0);
        const me = table.seats[0];
        btnCall.firstChild.textContent = L.canCheck ? '様子見（0枚）' : L.toCall >= me.stack ? `全部出して勝負 ${L.toCall}` : `同額を出す ${L.toCall}`;
        const pot = table.pot;
        const opts = [];
        if (L.canRaise) {
          const add = (label, to) => {
            to = Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, Math.floor(to)));
            if (!opts.some((o) => o.to === to)) opts.push({ label, to });
          };
          add('少し上乗せ', L.minRaiseTo);
          add('しっかり上乗せ', table.currentBet + pot / 2);
          add('大きく上乗せ', table.currentBet + pot);
          add('全部賭ける！', L.maxRaiseTo);
        }
        raiseBtns.replaceChildren(...opts.map((o, k) => el('button.btn.small', { on: { click: () => human({ type: 'raise', to: o.to }) } },
          `${o.label} → ${o.to - me.bet}枚`, el('kbd', String(k + 1)))));
        btnFold.disabled = L.canCheck; // 様子見できるときに降りる必要はない
        hint.textContent = L.canCheck
          ? '誰も賭けていないので「様子見」でタダで次へ進めます'
          : `続けるには ${L.toCall} チップ必要です。役が弱そうなら「降りる」のも作戦`;
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
      equityKey = '';
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
          info.textContent = STAGE[table.street];
          render();
          await sleep(600);
        }
        render();
      }
      if (!alive) return;
      reveal = table.street === 'showdown';
      if (reveal) sound.card();
      const w = table.winners || [];
      const names = w.map((x) => table.seats[x.seat].name).join('・');
      const how = reveal && w[0]?.hand ? `（${w[0].hand.name}）` : '（ほかの全員が降りた）';
      info.textContent = w.some((x) => x.seat === 0) ? `あなたの勝ち！${how}` : `${names} の勝ち${how}`;
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
        nextBtn.firstChild.textContent = last ? '結果を見る' : '次の勝負へ';
        nextBtn.classList.remove('hidden');
        await Promise.race([new Promise((r) => { nextResolve = r; }), sleep(7000)]);
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
