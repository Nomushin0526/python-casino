// ランキング表示（別モニター用・自動更新）
import { request } from './api.js';
import { el, clear, fmt } from './ui.js';

const TOP = 10;
let prev = null; // 前回の nickname -> 最高チップ（更新された行を光らせる）
let refreshSec = 5;

async function load() {
  try {
    const r = await request('GET', '/api/ranking');
    const s = r.stats;
    clear(document.getElementById('stats'),
      '参加 ', el('b.num', fmt(s.players)), ' 人　プレイ ', el('b.num', fmt(s.plays)), ' 回　ロスカット ', el('b.num', fmt(s.losscuts)), ' 回');
    const row = (p, cls = '') => {
      const isNew = prev && prev.get(p.nickname) !== p.peakChips;
      return el('div.rank-row', { class: `${cls} ${p.rank <= 3 ? 'r' + p.rank : ''} ${isNew ? 'new' : ''}` },
        el('div.no', p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : p.rank),
        el('div.name', p.nickname),
        el('div.pk', fmt(p.peakChips), el('small', 'チップ')));
    };
    const top = r.ranking.slice(0, TOP);
    clear(document.getElementById('top'), top.length ? top.map((p) => row(p)) : el('div.empty', 'まだ誰もいません。最初のチャンピオンになろう！'));
    clear(document.getElementById('sub'), r.ranking.slice(TOP).map((p) => row(p)));
    clear(document.getElementById('feed'), r.recentBig.length
      ? r.recentBig.map((b) => el('div', `${b.at.slice(11, 16)}　${b.nickname} さんが ${b.game}${b.leverage > 1 ? `（×${b.leverage}）` : ''}で `, el('b', `+${fmt(b.delta)}`)))
      : el('div.muted', '—'));
    prev = new Map(r.ranking.map((p) => [p.nickname, p.peakChips]));
    document.getElementById('updated').textContent = `最終更新 ${new Date().toLocaleTimeString('ja-JP')}`;
  } catch (e) {
    document.getElementById('updated').textContent = `更新失敗（${e.message}）`;
  }
}

(async () => {
  try { refreshSec = (await request('GET', '/api/config')).ranking.refreshSec || 5; } catch { /* 既定値 */ }
  load();
  setInterval(load, refreshSec * 1000);
})();
