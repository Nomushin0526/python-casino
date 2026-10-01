// 大富豪（あなた＋CPU3人・1ゲーム）
import { el, clear, cardEl, sleep, turnTimer } from '../ui.js';
import { DaifugoGame, cpuChoose, cardId, sortHand, RULES_TEXT } from '../lib/daifugo.js';

const TURN_SEC = 20;
const NAMES = ['あなた', 'CPU ハル', 'CPU ナツ', 'CPU アキ'];
const RANK_NAMES = [null, '大富豪', '富豪', '貧民', '大貧民'];

export default {
  id: 'daifugo',
  title: '大富豪',
  icon: '👑',
  desc: 'CPU3人と1ゲーム。革命と8切りあり。大富豪になれば大きく増える！',
  payout: (cfg) => [['大富豪', cfg.multipliers.daifugo], ['富豪', cfg.multipliers.fugo], ['貧民', cfg.multipliers.hinmin], ['大貧民', cfg.multipliers.daihinmin]],
  maxLoss: (cfg) => -cfg.multipliers.daihinmin,
  intro: (cfg) => el('div', el('ul', RULES_TEXT.map((t) => el('li', t))),
    el('div.muted', `結果：大富豪 +${cfg.multipliers.daifugo} / 富豪 +${cfg.multipliers.fugo} / 貧民 ${cfg.multipliers.hinmin} / 大貧民 ${cfg.multipliers.daihinmin}（× 賭けチップ × レバレッジ）`)),
  mount(root, ctx) {
    const { cfg, sound } = ctx;
    let alive = true;
    const game = new DaifugoGame({ jokers: cfg.jokers });
    const selected = new Set();
    let waiting = null;
    const status = ['', '', '', ''];

    const handEl = el('div.cards', { style: { '--cw': '68px', flexWrap: 'nowrap' } });
    const fieldEl = el('div.cards', { style: { '--cw': '80px', minHeight: '120px' } });
    const fieldInfo = el('div.status-line');
    const revoEl = el('div', { style: { fontSize: '22px', fontWeight: 900, color: 'var(--red)', minHeight: '30px' } });
    const banner = el('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '80px', fontWeight: 900, color: 'var(--gold)', textShadow: '0 0 30px #000, 0 4px 0 #6b4708', pointerEvents: 'none', opacity: 0, transition: 'opacity .2s' } });
    const msg = el('div.status-line');
    const timerHost = el('div', { style: { height: '22px' } });
    const btnPlay = el('button.btn.big', { on: { click: () => tryPlay() } }, '出す', el('kbd', 'Enter'));
    const btnPass = el('button.btn.big.secondary', { on: { click: () => doPass() } }, 'パス', el('kbd', 'P'));
    const cpuEls = [1, 2, 3].map(() => el('div.panel.col', { style: { padding: '10px 14px', alignItems: 'center', gap: '6px', minWidth: '170px' } }));
    const timer = turnTimer(timerHost, TURN_SEC, () => autoPlay());

    clear(root,
      el('div.table-felt', { style: { position: 'relative', width: 'min(1200px, 100%)', flex: 1, padding: '14px', display: 'grid', gridTemplateColumns: '200px 1fr 200px', gridTemplateRows: 'auto 1fr', gap: '10px', minHeight: 0 } },
        el('div', { style: { gridColumn: '2', display: 'flex', justifyContent: 'center' } }, cpuEls[1]),
        el('div', { style: { gridColumn: '1', gridRow: '2', display: 'flex', alignItems: 'center' } }, cpuEls[0]),
        el('div.col', { style: { gridColumn: '2', gridRow: '2', alignItems: 'center', justifyContent: 'center' } }, revoEl, fieldEl, fieldInfo),
        el('div', { style: { gridColumn: '3', gridRow: '2', display: 'flex', alignItems: 'center' } }, cpuEls[2]),
        banner),
      el('div.col', { style: { alignItems: 'center', gap: '8px', marginTop: '10px', width: '100%' } },
        msg, handEl, el('div.actions', btnPass, btnPlay), timerHost));

    function showBanner(text, ms = 900) {
      banner.textContent = text;
      banner.style.opacity = 1;
      setTimeout(() => { banner.style.opacity = 0; }, ms);
    }

    function playableIds() {
      if (!waiting) return new Set();
      const ids = new Set();
      for (const p of game.legalPlays(0)) for (const c of p.cards) ids.add(cardId(c));
      // ジョーカーを含む手は全部の同ランクを候補に
      for (const p of game.legalPlays(0)) {
        if (p.rank !== 13) for (const c of game.hands[0]) if (!c.joker && p.cards.some((x) => !x.joker && x.r === c.r)) ids.add(cardId(c));
      }
      return ids;
    }

    function render() {
      sortHand(game.hands[0], game.revolution);
      const ok = playableIds();
      handEl.replaceChildren(...game.hands[0].map((c) => {
        const id = cardId(c);
        const node = cardEl(c, { cls: `selectable ${selected.has(id) ? 'selected' : ''} ${waiting && !ok.has(id) ? 'dim' : ''}` });
        node.addEventListener('click', () => {
          if (!waiting) return;
          selected.has(id) ? selected.delete(id) : selected.add(id);
          sound.click();
          render();
        });
        return node;
      }));
      // 手札が多いときは重ねて表示
      handEl.classList.toggle('overlap', game.hands[0].length > 12);
      [1, 2, 3].forEach((p, k) => {
        const node = cpuEls[k];
        const isTurn = game.turn === p && !game.over;
        node.style.boxShadow = isTurn ? '0 0 0 3px var(--gold), 0 0 24px rgba(246,196,83,.5)' : '';
        const rank = game.rankOf(p);
        clear(node,
          el('b', NAMES[p]),
          rank ? el('div', { style: { fontSize: '22px', fontWeight: 900, color: 'var(--gold)' } }, `${RANK_NAMES[rank]}`)
            : el('div.cards.overlap', { style: { '--cw': '34px', minHeight: 'auto' } }, game.hands[p].slice(0, 13).map(() => cardEl(null, { back: true, size: 34 }))),
          el('div.muted', rank ? '上がり' : `残り ${game.hands[p].length} 枚`),
          el('div', { style: { minHeight: '22px', color: status[p] === 'パス' ? 'var(--muted)' : 'var(--text)' } }, status[p]));
      });
      if (game.field) {
        fieldEl.replaceChildren(...game.field.cards.map((c) => cardEl(c, { cls: 'flip' })));
        fieldInfo.textContent = `${NAMES[game.field.by]} が ${game.field.count}枚出し`;
      } else {
        fieldEl.replaceChildren();
        fieldInfo.textContent = '場は空です（好きな組を出せます）';
      }
      revoEl.textContent = game.revolution ? '⚡ 革命中（3が最強・2が最弱）⚡' : '';
      btnPlay.disabled = !waiting || selected.size === 0;
      btnPass.disabled = !waiting || !game.field;
    }

    function handleEvents(p, events) {
      if (events.includes('revolution')) { showBanner('革命！', 1300); sound.bigWin(); }
      if (events.includes('counter-revolution')) { showBanner('革命返し！', 1300); sound.bigWin(); }
      if (events.includes('eight')) { showBanner('8切り！'); sound.target(); }
      if (events.includes('clear')) { status.fill(''); sound.card(); }
      if (events.includes('eight')) status.fill('');
      if (events.includes('finish')) { status[p] = ''; if (p !== 0) showBanner(`${NAMES[p]} 上がり！`, 1000); }
    }

    function tryPlay() {
      if (!waiting) return;
      const cards = game.hands[0].filter((c) => selected.has(cardId(c)));
      const v = game.validate(0, cards);
      if (!v.ok) {
        sound.error();
        msg.textContent = v.error;
        return;
      }
      finishHumanTurn(() => {
        status[0] = '';
        const ev = game.play(0, cards);
        sound.card();
        handleEvents(0, ev);
      });
    }

    function doPass() {
      if (!waiting || !game.field) return;
      finishHumanTurn(() => {
        status[0] = 'パス';
        handleEvents(0, game.pass(0));
      });
    }

    function autoPlay() {
      if (!waiting) return;
      const cards = cpuChoose(game, 0);
      if (cards) {
        finishHumanTurn(() => { handleEvents(0, game.play(0, cards)); sound.card(); });
      } else if (game.field) doPass();
      else {
        // 親なのに出せる手がない（通常起こらない）
        const lowest = game.hands[0][0];
        finishHumanTurn(() => handleEvents(0, game.play(0, [lowest])));
      }
    }

    function finishHumanTurn(fn) {
      const r = waiting;
      waiting = null;
      timer.stop();
      selected.clear();
      msg.textContent = '';
      fn();
      r();
    }

    async function run() {
      await sleep(500);
      while (alive && !game.over && game.rankOf(0) == null) {
        const p = game.turn;
        render();
        if (p === 0) {
          msg.textContent = game.field ? '出すカードを選んでね（同じ枚数で、より強いカード）' : 'あなたが親です。好きなカードを出してね';
          await new Promise((r) => { waiting = r; render(); timer.start(); });
        } else {
          await sleep(700 + Math.random() * 400);
          if (!alive) return;
          const cards = cpuChoose(game, p);
          if (cards) {
            status[p] = '';
            const ev = game.play(p, cards);
            sound.card();
            handleEvents(p, ev);
          } else {
            status[p] = 'パス';
            handleEvents(p, game.pass(p));
          }
        }
        render();
        await sleep(150);
      }
      if (!alive) return;
      // あなたの順位が決まったら終了（大貧民は残り1人になった時点）
      let rank = game.rankOf(0);
      if (rank == null) rank = 4;
      render();
      const name = RANK_NAMES[rank];
      showBanner(`あなたは${name}！`, 2200);
      rank <= 2 ? sound.bigWin() : sound.lose();
      msg.textContent = `結果：${name}`;
      await sleep(2400);
      if (alive) ctx.finish({ rank });
    }

    const onKey = (e) => {
      if (!waiting) return;
      if (e.key === 'Enter') tryPlay();
      else if (e.key.toLowerCase() === 'p') doPass();
    };
    window.addEventListener('keydown', onKey);
    render();
    run();
    return () => {
      alive = false;
      timer.stop();
      window.removeEventListener('keydown', onKey);
    };
  },
};
