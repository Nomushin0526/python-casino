// 花札こいこい（あなた vs CPU、3月制）
import { el, clear, hanaEl, sleep, turnTimer, gameLayout, sideRow } from '../ui.js';
import { KoikoiRound, calcYaku, byId, CARDS, cpuPickCard, cpuPickField, cpuDecideKoikoi } from '../lib/koikoi.js';

const TURN_SEC = 20;

const idOf = (name) => CARDS.find((c) => c.name === name).id;
const ofType = (type) => CARDS.filter((c) => c.type === type).map((c) => c.id);

// 役の早見表（必要な札の絵つき）。need: 必要枚数、cards: 対象の札
const YAKU_GUIDE = [
  { names: ['五光', '四光', '雨四光', '三光'], title: '光の役', note: '5〜10点', desc: '光札を3枚で三光(5)、4枚で四光(8)、5枚で五光(10)。柳の小野道風は雨扱い（雨入り4枚は7点）', cards: ofType('hikari'), need: 3 },
  { names: ['花見で一杯'], title: '花見で一杯', note: '5点', desc: '桜に幕 ＋ 菊に盃', cards: [idOf('桜に幕'), idOf('菊に盃')], need: 2 },
  { names: ['月見で一杯'], title: '月見で一杯', note: '5点', desc: '芒に月 ＋ 菊に盃', cards: [idOf('芒に月'), idOf('菊に盃')], need: 2 },
  { names: ['猪鹿蝶'], title: '猪鹿蝶（いのしかちょう）', note: '5点', desc: '萩の猪・紅葉の鹿・牡丹の蝶', cards: [idOf('萩に猪'), idOf('紅葉に鹿'), idOf('牡丹に蝶')], need: 3 },
  { names: ['赤短'], title: '赤短（あかたん）', note: '5点〜', desc: '松・梅・桜の赤い短冊', cards: [idOf('松に赤短'), idOf('梅に赤短'), idOf('桜に赤短')], need: 3 },
  { names: ['青短'], title: '青短（あおたん）', note: '5点〜', desc: '牡丹・菊・紅葉の青い短冊', cards: [idOf('牡丹に青短'), idOf('菊に青短'), idOf('紅葉に青短')], need: 3 },
  { names: ['タネ'], title: 'タネ', note: '1点〜', desc: '動物などの札を5枚で1点（1枚ごとに+1）', cards: ofType('tane'), need: 5 },
  { names: ['タン'], title: 'タン', note: '1点〜', desc: '短冊の札を5枚で1点（1枚ごとに+1）', cards: ofType('tan'), need: 5 },
  { names: ['カス'], title: 'カス', note: '1点〜', desc: 'カス札を10枚で1点（1枚ごとに+1）', cards: ofType('kasu'), need: 10, countOnly: true },
];

// 早見表を作る。update(取り札) で集めた札を明るく・成立した役を強調する
function yakuGuide({ size = 26 } = {}) {
  const rows = YAKU_GUIDE.map((y) => {
    const cardsEls = y.countOnly ? [] : y.cards.map((id) => ({ id, node: hanaEl(id, { cls: 'small', size }) }));
    const progress = el('span.side-note', '');
    const row = sideRow({
      title: y.title, note: y.note, desc: y.desc,
      visual: el('div.mini-cards', cardsEls.map((x) => x.node), progress),
    });
    return { y, row, cardsEls, progress };
  });
  return {
    nodes: rows.map((r) => r.row),
    update(captured) {
      const have = new Set(captured);
      const { yaku } = calcYaku(captured);
      const made = new Set(yaku.map((x) => x.name));
      for (const r of rows) {
        const got = r.y.cards.filter((id) => have.has(id)).length;
        for (const x of r.cardsEls) x.node.classList.toggle('dim', !have.has(x.id));
        r.progress.textContent = `${got} / ${r.y.need}`;
        const done = r.y.names.some((n) => made.has(n));
        r.row.classList.toggle('done', done);
        r.row.classList.toggle('on', !done && got >= r.y.need - 1 && got > 0);
      }
    },
  };
}

export default {
  id: 'koikoi',
  title: '花札（こいこい）',
  icon: '🌸',
  desc: 'CPUと3か月勝負。同じ月の札を合わせて役を作ろう。',
  payout: (cfg) => [[`大勝(${cfg.bigWinDiff}点差〜)`, cfg.multipliers.bigWin], ['勝ち', cfg.multipliers.win], ['引分', cfg.multipliers.draw], ['負け', cfg.multipliers.lose]],
  intro: (cfg) => el('div',
    el('ul',
      el('li', `CPUと${cfg.rounds}か月（${cfg.rounds}局）勝負。合計点の差で結果が決まります。`),
      el('li', '手札を1枚出し、場に同じ月の札があれば取れます。その後、山札を1枚めくって同じように合わせます。'),
      el('li', '役ができたら「あがり」でその月の点数を獲得。「こいこい」で続けるともっと点を狙えますが、相手に役ができると相手の点が2倍に！'),
      cfg.sevenPointsDoubles ? el('li', '7点以上の役は点数2倍。') : null),
    el('h3', '札の見かた'),
    el('div.mini-cards', ['h0', 'h4', 'h1', 'h2'].map((id) => hanaEl(id, { size: 50 })),
      el('span.arrow', '左から 光（いちばん強い）・タネ（動物など）・短冊・カス。上の漢字が「月」です')),
    el('h3', '役一覧'),
    el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } }, yakuGuide({ size: 30 }).nodes)),
  mount(root, ctx) {
    const { cfg, sound } = ctx;
    let alive = true;
    const totals = [0, 0];
    let roundNo = 0;
    let round = null;
    let waiting = null; // { kind: 'hand' | 'field' | 'decide', resolve }
    const roundResults = [];

    const cpuCap = el('div.row.wrap', { style: { gap: '3px', minHeight: '58px' } });
    const cpuHand = el('div.row', { style: { gap: '4px' } });
    const fieldEl = el('div.row.wrap', { style: { gap: '8px', justifyContent: 'center', maxWidth: '760px', minHeight: '220px', alignContent: 'center' } });
    const deckEl = el('div.col', { style: { alignItems: 'center', gap: '4px' } });
    const myCap = el('div.row.wrap', { style: { gap: '3px', minHeight: '58px' } });
    const myHand = el('div.row', { style: { gap: '8px', justifyContent: 'center' } });
    const scoreEl = el('div', { style: { fontSize: '20px', fontWeight: 800 } });
    const msg = el('div.status-line');
    const myYaku = el('div.muted', { style: { minHeight: '22px' } });
    const cpuYaku = el('div.muted', { style: { minHeight: '22px' } });
    const timerHost = el('div', { style: { height: '22px' } });
    const modalHost = el('div');
    const timer = turnTimer(timerHost, TURN_SEC, () => autoAct());

    const { main, side } = gameLayout(root, '役の早見表');
    const guide = yakuGuide();
    clear(side, el('div.side-desc', '集めた札が明るく表示されます。緑はあと1枚、金色は役が完成！'), guide.nodes);

    clear(main,
      el('div.row', { style: { width: '100%' } }, scoreEl),
      el('div.table-felt.col', { style: { width: '100%', flex: 1, padding: '12px 18px', gap: '8px', minHeight: 0, justifyContent: 'space-between' } },
        el('div.row', el('b', 'CPU'), cpuHand, el('div.spacer'), cpuYaku),
        el('div.row', el('span.muted', '取り札'), cpuCap),
        el('div.row', { style: { justifyContent: 'center', gap: '30px' } }, fieldEl, deckEl),
        el('div.row', el('span.muted', '取り札'), myCap),
        el('div.row', el('b', 'あなた'), el('div.spacer'), myYaku)),
      el('div.col', { style: { alignItems: 'center', gap: '6px', marginTop: '8px' } }, msg, myHand, timerHost),
      modalHost);

    function capturedView(ids) {
      const order = ['hikari', 'tane', 'tan', 'kasu'];
      const groups = order.map((t) => ids.filter((id) => byId[id].type === t));
      return groups.filter((g) => g.length).map((g) => el('div.row', { style: { gap: '1px', marginRight: '10px' } }, g.map((id) => hanaEl(id, { cls: 'small' }))));
    }

    function yakuText(ids) {
      const { yaku, total } = calcYaku(ids);
      return yaku.length ? `${yaku.map((y) => `${y.name}${y.points}`).join('・')}（${total}点）` : '役なし';
    }

    function render() {
      if (!round) return;
      const pend = round.pending;
      const myTurnHand = waiting?.kind === 'hand';
      scoreEl.textContent = `${roundNo}月目 / ${cfg.rounds}　あなた ${totals[0]}点 − CPU ${totals[1]}点` + (round.koikoi[0] ? '　［あなた こいこい中］' : '') + (round.koikoi[1] ? '　［CPU こいこい中］' : '');
      cpuHand.replaceChildren(...round.hands[1].map(() => hanaEl(null, { back: true, size: 30 })));
      cpuCap.replaceChildren(...capturedView(round.captured[1]));
      myCap.replaceChildren(...capturedView(round.captured[0]));
      myYaku.textContent = yakuText(round.captured[0]);
      guide.update(round.captured[0]);
      cpuYaku.textContent = 'CPU: ' + yakuText(round.captured[1]);
      fieldEl.replaceChildren(...round.field.map((id) => {
        const choose = waiting?.kind === 'field' && pend?.options.includes(id);
        const node = hanaEl(id, { size: 60, cls: choose ? 'choose' : '' });
        node.dataset.month = byId[id].month;
        if (choose) node.addEventListener('click', () => answer(id));
        return node;
      }));
      clear(deckEl,
        hanaEl(null, { back: true, size: 52 }),
        el('div.muted', `山札 ${round.deck.length}`),
        pend ? el('div.col', { style: { alignItems: 'center' } }, el('div.muted', pend.source === 'draw' ? 'めくった札' : '出した札'), hanaEl(pend.cardId, { size: 52, cls: 'match' })) : null);
      myHand.replaceChildren(...round.hands[0].map((id) => {
        const node = hanaEl(id, { size: 66, cls: myTurnHand ? 'selectable' : '' });
        if (myTurnHand) {
          node.addEventListener('click', () => answer(id));
          node.addEventListener('mouseenter', () => highlightMonth(byId[id].month, true));
          node.addEventListener('mouseleave', () => highlightMonth(byId[id].month, false));
        }
        return node;
      }));
    }

    function highlightMonth(m, on) {
      for (const n of fieldEl.children) if (Number(n.dataset.month) === m) n.classList.toggle('match', on);
    }

    function answer(v) {
      if (!waiting) return;
      const w = waiting;
      waiting = null;
      timer.stop();
      modalHost.replaceChildren();
      sound.card();
      w.resolve(v);
    }

    function ask(kind) {
      return new Promise((resolve) => {
        waiting = { kind, resolve };
        render();
        timer.start();
      });
    }

    function autoAct() {
      if (!waiting) return;
      if (waiting.kind === 'hand') answer(cpuPickCard(round, 0));
      else if (waiting.kind === 'field') answer(cpuPickField(round));
      else if (waiting.kind === 'decide') answer(false);
    }

    async function decideModal() {
      const { yaku, total } = calcYaku(round.captured[0]);
      modalHost.replaceChildren(el('div.overlay', el('div.panel.col', { style: { alignItems: 'center', minWidth: '520px' } },
        el('h2', '役ができました！'),
        el('div', { style: { fontSize: '22px' } }, yaku.map((y) => `${y.name} ${y.points}点`).join('　')),
        el('div', { style: { fontSize: '40px', fontWeight: 900, color: 'var(--gold)' } }, `${total}点`),
        el('div.muted', round.hands[0].length ? 'こいこいで続けると、さらに点を狙えます（相手に役ができると逆転のピンチ！）' : ''),
        el('div.row', { style: { marginTop: '10px' } },
          el('button.btn.big.danger', { on: { click: () => answer(true) } }, 'こいこい（続ける）', el('span.easy-label', 'もっと点を狙う')),
          el('button.btn.big', { on: { click: () => answer(false) } }, 'あがり（ここで終わる）', el('span.easy-label', '今の点数をもらう'))))));
      sound.win();
      return ask('decide');
    }

    async function humanTurn() {
      msg.textContent = '手札から1枚選んでね（同じ月の札が光ります）';
      const card = await ask('hand');
      if (!alive) return;
      round.playCard(0, card);
      if (round.phase === 'chooseHand') {
        msg.textContent = '取る札を選んでね';
        const f = await ask('field');
        if (!alive) return;
        round.chooseField(0, f);
      }
      render();
      await sleep(500);
      if (round.phase === 'chooseDraw') {
        msg.textContent = 'めくった札で取る札を選んでね';
        const f = await ask('field');
        if (!alive) return;
        round.chooseField(0, f);
      }
      render();
      if (round.phase === 'decide') {
        const koikoi = await decideModal();
        if (!alive) return;
        round.decide(0, koikoi);
        if (koikoi) msg.textContent = 'こいこい！';
      }
    }

    async function cpuTurn() {
      msg.textContent = 'CPUの番…';
      await sleep(700);
      if (!alive) return;
      round.playCard(1, cpuPickCard(round, 1));
      sound.card();
      if (round.phase === 'chooseHand') round.chooseField(1, cpuPickField(round));
      render();
      await sleep(700);
      if (!alive) return;
      if (round.phase === 'chooseDraw') round.chooseField(1, cpuPickField(round));
      sound.card();
      render();
      if (round.phase === 'decide') {
        await sleep(500);
        const k = cpuDecideKoikoi(round, 1);
        round.decide(1, k);
        msg.textContent = k ? 'CPU「こいこい！」' : 'CPU「あがり！」';
        if (k) sound.target();
        await sleep(1000);
      }
    }

    async function playRound() {
      round = new KoikoiRound({ oya: (roundNo - 1) % 2, koikoiDoubles: cfg.koikoiDoubles, sevenPointsDoubles: cfg.sevenPointsDoubles });
      msg.textContent = `${roundNo}月目　親：${round.oya === 0 ? 'あなた' : 'CPU'}`;
      render();
      await sleep(900);
      while (alive && round.phase !== 'end') {
        if (round.turn === 0) await humanTurn();
        else await cpuTurn();
        render();
        await sleep(200);
      }
      if (!alive) return;
      const r = round.result;
      totals[0] += r.points[0];
      totals[1] += r.points[1];
      roundResults.push(r);
      const who = r.winner === 0 ? 'あなた' : r.winner === 1 ? 'CPU' : null;
      if (r.winner === 0) sound.bigWin(); else if (r.winner === 1) sound.lose();
      await new Promise((resolve) => {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          modalHost.replaceChildren();
          resolve();
        };
        modalHost.replaceChildren(el('div.overlay', el('div.panel.col', { style: { alignItems: 'center', minWidth: '520px' } },
          el('h2', `${roundNo}月目の結果`),
          who ? el('div', { style: { fontSize: '28px' } }, `${who}のあがり！`) : el('div', { style: { fontSize: '28px' } }, '流局（両者役なし）'),
          r.yaku ? el('div', r.yaku.map((y) => `${y.name} ${y.points}点`).join('　')) : null,
          r.notes?.length ? el('div.warn', r.notes.join('・')) : null,
          who ? el('div', { style: { fontSize: '40px', fontWeight: 900, color: 'var(--gold)' } }, `+${r.points[r.winner]}点`) : null,
          el('div', `合計　あなた ${totals[0]}点 − CPU ${totals[1]}点`),
          el('button.btn.big', { on: { click: close } }, roundNo < cfg.rounds ? '次の月へ' : '最終結果へ'))));
        setTimeout(close, 7000);
      });
    }

    async function run() {
      for (roundNo = 1; roundNo <= cfg.rounds && alive; roundNo++) await playRound();
      if (!alive) return;
      msg.textContent = `最終結果　あなた ${totals[0]}点 − CPU ${totals[1]}点`;
      await sleep(1200);
      if (alive) ctx.finish({ playerScore: totals[0], cpuScore: totals[1] });
    }

    run();
    return () => {
      alive = false;
      timer.stop();
      modalHost.replaceChildren();
    };
  },
};
