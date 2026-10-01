// ゲーム端末のメイン（画面遷移・セッション・無操作タイムアウト）
import { api, ApiError, terminalId } from './api.js';
import { el, clear, fmt, signed, multLabel, toast, countUp, confetti, sleep } from './ui.js';
import { sound } from './sound.js';
import { QrScanner } from './qr.js';
import { betRange } from './lib/settle.js';
import pinball from './games/pinball.js';
import blackjack from './games/blackjack.js';
import baccarat from './games/baccarat.js';
import holdem from './games/holdem.js';
import daifugo from './games/daifugo.js';
import koikoi from './games/koikoi.js';

const GAME_MODULES = [pinball, blackjack, baccarat, holdem, daifugo, koikoi];

const state = {
  config: null,
  player: null,
  screen: null,
  inGame: false,
  round: null, // { roundId, game, bet, leverage }
  cleanup: null,
  lastBet: {}, // gameId -> { bet, leverage }
  lastInput: Date.now(),
  idleOverlay: null,
  heartbeat: null,
};

const $screen = document.getElementById('screen');
const $topbar = document.getElementById('topbar');

// ---------- 共通 ----------
function setScreen(node, name) {
  if (state.cleanup) {
    try { state.cleanup(); } catch (e) { console.error(e); }
    state.cleanup = null;
  }
  state.screen = name;
  clear($screen, node);
  renderTopbar();
}

function renderTopbar(extra) {
  const p = state.player;
  const muteBtn = el('button.btn.secondary.small', { on: { click: () => { const m = sound.toggle(); muteBtn.textContent = m ? '🔇' : '🔊'; } } }, sound.muted ? '🔇' : '🔊');
  const items = [el('div.logo', '♠ IT部 CASINO ♥')];
  if (p && state.screen !== 'standby') {
    items.push(el('div.who', `${p.nickname || 'はじめまして'} さん`));
    items.push(el('div.chips.num', { id: 'top-chips' }, fmt(p.chips)));
    if (state.round && state.inGame) {
      items.push(el('div.bet-info', '賭け ', el('b.num', fmt(state.round.bet)), '　レバレッジ ', el('b.num', `×${state.round.leverage}`)));
    }
    if (p.easyMode) items.push(el('span.toggle.on', 'かんたんモード'));
  }
  items.push(el('div.spacer'));
  if (extra) items.push(extra);
  items.push(muteBtn);
  if (p && !['standby', 'losscut'].includes(state.screen) && !state.inGame) {
    items.push(el('button.btn.secondary.small', { on: { click: () => endSession() } }, 'おわる'));
  }
  clear($topbar, items);
}

function updateChips(chips) {
  if (!state.player) return;
  state.player.chips = chips;
  const n = document.getElementById('top-chips');
  if (n) n.textContent = fmt(chips);
}

function handleError(e) {
  console.error(e);
  if (e instanceof ApiError && e.code === 'SESSION_LOST') {
    toast(e.message, { error: true });
    resetToStandby();
    return;
  }
  sound.error();
  toast(e.message || 'エラーが発生しました', { error: true });
}

async function endSession() {
  await api.logout();
  resetToStandby();
}

function resetToStandby() {
  api.session = null;
  state.player = null;
  state.inGame = false;
  state.round = null;
  stopHeartbeat();
  hideIdle();
  showStandby();
}

function startHeartbeat() {
  stopHeartbeat();
  state.heartbeat = setInterval(async () => {
    try {
      const r = await api.heartbeat();
      if (!state.inGame && r.player) state.player = r.player;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_LOST') handleError(e);
    }
  }, state.config.session.heartbeatSec * 1000);
}

function stopHeartbeat() {
  if (state.heartbeat) clearInterval(state.heartbeat);
  state.heartbeat = null;
}

// ---------- 無操作タイムアウト ----------
['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, () => {
    state.lastInput = Date.now();
    if (state.idleOverlay) hideIdle();
  }, { passive: true, capture: true }));
window.addEventListener('pointerdown', () => sound.unlock(), { once: true });

function hideIdle() {
  if (state.idleOverlay) state.idleOverlay.remove();
  state.idleOverlay = null;
}

setInterval(async () => {
  if (!state.config || !state.player || state.screen === 'standby' || state.screen === 'losscut') return;
  const { idleSec, idleWarnSec } = state.config.session;
  const idle = (Date.now() - state.lastInput) / 1000;
  if (idle >= idleSec) {
    hideIdle();
    try {
      if (state.inGame) await api.abortRound('idle');
    } catch { /* ignore */ }
    toast('しばらく操作がなかったので終了しました');
    await endSession();
  } else if (idle >= idleSec - idleWarnSec) {
    const left = Math.ceil(idleSec - idle);
    if (!state.idleOverlay) {
      state.idleOverlay = el('div.overlay', el('div.panel',
        el('div', 'まだ遊んでいますか？'),
        el('div.count.num', String(left)),
        el('div.muted', state.inGame ? 'このまま放置するとゲームは「負け」で終了します' : '画面をクリックすると続けられます')));
      document.body.append(state.idleOverlay);
    } else {
      state.idleOverlay.querySelector('.count').textContent = String(left);
    }
    sound.tick();
  }
}, 1000);

// ---------- 待機画面 ----------
let scanner = null;

function showStandby() {
  state.player = null;
  const video = el('video', { autoplay: true, muted: true, playsinline: true });
  const nocam = el('div.nocam.hidden');
  const err = el('div.error-text');
  const input = el('input', { placeholder: '例: P0001-ABCD', autocomplete: 'off', spellcheck: false });
  let busy = false;

  const submit = async (code) => {
    if (busy || !code) return;
    busy = true;
    err.textContent = '';
    sound.scan();
    try {
      await doLogin(code);
    } catch (e) {
      sound.error();
      err.textContent = e.message;
      input.value = '';
      busy = false;
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit(input.value.trim());
  });

  const floats = Array.from({ length: 8 }, (_, i) => el('div.chips-float', {
    style: { left: (i * 13 + 4) + '%', top: (i % 2 ? 15 : 70) + '%', animationDelay: i * 0.7 + 's' },
  }, ['♠', '♥', '♦', '♣'][i % 4]));

  const node = el('div.screen.standby',
    floats,
    el('div.title', 'IT部 CASINO'),
    el('div.sub', 'カードの QR コードをカメラにかざしてね'),
    el('div.scanbox', video, el('div.frame'), el('div.scanline'), nocam),
    el('div.manual.muted', el('span', '読めないときは入力 →'), input,
      el('button.btn.small', { on: { click: () => submit(input.value.trim()) } }, 'OK')),
    err,
    el('div.muted', { style: { fontSize: '14px' } }, `端末: ${terminalId()}　チップに換金性はありません`),
  );
  setScreen(node, 'standby');
  state.cleanup = () => { scanner?.stop(); scanner = null; };

  scanner = new QrScanner(video, (text) => submit(text));
  scanner.start().catch((e) => {
    nocam.classList.remove('hidden');
    nocam.textContent = (e && e.name === 'NotAllowedError') ? 'カメラの使用が許可されていません' : (e.message || 'カメラが見つかりません');
    video.classList.add('hidden');
  });
  setTimeout(() => input.focus(), 100);
}

async function doLogin(code) {
  const r = await api.login(code);
  state.player = r.player;
  if (r.status === 'no_chips') {
    showMessage({
      icon: '💸',
      title: 'チップがありません',
      text: `${r.player.nickname || ''} さんはロスカット中です。受付で「復活」（1日1回）を受けると、また遊べます。`,
      button: '待機画面へ',
      onClose: resetToStandby,
      auto: 10,
    });
    return;
  }
  startHeartbeat();
  state.lastInput = Date.now();
  if (r.player.needsNickname) showNickname();
  else {
    toast(`おかえりなさい、${r.player.nickname} さん！`);
    showMenu();
  }
}

function showMessage({ icon, title, text, button = 'OK', onClose, auto }) {
  let timer = null;
  const close = () => { clearTimeout(timer); onClose(); };
  const node = el('div.screen', el('div.panel.msgbox',
    el('div.big-icon', icon || 'ℹ️'), el('h2', title), el('p', text),
    el('button.btn.big', { on: { click: close } }, button)));
  setScreen(node, 'message');
  if (auto) timer = setTimeout(close, auto * 1000);
  state.cleanup = () => clearTimeout(timer);
}

// ---------- ニックネーム登録 ----------
function showNickname() {
  const max = state.config.nickname.maxLength;
  const input = el('input.text-input', { maxlength: max * 2, placeholder: `${max}文字以内`, style: { width: '420px', fontSize: '32px' } });
  const err = el('div.error-text');
  const count = el('span.muted.num', `0 / ${max}`);
  let easy = false;
  const easyToggle = el('div.toggle', { on: { click: () => { easy = !easy; easyToggle.classList.toggle('on', easy); } } },
    el('div.knob'), el('span', 'かんたんモード（レバレッジなし・小学生におすすめ）'));
  input.addEventListener('input', () => { count.textContent = `${[...input.value].length} / ${max}`; });
  const submit = async () => {
    err.textContent = '';
    try {
      const r = await api.profile({ nickname: input.value, easyMode: easy });
      state.player = r.player;
      sound.win();
      showMenu();
    } catch (e) {
      if (e.code === 'SESSION_LOST') return handleError(e);
      sound.error();
      err.textContent = e.message;
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) submit(); });
  const node = el('div.screen', el('div.panel.col', { style: { alignItems: 'center', minWidth: '640px' } },
    el('h2', 'ニックネームを決めてね'),
    el('div.muted', 'ランキングに表示されます（本名は入れないでね）'),
    el('div.row', input, count),
    easyToggle,
    err,
    el('div.row', el('button.btn.secondary', { on: { click: endSession } }, 'やめる'), el('button.btn.big', { on: { click: submit } }, '決定')),
    el('div.muted', `はじめに ${fmt(state.config.chips.initial)} チップをプレゼント！`)));
  setScreen(node, 'nickname');
  setTimeout(() => input.focus(), 50);
}

// ---------- ゲーム選択 ----------
function availableGames() {
  return GAME_MODULES.filter((g) => state.config.games[g.id]);
}

function showMenu() {
  state.inGame = false;
  state.round = null;
  const p = state.player;
  const easyToggle = el('div.toggle', { class: p.easyMode ? 'on' : '', on: { click: toggleEasy } },
    el('div.knob'), el('span', 'かんたんモード'));
  async function toggleEasy() {
    try {
      const r = await api.profile({ easyMode: !state.player.easyMode });
      state.player = r.player;
      showMenu();
    } catch (e) { handleError(e); }
  }
  const cards = availableGames().map((g, i) => {
    const cfg = state.config.games[g.id];
    return el('div.game-card', {
      tabindex: 0,
      on: {
        click: () => { sound.click(); showBet(g); },
        keydown: (e) => { if (e.key === 'Enter') showBet(g); },
      },
    },
    i === 0 ? el('div.tag', '目玉！') : null,
    el('div.icon', g.icon),
    el('div.name', cfg.name || g.title),
    el('div.desc', g.desc),
    el('div.odds', g.payout(cfg).map(([k, m]) => `${k} ${multLabel(m)}`).join(' / ')));
  });
  const node = el('div.screen.menu',
    el('div.menu-head',
      el('h2', 'ゲームを選んでね'),
      el('div.spacer'),
      el('div.muted', `最高記録 `, el('b.num.gold', fmt(p.peakChips)), ' チップ'),
      easyToggle),
    el('div.game-grid', cards));
  setScreen(node, 'menu');
}

// ---------- 賭け設定 ----------
function showBet(game, introShown = false) {
  const cfg = state.config.games[game.id];
  if (game.intro && !introShown) {
    // 開始前のルール説明
    const node = el('div.screen', el('div.panel.rules-box',
      el('h2', `${cfg.name} のルール`), game.intro(cfg),
      el('div.row', { style: { justifyContent: 'center', marginTop: '16px' } },
        el('button.btn.secondary', { on: { click: showMenu } }, 'もどる'),
        el('button.btn.big', { on: { click: () => showBet(game, true) } }, 'わかった！'))));
    setScreen(node, 'intro');
    return;
  }

  const p = state.player;
  const c = state.config.chips;
  const range = betRange(p.chips, c.minBet);
  const prev = state.lastBet[game.id] || {};
  let bet = Math.min(range.max, Math.max(range.min, prev.bet || Math.min(c.betPresets[0], range.max)));
  let lev = p.easyMode ? 1 : (prev.leverage && c.leverages.includes(prev.leverage) ? prev.leverage : 1);
  const maxLossMult = game.maxLoss ? game.maxLoss(cfg) : 1;
  const maxWinMult = Math.max(...game.payout(cfg).map(([, m]) => m));

  const amount = el('div.bet-amount.num');
  const slider = el('input', { type: 'range', min: range.min, max: range.max, step: 1, value: bet });
  const lossEl = el('b.num.minus');
  const winEl = el('b.num.plus');
  const levNote = el('div.warn.center');
  const levBtns = c.leverages.map((l) => el('button.btn', { dataset: { lev: l }, on: { click: () => { lev = l; sound.chip(); render(); } } }, `×${l}`));

  function setBet(v) {
    bet = Math.max(range.min, Math.min(range.max, Math.round(v)));
    sound.chip();
    render();
  }
  slider.addEventListener('input', () => { bet = Number(slider.value); render(); });

  function render() {
    amount.replaceChildren(fmt(bet), el('small', ' チップ'));
    slider.value = bet;
    levBtns.forEach((b) => b.classList.toggle('sel', Number(b.dataset.lev) === lev));
    const loss = Math.min(bet * maxLossMult * lev, p.chips);
    lossEl.textContent = '−' + fmt(loss);
    winEl.textContent = '+' + fmt(Math.floor(bet * maxWinMult * lev));
    levNote.textContent = loss >= p.chips ? '⚠ 負けるとチップが0になり「ロスカット」です！' : '';
  }

  const presets = [...c.betPresets.filter((v) => v <= range.max && v >= range.min), range.max]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((v) => el('button.btn.secondary', { on: { click: () => setBet(v) } }, v === range.max ? `全部(${fmt(v)})` : fmt(v)));

  const start = async () => {
    startBtn.disabled = true;
    try {
      const r = await api.startRound(game.id, bet, lev);
      state.lastBet[game.id] = { bet, leverage: lev };
      sound.bigWin();
      playGame(game, { roundId: r.roundId, game: game.id, bet: r.bet, leverage: r.leverage });
    } catch (e) {
      startBtn.disabled = false;
      handleError(e);
    }
  };
  const startBtn = el('button.btn.big', { on: { click: start } }, 'スタート！', el('kbd', 'Enter'));
  const onKey = (e) => {
    if (e.key === 'Enter') start();
    else if (e.key === 'Escape') showMenu();
    else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setBet(bet + c.minBet);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setBet(bet - c.minBet);
  };

  const node = el('div.screen', el('div.panel.bet-panel',
    el('div.row', el('h2', { style: { margin: 0 } }, `${game.icon} ${cfg.name}`), el('div.spacer'), el('div.muted', `所持 ${fmt(p.chips)} チップ`)),
    el('div.center.muted', '賭けるチップ'),
    amount,
    el('div.row',
      el('button.btn.secondary', { on: { click: () => setBet(bet - c.minBet) } }, `−${c.minBet}`),
      slider,
      el('button.btn.secondary', { on: { click: () => setBet(bet + c.minBet) } }, `+${c.minBet}`)),
    el('div.bet-row', presets),
    p.easyMode
      ? el('div.center.muted', { style: { margin: '14px 0' } }, 'かんたんモード：レバレッジ ×1 固定')
      : [el('div.center.muted', { style: { marginTop: '14px' } }, 'レバレッジ（結果が何倍になるか）'), el('div.bet-row.lev-row', levBtns)],
    el('div.risk',
      el('div', '最大でもらえる: ', winEl),
      el('div', '最大で失う: ', lossEl)),
    levNote,
    el('div.payout-table', game.payout(cfg).map(([k, m]) => el('span', `${k} `, el('b', multLabel(m))))),
    el('div.row', { style: { justifyContent: 'center', marginTop: '16px' } },
      el('button.btn.secondary', { on: { click: showMenu } }, 'もどる', el('kbd', 'Esc')),
      startBtn)));
  setScreen(node, 'bet');
  window.addEventListener('keydown', onKey);
  state.cleanup = () => window.removeEventListener('keydown', onKey);
  render();
}

// ---------- ゲーム実行 ----------
function playGame(game, round) {
  state.inGame = true;
  state.round = round;
  const cfg = state.config.games[game.id];
  const root = el('div.screen.game-screen');
  setScreen(root, 'game');
  let finished = false;
  const ctx = {
    bet: round.bet,
    leverage: round.leverage,
    cfg,
    sound,
    player: state.player,
    async finish(result) {
      if (finished) return;
      finished = true;
      try {
        const r = await api.finishRound(round.roundId, result);
        state.inGame = false;
        state.player = r.player;
        showResult(game, r);
      } catch (e) {
        state.inGame = false;
        handleError(e);
        if (state.player) showMenu();
      }
    },
  };
  let gameCleanup;
  try {
    gameCleanup = game.mount(root, ctx);
  } catch (e) {
    console.error(e);
    toast('ゲームの起動に失敗しました', { error: true });
  }
  state.cleanup = () => { if (typeof gameCleanup === 'function') gameCleanup(); };
}

// ---------- 結果 ----------
async function showResult(game, r) {
  const cfg = state.config.games[game.id];
  const before = r.player.chips - r.delta;
  const deltaEl = el('div.delta.num', { class: r.delta > 0 ? 'plus' : r.delta < 0 ? 'minus' : '' }, '±0');
  const nowEl = el('span.num.gold', fmt(before));
  const baseText = r.multiplier !== undefined && game.id !== 'holdem'
    ? `賭け ${fmt(r.bet)} × 倍率 ${multLabel(r.multiplier)} × レバレッジ ×${r.leverage}`
    : `持ち込み ${fmt(r.bet)} → 増減 ${signed(Math.round(r.multiplier * r.bet))} × レバレッジ ×${r.leverage}`;
  const buttons = el('div.row', { style: { justifyContent: 'center', marginTop: '20px', visibility: 'hidden' } },
    el('button.btn.secondary.big', { on: { click: () => showBet(game, true) } }, 'もう一度'),
    el('button.btn.big', { on: { click: showMenu } }, 'ゲーム選択へ'));
  const node = el('div.screen.result.center',
    el('div.muted', cfg.name),
    el('div.label', r.label),
    el('div.formula', baseText),
    deltaEl,
    el('div.now', '所持チップ ', nowEl),
    buttons);
  setScreen(node, 'result');

  if (r.delta > 0) {
    if (r.delta >= r.bet * 2) { sound.bigWin(); confetti(140); } else { sound.win(); confetti(50); }
  } else if (r.delta < 0) sound.lose();
  await countUp(deltaEl, 0, r.delta, 1000, (v) => signed(Math.round(v)));
  await countUp(nowEl, before, r.player.chips, 800);
  if (r.losscut) {
    await sleep(900);
    showLosscut(r);
    return;
  }
  updateChips(r.player.chips);
  buttons.style.visibility = 'visible';
}

// ---------- ロスカット ----------
function showLosscut(r) {
  state.screen = 'losscut';
  stopHeartbeat();
  sound.losscut();
  const chart = el('canvas.lc-chart', { width: 600, height: 160 });
  const node = el('div.screen.losscut.center',
    el('div.tape', { style: { top: '2%', transform: 'rotate(-3deg)' } }, 'LOSS CUT ⚠ LOSS CUT ⚠ LOSS CUT ⚠ LOSS CUT ⚠ LOSS CUT ⚠ LOSS CUT'),
    el('div.lc-title', 'ロスカット'),
    el('div.lc-sub', '証拠金（チップ）が尽きました…'),
    chart,
    el('div.lc-sub', `最高記録 `, el('b.gold.num', fmt(r.player.peakChips)), ' チップ はランキングに残ります'),
    el('div.muted', { style: { fontSize: '22px', marginTop: '12px' } }, '受付で1日1回「復活」できます'),
    el('div.tape', { style: { bottom: '1%', transform: 'rotate(2deg)' } }, '⚠ MARGIN CALL ⚠ MARGIN CALL ⚠ MARGIN CALL ⚠ MARGIN CALL ⚠ MARGIN CALL'));
  clear($screen, node);
  renderTopbar();
  // 暴落チャート
  const g = chart.getContext('2d');
  const pts = [];
  let v = 70;
  for (let i = 0; i < 60; i++) { v = Math.max(40, Math.min(150, v + (Math.random() - 0.4) * 12)); pts.push(v); }
  for (let i = 0; i < 15; i++) pts.push(Math.max(0, pts[pts.length - 1] - 10 - i * 1.5));
  let k = 0;
  const draw = () => {
    g.clearRect(0, 0, 600, 160);
    g.strokeStyle = '#ff4d5e';
    g.lineWidth = 4;
    g.beginPath();
    for (let i = 0; i <= k && i < pts.length; i++) {
      const x = (i / (pts.length - 1)) * 600;
      const y = 160 - Math.max(2, pts[i]);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    if (++k < pts.length) requestAnimationFrame(draw);
  };
  draw();
  api.session = null; // サーバー側でロックは解除済み
  const timer = setTimeout(resetToStandby, 9000);
  node.addEventListener('click', () => { clearTimeout(timer); resetToStandby(); });
}

// ---------- 起動 ----------
async function boot() {
  for (;;) {
    try {
      state.config = await api.config();
      break;
    } catch (e) {
      clear($screen, el('div.screen', el('div.panel.msgbox', el('div.big-icon', '🔌'), el('h2', 'サーバーに接続中…'), el('p.muted', e.message))));
      await sleep(3000);
    }
  }
  showStandby();
}

window.addEventListener('beforeunload', () => {
  if (api.session) navigator.sendBeacon?.('/api/logout', new Blob([JSON.stringify(api.session)], { type: 'application/json' }));
});

// 右クリックメニュー・ドラッグ等を抑止（展示用）
window.addEventListener('contextmenu', (e) => { if (!new URLSearchParams(location.search).has('debug')) e.preventDefault(); });

boot();
