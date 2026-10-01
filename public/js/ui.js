// 画面部品の共通ヘルパー
import { SUIT_MARK, rankLabel } from './lib/cards.js';
import { MONTHS, byId as hanaById } from './lib/koikoi.js';

// el('div.cls#id', { attrs / on: {click} }, children...)
export function el(spec, props, ...children) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    if (props != null) children.unshift(props);
    props = {};
  }
  const m = spec.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const node = document.createElement(m[1] || 'div');
  for (const part of m[2].match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') node.classList.add(part.slice(1));
    else node.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) node.style.setProperty(sk, sv);
        else node.style[sk] = sv;
      }
    }
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'class') node.className += ' ' + v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fmt(n) {
  return Math.round(n).toLocaleString('ja-JP');
}

export function signed(n) {
  return (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n));
}

export function multLabel(m) {
  const v = Math.round(m * 100) / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v);
}

// トランプ1枚
export function cardEl(c, { back = false, cls = '', size } = {}) {
  if (back || !c) return el('div.pcard.back', { class: cls, style: size ? { '--cw': size + 'px' } : null });
  if (c.joker && size && size <= 34) {
    return el('div.pcard.mini.joker', { class: cls, style: { '--cw': size + 'px' } }, el('div.mr', '★'), el('div.ms', 'JK'));
  }
  if (c.joker) {
    return el('div.pcard.joker', { class: cls, style: size ? { '--cw': size + 'px' } : null },
      el('div.tl', '★'), el('div.mid', 'JOKER'), el('div.br', '★'));
  }
  const red = c.s === 'H' || c.s === 'D';
  const r = rankLabel(c.r);
  const s = SUIT_MARK[c.s];
  if (size && size <= 34) {
    // 早見表用のミニカード（数字とマークだけ）
    return el('div.pcard.mini', { class: (red ? 'red ' : '') + cls, style: { '--cw': size + 'px' } }, el('div.mr', r), el('div.ms', s));
  }
  return el('div.pcard', { class: (red ? 'red ' : '') + cls, style: size ? { '--cw': size + 'px' } : null },
    el('div.tl', r, el('i', s)), el('div.mid', s), el('div.br', r, el('i', s)));
}

// 花札1枚（自作の簡易デザイン：月の色＋月名＋種類）
export function hanaEl(id, { back = false, cls = '', size } = {}) {
  const style = size ? { '--hw': size + 'px' } : {};
  if (back) return el('div.hana.back', { class: cls, style });
  const c = hanaById[id];
  const month = MONTHS[c.month];
  const flagCls = c.type === 'tan' ? (c.flag === 'aka' ? 'f-aka' : c.flag === 'ao' ? 'f-ao' : 'f-plain') : '';
  const badge = { hikari: '光', tane: c.name.split('に')[1] || 'タネ', tan: c.flag === 'aka' ? '赤短' : c.flag === 'ao' ? '青短' : '短冊', kasu: 'カス' }[c.type];
  return el('div.hana', {
    class: `t-${c.type} ${flagCls} ${cls}`,
    style: { ...style, background: `linear-gradient(180deg, ${month.color} 0%, ${shade(month.color)} 100%)` },
    title: c.name,
    dataset: { id },
  },
  el('div.m', month.name.length > 1 ? month.name : month.name),
  el('div.badge', c.type === 'tane' ? badge.slice(0, 3) : badge),
  el('div.mn', `${c.month}月`));
}

function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.floor(v * 0.45));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

let toastBox;
export function toast(msg, { error = false, ms = 2600 } = {}) {
  toastBox ||= document.getElementById('toast');
  const d = el('div', { class: error ? 'err' : '' }, msg);
  toastBox.append(d);
  setTimeout(() => d.remove(), ms);
}

// 数字のカウントアップ演出
export function countUp(node, from, to, ms = 1200, format = fmt) {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      node.textContent = format(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export function confetti(n = 80) {
  const colors = ['#f6c453', '#ff4d5e', '#3ddc84', '#4da3ff', '#b57bff', '#fff'];
  for (let i = 0; i < n; i++) {
    const d = el('div.confetti', {
      style: {
        left: Math.random() * 100 + 'vw',
        background: colors[i % colors.length],
        animationDuration: 1.8 + Math.random() * 2 + 's',
        animationDelay: Math.random() * 0.6 + 's',
      },
    });
    document.body.append(d);
    setTimeout(() => d.remove(), 5000);
  }
}

// 金色のコインが降ってくる演出
export function coinShower(n = 40) {
  for (let i = 0; i < n; i++) {
    const d = el('div.coin', {
      style: {
        left: Math.random() * 100 + 'vw',
        animationDuration: 1.6 + Math.random() * 1.8 + 's',
        animationDelay: Math.random() * 1.2 + 's',
        transform: `scale(${0.7 + Math.random() * 0.6})`,
      },
    });
    document.body.append(d);
    setTimeout(() => d.remove(), 5000);
  }
}

// 手番の制限時間（時間切れで onTimeout）
export function turnTimer(container, seconds, onTimeout) {
  const bar = el('div.timer-bar', el('div'));
  const label = el('span.muted.num', '');
  const box = el('div.row', label, bar);
  container.replaceChildren(box);
  let left = seconds;
  let id = null;
  const render = () => {
    bar.firstChild.style.width = (left / seconds) * 100 + '%';
    bar.classList.toggle('low', left <= 5);
    label.textContent = `残り${Math.ceil(left)}秒`;
  };
  const api = {
    start(sec = seconds) {
      api.stop();
      seconds = sec;
      left = sec;
      box.style.visibility = 'visible';
      render();
      id = setInterval(() => {
        left -= 0.25;
        render();
        if (left <= 0) {
          api.stop();
          onTimeout();
        }
      }, 250);
    },
    stop() {
      if (id) clearInterval(id);
      id = null;
      box.style.visibility = 'hidden';
    },
  };
  box.style.visibility = 'hidden';
  return api;
}

// "5H 6H 7H" のような表記からカードの配列を作る（早見表の例示用）
const RANK_FROM = { A: 1, J: 11, Q: 12, K: 13 };
export function cards(str) {
  return str.split(/\s+/).filter(Boolean).map((t) => (t === 'JK'
    ? { joker: true, r: 0, s: 'X', id: 'JK' }
    : { r: RANK_FROM[t.slice(0, -1)] || Number(t.slice(0, -1)), s: t.slice(-1) }));
}

export function miniCards(str, size = 24) {
  return el('div.mini-cards', cards(str).map((c) => cardEl(c, { size })));
}

// ゲーム画面を「メイン＋右側の早見表」に分ける
export function gameLayout(root, title = '早見表') {
  root.classList.add('with-side');
  const main = el('div.game-main');
  const body = el('div.side-body');
  const side = el('aside.side-panel', el('div.side-title', '📖 ', title), body);
  clear(root, main, side);
  return { main, side: body };
}

// 早見表の1行（タイトル・説明・カードの絵）
export function sideRow({ title, desc, visual, note, cls = '' }) {
  return el('div.side-row', { class: cls },
    el('div.side-row-head', el('b', title), note ? el('span.side-note', note) : null),
    desc ? el('div.side-desc', desc) : null,
    visual || null);
}

// ルール説明のオーバーレイ（ゲーム中にいつでも開ける）
export function showOverlay(title, content) {
  const close = () => box.remove();
  const box = el('div.overlay', { on: { click: (e) => { if (e.target === box) close(); } } },
    el('div.panel.rules-box', { style: { maxHeight: '90vh', overflowY: 'auto' } },
      el('div.row', el('h2', { style: { margin: 0 } }, title), el('div.spacer'), el('button.btn.small', { on: { click: close } }, '閉じる')),
      content,
      el('div.center', { style: { marginTop: '14px' } }, el('button.btn', { on: { click: close } }, 'ゲームにもどる'))));
  document.body.append(box);
  const onKey = (e) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onKey, true); } };
  window.addEventListener('keydown', onKey, true);
  return close;
}
