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
  if (c.joker) {
    return el('div.pcard.joker', { class: cls, style: size ? { '--cw': size + 'px' } : null },
      el('div.tl', '★'), el('div.mid', 'JOKER'), el('div.br', '★'));
  }
  const red = c.s === 'H' || c.s === 'D';
  const r = rankLabel(c.r);
  const s = SUIT_MARK[c.s];
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
