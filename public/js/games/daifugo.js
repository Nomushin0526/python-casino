// 大富豪（あなた＋CPU3人・1ゲーム。ローカルルールは開始前に選べる）
import { el, clear, cardEl, sleep, turnTimer, gameLayout, sideRow, cards as parseCards } from '../ui.js';
import { DaifugoGame, cpuChoose, cardId, sortHand, BASIC_RULES_TEXT, LOCAL_RULES, defaultRules, playLabel } from '../lib/daifugo.js';

const TURN_SEC = 20;
const NAMES = ['あなた', 'CPU ハル', 'CPU ナツ', 'CPU アキ'];
const RANK_NAMES = [null, '大富豪', '富豪', '貧民', '大貧民'];
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };

// ローカルルールの説明用のカード例
const RULE_VISUAL = {
  revolution: ['5S 5H 5D 5C', '→ 強さ逆転'],
  eightCut: ['8H', '→ 場が流れる'],
  elevenBack: ['JS', '→ 一時的に逆転'],
  shibari: ['4H', '→', '9H', '→ ♥しか出せない'],
  spade3: ['JK', '←', '3S', ' で返せる'],
  stairs: ['4H 5H 6H', '→ 3枚の階段'],
  fiveSkip: ['5D', '→ 次の人をとばす'],
};

function ruleVisual(id) {
  return el('div.mini-cards', RULE_VISUAL[id].map((part) => (/^(\d+|[AJQK])[SHDC]|JK/.test(part) ? parseCards(part).map((c) => cardEl(c, { size: 24 })) : el('span.arrow', part))));
}

// 強さの並び（弱い → 強い）
function strengthLine(reversed) {
  const order = ['3S', '4S', '5S', '6S', '7S', '8S', '9S', '10S', 'JS', 'QS', 'KS', 'AS', '2S'];
  const list = reversed ? order.slice().reverse() : order;
  return el('div.strength-line', el('span.lt', '弱'), ...list.map((t) => cardEl(parseCards(t)[0], { size: 20 })), cardEl(parseCards('JK')[0], { size: 20 }), el('span.lt', '強'));
}

function rulesIntro(cfg, options) {
  const on = LOCAL_RULES.filter((r) => options[r.id]);
  return el('div',
    el('h3', '基本のルール'),
    el('ul', BASIC_RULES_TEXT.map((t) => el('li', t))),
    el('div', { style: { margin: '6px 0 10px' } }, el('div.muted', '強さ（左が弱い・右が強い）'), strengthLine(false)),
    el('h3', '今回のローカルルール'),
    on.length
      ? el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } }, on.map((r) => sideRow({ title: r.name, desc: r.desc, visual: ruleVisual(r.id) })))
      : el('div.muted', 'なし（基本ルールだけ）'),
    el('p.muted', `結果：大富豪 +${cfg.multipliers.daifugo} / 富豪 +${cfg.multipliers.fugo} / 貧民 ${cfg.multipliers.hinmin} / 大貧民 ${cfg.multipliers.daihinmin}（× 賭けチップ × レバレッジ）`));
}

export default {
  id: 'daifugo',
  title: '大富豪',
  icon: '👑',
  desc: 'CPU3人と1ゲーム。ローカルルールを選んで遊べる！大富豪になれば大きく増える。',
  payout: (cfg) => [['大富豪', cfg.multipliers.daifugo], ['富豪', cfg.multipliers.fugo], ['貧民', cfg.multipliers.hinmin], ['大貧民', cfg.multipliers.daihinmin]],
  maxLoss: (cfg) => -cfg.multipliers.daihinmin,
  defaultOptions: () => defaultRules(),
  // 開始前にローカルルールを選ぶ
  optionsEditor(cfg, options, onChange) {
    let opts = { ...options };
    const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px', margin: '8px 0 14px' } });
    const render = () => {
      clear(grid, LOCAL_RULES.map((r) => {
        const on = !!opts[r.id];
        return el('div.side-row', {
          class: on ? 'on-rule' : '',
          style: { cursor: 'pointer', borderColor: on ? 'var(--gold)' : 'var(--line)', background: on ? 'rgba(246,196,83,.14)' : 'rgba(255,255,255,.03)', opacity: on ? 1 : 0.7 },
          on: { click: () => { opts = { ...opts, [r.id]: !on }; onChange(opts); render(); } },
        },
        el('div.side-row-head', el('b', `${on ? '✅' : '⬜'} ${r.name}`), el('span.side-note', on ? 'あり' : 'なし')),
        el('div.side-desc', r.desc),
        ruleVisual(r.id));
      }));
    };
    const preset = (label, value) => el('button.btn.small.secondary', { on: { click: () => { opts = value; onChange(opts); render(); } } }, label);
    render();
    return el('div',
      el('div.row', el('h3', { style: { margin: 0 } }, 'ローカルルールを選んでね（クリックで切り替え）'), el('div.spacer'),
        preset('おすすめ', defaultRules()),
        preset('基本だけ', Object.fromEntries(LOCAL_RULES.map((r) => [r.id, false]))),
        preset('全部入り', Object.fromEntries(LOCAL_RULES.map((r) => [r.id, true])))),
      grid);
  },
  intro: (cfg, options = defaultRules()) => rulesIntro(cfg, options),
  mount(root, ctx) {
    const { cfg, sound } = ctx;
    const rules = { ...defaultRules(), ...(ctx.options || {}) };
    let alive = true;
    const game = new DaifugoGame({ jokers: cfg.jokers, rules });
    const selected = new Set();
    let waiting = null;
    const status = ['', '', '', ''];

    const { main, side } = gameLayout(root, '大富豪 早見表');

    // ---------- 早見表 ----------
    const strengthBox = el('div');
    const stateBox = el('div.col', { style: { gap: '6px' } });
    const onRules = LOCAL_RULES.filter((r) => rules[r.id]);
    clear(side,
      el('h4', '強さの順番'), strengthBox,
      stateBox,
      sideRow({ title: '出し方', desc: '場と同じ枚数で、より強いカードを出す。出せないときはパス' }),
      el('h4', '今回のローカルルール'),
      onRules.length ? onRules.map((r) => sideRow({ title: r.name, desc: r.desc, visual: ruleVisual(r.id) })) : el('div.muted', 'なし（基本ルールだけ）'));

    function renderSide() {
      clear(strengthBox, strengthLine(game.reversed), game.reversed ? el('div', { style: { color: 'var(--red)', fontWeight: 800, fontSize: '13px' } }, '⚡ 今は強さが逆転中！') : null);
      const rows = [];
      if (game.revolution) rows.push(sideRow({ title: '⚡ 革命中', desc: '3が最強・2が最弱', cls: 'warn-on' }));
      if (game.elevenBack) rows.push(sideRow({ title: '🔄 11バック中', desc: '場が流れるまで強さが逆転', cls: 'warn-on' }));
      if (game.lock) rows.push(sideRow({ title: `🔒 しばり中：${game.lock.split('').map((s) => SUIT[s]).join('')}`, desc: '場が流れるまでこのマークだけ', cls: 'warn-on' }));
      clear(stateBox, rows);
    }

    // ---------- 画面 ----------
    const handEl = el('div.cards', { style: { '--cw': '64px', flexWrap: 'nowrap' } });
    const fieldEl = el('div.cards', { style: { '--cw': '78px', minHeight: '115px' } });
    const fieldInfo = el('div.status-line');
    const revoEl = el('div', { style: { fontSize: '20px', fontWeight: 900, color: 'var(--red)', minHeight: '28px' } });
    const banner = el('div.big-banner');
    const msg = el('div.status-line');
    const timerHost = el('div', { style: { height: '22px' } });
    const btnPlay = el('button.btn.big', { on: { click: () => tryPlay() } }, '選んだカードを出す', el('kbd', 'Enter'));
    const btnPass = el('button.btn.big.secondary', { on: { click: () => doPass() } }, 'パス（出さない）', el('kbd', 'P'));
    const cpuEls = [1, 2, 3].map(() => el('div.panel.col', { style: { padding: '10px 12px', alignItems: 'center', gap: '6px', minWidth: '150px' } }));
    const timer = turnTimer(timerHost, TURN_SEC, () => autoPlay());

    clear(main,
      el('div.table-felt', { style: { position: 'relative', width: '100%', flex: 1, padding: '12px', display: 'grid', gridTemplateColumns: '170px 1fr 170px', gridTemplateRows: 'auto 1fr', gap: '8px', minHeight: 0 } },
        el('div', { style: { gridColumn: '2', display: 'flex', justifyContent: 'center' } }, cpuEls[1]),
        el('div', { style: { gridColumn: '1', gridRow: '2', display: 'flex', alignItems: 'center' } }, cpuEls[0]),
        el('div.col', { style: { gridColumn: '2', gridRow: '2', alignItems: 'center', justifyContent: 'center' } }, revoEl, fieldEl, fieldInfo),
        el('div', { style: { gridColumn: '3', gridRow: '2', display: 'flex', alignItems: 'center' } }, cpuEls[2]),
        banner),
      el('div.col', { style: { alignItems: 'center', gap: '8px', marginTop: '10px', width: '100%' } },
        msg, handEl, el('div.actions', btnPass, btnPlay), timerHost));

    let bannerTimer = null;
    function showBanner(text, ms = 900) {
      banner.textContent = text;
      banner.classList.remove('show');
      void banner.offsetWidth;
      banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('show'), ms);
    }

    function playableIds() {
      if (!waiting) return new Set();
      const ids = new Set();
      const plays = game.legalPlays(0);
      for (const p of plays) for (const c of p.cards) ids.add(cardId(c));
      // ジョーカーを含む手は全部の同ランクを候補に
      for (const p of plays) {
        if (p.type === 'group' && p.rank !== 13) for (const c of game.hands[0]) if (!c.joker && p.cards.some((x) => !x.joker && x.r === c.r)) ids.add(cardId(c));
      }
      return ids;
    }

    let lastFieldKey = '';
    function render() {
      sortHand(game.hands[0], game.reversed);
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
      handEl.classList.toggle('overlap', game.hands[0].length > 11);
      [1, 2, 3].forEach((p, k) => {
        const node = cpuEls[k];
        const isTurn = game.turn === p && !game.over;
        node.style.boxShadow = isTurn ? '0 0 0 3px var(--gold), 0 0 24px rgba(246,196,83,.5)' : '';
        const rank = game.rankOf(p);
        clear(node,
          el('b', NAMES[p]),
          rank ? el('div', { style: { fontSize: '22px', fontWeight: 900, color: 'var(--gold)' } }, `${RANK_NAMES[rank]}`)
            : el('div.cards.overlap', { style: { '--cw': '30px', minHeight: 'auto' } }, game.hands[p].slice(0, 13).map(() => cardEl(null, { back: true, size: 30 }))),
          el('div.muted', rank ? '上がり' : `残り ${game.hands[p].length} 枚`),
          el('div', { style: { minHeight: '22px', color: status[p].startsWith('パス') ? 'var(--muted)' : 'var(--text)' } }, status[p]));
      });
      if (game.field) {
        const key = game.field.cards.map(cardId).join();
        fieldEl.replaceChildren(...game.field.cards.map((c) => cardEl(c, { cls: key !== lastFieldKey ? 'flip' : '' })));
        lastFieldKey = key;
        fieldInfo.textContent = `${NAMES[game.field.by]} が ${playLabel(game.field)}出し`;
      } else {
        fieldEl.replaceChildren();
        lastFieldKey = '';
        fieldInfo.textContent = '場は空です（好きな組を出せます）';
      }
      revoEl.textContent = [game.revolution ? '⚡ 革命中' : '', game.elevenBack ? '🔄 11バック中' : '', game.lock ? `🔒 ${game.lock.split('').map((s) => SUIT[s]).join('')}しばり` : ''].filter(Boolean).join('　');
      btnPlay.disabled = !waiting || selected.size === 0;
      btnPass.disabled = !waiting || !game.field;
      renderSide();
    }

    function handleEvents(p, events) {
      if (events.includes('revolution')) { showBanner('革命！', 1300); sound.bigWin(); }
      if (events.includes('counter-revolution')) { showBanner('革命返し！', 1300); sound.bigWin(); }
      if (events.includes('eight')) { showBanner('8切り！'); sound.target(); }
      if (events.includes('spade3')) { showBanner('スペ3返し！', 1200); sound.bigWin(); }
      if (events.includes('eleven')) { showBanner('11バック！'); sound.target(); }
      if (events.includes('shibari')) { showBanner('しばり！'); sound.target(); }
      if (events.includes('skip')) {
        showBanner('5飛ばし！');
        sound.target();
        for (const s of game.skipped || []) status[s] = 'パス（とばされた）';
      }
      if (events.includes('clear') || events.includes('eight') || events.includes('spade3')) { status.fill(''); sound.card(); }
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
          msg.textContent = game.field
            ? `${playLabel(game.field)}で、場より強いカードを選んでね（暗いカードは出せません）`
            : 'あなたが親です。好きなカードを出してね（同じ数字なら何枚でもOK）';
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
      clearTimeout(bannerTimer);
      window.removeEventListener('keydown', onKey);
    };
  },
};
