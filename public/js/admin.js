// 管理画面
import { request } from './api.js';
import { el, clear, fmt, signed, toast } from './ui.js';
import { QrScanner } from './qr.js';

const root = document.getElementById('admin');
let token = null;
try { token = localStorage.getItem('casino.adminToken'); } catch { /* ignore */ }
let config = null;
let tab = 'players';
let current = null; // 表示中のプレイヤーID
let scanner = null;

const GAME_LABEL = {
  initial: '初期配布', vr_bonus: 'VRボーナス', revive: '復活', admin_adjust: '管理:調整', admin_set: '管理:残高設定', admin_revert: '管理:取消',
};
const gameName = (g) => GAME_LABEL[g] || config?.games[g]?.name || g;

function adm(method, url, body) {
  return request(method, url, body, { 'x-admin-token': token || '' }).catch((e) => {
    if (e.status === 401 && url !== '/api/admin/login') {
      token = null;
      try { localStorage.removeItem('casino.adminToken'); } catch { /* ignore */ }
      renderLogin();
    }
    throw e;
  });
}

function err(e) {
  toast(e.message || String(e), { error: true, ms: 4000 });
}

// ---------- ログイン ----------
function renderLogin() {
  stopScanner();
  const pw = el('input', { type: 'password', placeholder: 'パスワード', style: { width: '100%' } });
  const go = async () => {
    try {
      const r = await request('POST', '/api/admin/login', { password: pw.value });
      token = r.token;
      try { localStorage.setItem('casino.adminToken', token); } catch { /* ignore */ }
      render();
    } catch (e) { err(e); }
  };
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  clear(root, el('div.panel.login-box.col', el('h2', '管理画面ログイン'), pw, el('button.btn', { on: { click: go } }, 'ログイン')));
  pw.focus();
}

// ---------- 共通レイアウト ----------
function render() {
  const tabs = [
    ['players', 'プレイヤー / チップ付与'], ['history', '全履歴'], ['stats', '状況'], ['cards', 'QRカード印刷'], ['data', 'バックアップ / リセット'],
  ];
  const body = el('div');
  clear(root, el('div.admin-wrap',
    el('div.admin-head', el('h1', '♠ CASINO 管理画面'), el('div.spacer'),
      el('a.btn.secondary.small', { href: '/ranking', target: '_blank' }, 'ランキング表示'),
      el('button.btn.secondary.small', { on: { click: () => { token = null; try { localStorage.removeItem('casino.adminToken'); } catch { /* ignore */ } renderLogin(); } } }, 'ログアウト')),
    el('div.tabs', tabs.map(([id, label]) => el('button', { class: tab === id ? 'on' : '', on: { click: () => { tab = id; render(); } } }, label))),
    body));
  stopScanner();
  ({ players: renderPlayers, history: renderHistory, stats: renderStats, cards: renderCards, data: renderData })[tab](body);
}

function stopScanner() {
  scanner?.stop();
  scanner = null;
}

// ---------- プレイヤー ----------
function renderPlayers(body) {
  const input = el('input', { placeholder: 'ID / QR / ニックネーム', style: { flex: 1 } });
  const video = el('video', { autoplay: true, muted: true, playsinline: true });
  const nocam = el('div.nocam.hidden');
  const list = el('div.scroll');
  const detail = el('div.panel', el('div.muted', '左でプレイヤーを選ぶか、QRを読み取ってください'));

  const open = async (idOrCode) => {
    try {
      current = idOrCode;
      await loadDetail(detail, idOrCode, true);
      input.value = '';
    } catch (e) { err(e); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = input.value.trim();
    if (/^[A-Za-z]*\d+([-_ ]?[A-Za-z0-9]{4})?$/.test(v.normalize('NFKC'))) open(v);
    else loadList(list, v, open);
  });

  clear(body, el('div.grid2',
    el('div.col',
      el('div.panel.col',
        el('h2', 'QRを読み取る'),
        el('div.mini-scan', video, nocam),
        el('div.row', input, el('button.btn.small', { on: { click: () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) } }, '検索')),
        el('div.note', 'IDだけ（例: P0012 や 12）でも開けます。名前で検索すると一覧を絞り込みます。')),
      el('div.panel', el('h2', '最近のプレイヤー'), list)),
    detail));

  scanner = new QrScanner(video, (text) => open(text));
  scanner.start().catch((e) => {
    nocam.classList.remove('hidden');
    nocam.textContent = e.message || 'カメラが使えません（IDを入力してください）';
  });
  loadList(list, '', open);
  if (current) loadDetail(detail, current, false).catch(() => {});
}

async function loadList(list, q, open) {
  try {
    const r = await adm('GET', `/api/admin/players?q=${encodeURIComponent(q)}`);
    clear(list, el('table',
      el('thead', el('tr', el('th', 'ID'), el('th', '名前'), el('th', 'チップ'), el('th', '最高'), el('th', '状態'))),
      el('tbody', r.players.map((p) => el('tr.clickable', { on: { click: () => open(p.id) } },
        el('td', p.id), el('td', p.nickname || '（未登録）'), el('td.num', fmt(p.chips)), el('td.num', fmt(p.peakChips)),
        el('td', p.activeSession ? `🎮 ${p.activeSession}` : p.chips === 0 ? '💀 0' : ''))))));
  } catch (e) { err(e); }
}

async function loadDetail(detail, idOrCode, create) {
  const r = await adm('GET', `/api/admin/players/${encodeURIComponent(idOrCode)}${create ? '?create=1' : ''}`);
  const p = r.player;
  current = p.id;
  const c = config.chips;
  const amount = el('input', { type: 'number', placeholder: '例: 50 / -30', style: { width: '120px' } });
  const note = el('input', { placeholder: 'メモ（任意）', style: { width: '200px' } });
  const nick = el('input', { value: p.nickname || '', style: { width: '180px' } });
  const peak = el('input', { type: 'number', value: p.peakChips, style: { width: '120px' } });

  const act = async (fn, okMsg) => {
    try {
      const res = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(res) : okMsg);
      await loadDetail(detail, p.id, false);
    } catch (e) { err(e); }
  };
  const chips = (kind, extra = {}) => act(() => adm('POST', `/api/admin/players/${p.id}/chips`, { kind, note: note.value, ...extra }),
    (res) => `${p.nickname || p.id}: ${signed(res.delta)} → ${fmt(res.player.chips)}`);

  clear(detail,
    el('div.row', el('h2', { style: { margin: 0 } }, `${p.id}　${p.nickname || '（ニックネーム未登録）'}`), el('div.spacer'),
      p.activeSession ? el('span.warn', `プレイ中: ${p.activeSession}${p.pendingRound ? `（${gameName(p.pendingRound)}）` : ''}`) : null),
    el('div.row', { style: { alignItems: 'flex-end', gap: '30px', margin: '10px 0' } },
      el('div', el('div.muted', '所持チップ'), el('div.big-chips.num', fmt(p.chips))),
      el('dl.kv',
        el('dt', '最高チップ'), el('dd.num', fmt(p.peakChips)),
        el('dt', 'ロスカット'), el('dd', `${p.losscutCount} 回`),
        el('dt', '本日VR'), el('dd', `${p.vrToday} / ${c.vrBonusPerDay}`),
        el('dt', '本日復活'), el('dd', `${p.reviveToday} / ${c.revivePerDay}`),
        el('dt', 'かんたん'), el('dd', p.easyMode ? 'ON' : 'OFF'))),
    el('div.btn-row',
      el('button.btn.green.big', { disabled: p.vrToday >= c.vrBonusPerDay, on: { click: () => chips('vr_bonus') } }, `🥽 VRボーナス +${c.vrBonus}`),
      el('button.btn.blue.big', { disabled: p.reviveToday >= c.revivePerDay || (c.reviveOnlyWhenZero && p.chips > 0), on: { click: () => chips('revive') } }, `💊 復活 +${c.revive}`)),
    el('div.note', `VRボーナスは1日${c.vrBonusPerDay}回、復活は1日${c.revivePerDay}回${c.reviveOnlyWhenZero ? '（チップ0のときだけ）' : ''}まで。`),
    el('h2', { style: { marginTop: '16px' } }, '残高の修正'),
    el('div.btn-row', amount, note,
      el('button.btn.small', { on: { click: () => chips('adjust', { amount: Number(amount.value) }) } }, '増減する'),
      el('button.btn.small.secondary', { on: { click: () => { if (confirm(`残高を ${amount.value} に設定しますか？`)) chips('set', { amount: Number(amount.value) }); } } }, 'この値に設定')),
    el('div.btn-row',
      nick, el('button.btn.small.secondary', { on: { click: () => act(() => adm('POST', `/api/admin/players/${p.id}/update`, { nickname: nick.value }), '名前を変更しました') } }, '名前変更'),
      peak, el('button.btn.small.secondary', { on: { click: () => act(() => adm('POST', `/api/admin/players/${p.id}/update`, { peakChips: Number(peak.value) }), '最高チップを変更しました') } }, '最高チップ変更')),
    el('div.btn-row',
      el('button.btn.small.secondary', { on: { click: () => act(() => adm('POST', `/api/admin/players/${p.id}/update`, { easyMode: !p.easyMode }), 'かんたんモードを切り替えました') } }, `かんたんモードを${p.easyMode ? 'OFF' : 'ON'}`),
      el('button.btn.small.danger', { on: { click: () => { if (confirm('端末のロックを解除しますか？（プレイ中のゲームは負け扱い）')) act(() => adm('POST', `/api/admin/players/${p.id}/unlock`), 'ロックを解除しました'); } } }, 'ロック解除')),
    el('h2', { style: { marginTop: '16px' } }, '履歴'),
    el('div.scroll', txTable(r.transactions, () => loadDetail(detail, p.id, false))));
}

function txTable(rows, reload, showPlayer = false) {
  return el('table',
    el('thead', el('tr', el('th', '#'), el('th', '日時'), showPlayer ? el('th', 'プレイヤー') : null, el('th', '内容'), el('th', '賭け'), el('th', 'Lev'), el('th', '倍率'), el('th', '増減'), el('th', '残高'), el('th', '端末'), el('th', ''))),
    el('tbody', rows.map((t) => {
      let detail = '';
      try { const d = JSON.parse(t.detail || 'null'); detail = d?.label || d?.note || (d?.forfeit ? `途中終了(${d.forfeit})` : d?.revertOf ? `#${d.revertOf} の取消` : ''); } catch { /* ignore */ }
      return el('tr', { class: t.reverted_by ? 'reverted' : '' },
        el('td', t.id), el('td', t.created_at.slice(5)), showPlayer ? el('td', `${t.player_id} ${t.nickname || ''}`) : null,
        el('td', gameName(t.game), detail ? el('span.muted', ` ${detail}`) : null),
        el('td.num', t.bet ?? ''), el('td.num', t.leverage ? `×${t.leverage}` : ''), el('td.num', t.multiplier ?? ''),
        el('td.num', { class: t.delta > 0 ? 'plus' : t.delta < 0 ? 'minus' : '' }, signed(t.delta)),
        el('td.num', fmt(t.balance_after)), el('td', t.terminal || ''),
        el('td', !t.reverted_by && t.game !== 'admin_revert'
          ? el('button.btn.small.secondary', { on: { click: async () => {
            if (!confirm(`#${t.id}（${signed(t.delta)}）を取り消しますか？`)) return;
            try { await adm('POST', `/api/admin/transactions/${t.id}/revert`); toast('取り消しました'); reload(); } catch (e) { err(e); }
          } } }, '取消') : ''));
    })));
}

// ---------- 全履歴 ----------
async function renderHistory(body) {
  const box = el('div.panel');
  clear(body, box);
  const load = async () => {
    try {
      const r = await adm('GET', '/api/admin/transactions?limit=300');
      clear(box, el('div.row', el('h2', '直近300件'), el('div.spacer'), el('button.btn.small.secondary', { on: { click: load } }, '更新')),
        el('div.scroll', { style: { maxHeight: '75vh' } }, txTable(r.transactions, load, true)));
    } catch (e) { err(e); }
  };
  load();
}

// ---------- 状況 ----------
async function renderStats(body) {
  try {
    const r = await adm('GET', '/api/admin/stats');
    const t = r.totals;
    clear(body,
      el('div.stat-cards',
        el('div.panel', '発行済みカード', el('b.num', fmt(t.players))),
        el('div.panel', '登録済み', el('b.num', fmt(t.registered || 0))),
        el('div.panel', '流通チップ合計', el('b.num', fmt(t.chips))),
        el('div.panel', 'チップ0の人', el('b.num', fmt(t.zero)))),
      el('div.grid2',
        el('div.panel', el('h2', 'プレイ中の端末'), r.active.length
          ? el('table', el('tbody', r.active.map((a) => el('tr', el('td', a.terminal), el('td', `${a.id} ${a.nickname || ''}`), el('td', a.game ? gameName(a.game) : 'メニュー')))))
          : el('div.muted', 'なし')),
        el('div.panel', el('h2', '種類別'), el('table',
          el('thead', el('tr', el('th', '種類'), el('th', '回数'), el('th', '本日'), el('th', 'チップ増減合計'))),
          el('tbody', r.byGame.map((g) => el('tr', el('td', gameName(g.game)), el('td.num', fmt(g.plays)), el('td.num', fmt(g.today)), el('td.num', signed(g.net)))))))),
      el('div.note', { style: { marginTop: '10px' } }, `DB: ${r.dbFile}`));
  } catch (e) { err(e); }
}

// ---------- カード印刷 ----------
function renderCards(body) {
  const from = el('input', { type: 'number', value: 1, min: 1, style: { width: '100px' } });
  const count = el('input', { type: 'number', value: 50, min: 1, max: 500, style: { width: '100px' } });
  clear(body, el('div.panel.col', { style: { maxWidth: '640px' } },
    el('h2', 'QRカードを印刷'),
    el('div.row', '開始番号', from, '枚数', count,
      el('button.btn', { on: { click: () => window.open(`/cards.html?from=${from.value}&count=${count.value}`, '_blank') } }, '印刷用ページを開く')),
    el('div.note', 'A4用紙1枚に10枚（名刺サイズ 91×55mm）。印刷時は「余白なし」「倍率100%」にしてください。'),
    el('div.note', 'カードの確認コードは config の card.secret から作られます。印刷後に secret を変えるとカードが使えなくなるので注意。')));
}

// ---------- バックアップ / リセット ----------
function renderData(body) {
  const confirmInput = el('input', { placeholder: 'RESET と入力' });
  clear(body, el('div.col', { style: { maxWidth: '760px' } },
    el('div.panel.col',
      el('h2', 'バックアップ'),
      el('div.note', 'サーバーは自動で定期バックアップしています（data/backups）。各日の終了時は下の「ダウンロード」でUSBメモリにも保存してください。'),
      el('div.btn-row',
        el('a.btn', { href: `/api/admin/backup/download?token=${encodeURIComponent(token)}` }, 'DBファイルをダウンロード'),
        el('button.btn.secondary', { on: { click: async () => {
          try { const r = await adm('POST', '/api/admin/backup'); toast(`保存しました: ${r.file}`, { ms: 6000 }); } catch (e) { err(e); }
        } } }, 'サーバー内に今すぐ保存'))),
    el('div.panel.col',
      el('h2', { style: { color: 'var(--red)' } }, 'データのリセット'),
      el('div.note', '全プレイヤーと全履歴を削除します（実行前に自動でバックアップされます）。本番前のテストデータ削除などに使ってください。'),
      el('div.btn-row', confirmInput,
        el('button.btn.danger', { on: { click: async () => {
          if (confirmInput.value !== 'RESET') return toast('確認欄に RESET と入力してください', { error: true });
          if (!confirm('本当に全データを削除しますか？')) return;
          try { const r = await adm('POST', '/api/admin/reset', { confirm: 'RESET' }); toast(`リセットしました（バックアップ: ${r.backup}）`, { ms: 8000 }); confirmInput.value = ''; } catch (e) { err(e); }
        } } }, '全データを削除')))));
}

// ---------- 起動 ----------
(async () => {
  config = await request('GET', '/api/config');
  if (!token) return renderLogin();
  try {
    await adm('GET', '/api/admin/stats');
    render();
  } catch { /* renderLogin 済み */ }
})();
