// カジノのAPI本体（PC版の Express と Cloudflare Pages Functions の両方から呼ぶ）
// Node.js 専用の機能は使わない（Web 標準の API と、非同期のDBインターフェースだけ）
import { nameKey, validatePassword, hashPassword, verifyPassword, randomHex } from './accounts.js';
import { publicConfig } from './public-config.js';
import { validateNickname } from '../ngwords.js';
import { resolveOutcome, computeDelta, betRange, SettleError } from '../../public/js/lib/settle.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// db: { get, all, run, batch }（db-node.js / db-d1.js）
// opts.now: 現在時刻(ms)、opts.adminPassword: 管理画面のパスワード（空なら管理画面を使えない）
export function createApi(cfg, db, { now = () => Date.now(), adminPassword = cfg.admin?.password, platform = 'pc' } = {}) {
  const lockMs = cfg.session.lockTimeoutSec * 1000;
  const tzMs = (cfg.timezoneOffsetMinutes ?? 540) * 60e3; // 日本時間

  // 日本時間の 'YYYY-MM-DD HH:MM:SS'
  const stamp = (ms = now()) => new Date(ms + tzMs).toISOString().replace('T', ' ').slice(0, 19);
  const today = () => stamp().slice(0, 10);

  // ---------- プレイヤー ----------
  const playerView = (p) => p && {
    id: p.id,
    nickname: p.nickname,
    chips: p.chips,
    peakChips: p.peak_chips,
    losscutCount: p.losscut_count,
    easyMode: !!p.easy_mode,
  };

  const getPlayer = (id) => db.get('SELECT * FROM players WHERE id = ?', id);
  const allByName = (key) => db.all('SELECT * FROM players WHERE name_key = ? ORDER BY created_at', key);
  const countToday = async (id, game) => (await db.get(
    'SELECT COUNT(*) AS n FROM transactions WHERE player_id = ? AND game = ? AND reverted_by IS NULL AND substr(created_at, 1, 10) = ?',
    id, game, today())).n;
  const releaseLock = (id) => db.run('UPDATE players SET active_session = NULL, session_token = NULL, session_seen_at = NULL WHERE id = ?', id);

  const ADD_TX = `INSERT INTO transactions (player_id, game, bet, leverage, multiplier, delta, balance_after, detail, terminal, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  // チップを増減して transactions に記録する（必ずここを通す）
  async function applyDelta(id, { game, delta, bet = null, leverage = null, multiplier = null, detail = null, terminal = null, countLosscut = false, extra = [] }) {
    const p = await getPlayer(id);
    if (!p) throw new ApiError(404, 'NOT_FOUND', 'プレイヤーが見つかりません');
    const d = Math.max(Math.trunc(delta), -p.chips);
    const after = p.chips + d;
    const losscut = countLosscut && p.chips > 0 && after <= 0 ? 1 : 0;
    const ts = stamp();
    const res = await db.batch([
      ['UPDATE players SET chips = ?, peak_chips = MAX(peak_chips, ?), losscut_count = losscut_count + ?, updated_at = ? WHERE id = ?', [after, after, losscut, ts, id]],
      [ADD_TX, [id, game, bet, leverage, multiplier, d, after, detail == null ? null : JSON.stringify(detail), terminal, ts]],
      ...extra,
    ]);
    return { player: await getPlayer(id), delta: d, losscut: !!losscut, txId: res[1].lastId };
  }

  // ---------- ラウンド（ゲーム1回分） ----------
  const pendingRound = (playerId) => db.get('SELECT * FROM rounds WHERE player_id = ?', playerId);

  // 途中放棄されたラウンドを「負け(-1)」として精算する
  async function forfeitPending(playerId, reason) {
    const r = await pendingRound(playerId);
    if (!r) return null;
    const p = await getPlayer(playerId);
    const delta = computeDelta({ bet: r.bet, leverage: r.leverage, multiplier: -1, chips: p.chips });
    return applyDelta(playerId, {
      game: r.game, delta, bet: r.bet, leverage: r.leverage, multiplier: -1,
      detail: { forfeit: reason }, terminal: r.terminal, countLosscut: true,
      extra: [['DELETE FROM rounds WHERE id = ?', [r.id]]],
    });
  }

  // ---------- セッション ----------
  const isLockedByOther = (p, terminal) =>
    p.active_session && p.active_session !== terminal && p.session_seen_at && now() - p.session_seen_at < lockMs;

  // 端末からのリクエストの認証（playerId + token）
  async function auth(body) {
    const { playerId, token } = body || {};
    const p = typeof playerId === 'string' ? await getPlayer(playerId) : null;
    if (!p || !token || p.session_token !== token) {
      throw new ApiError(409, 'SESSION_LOST', 'セッションが切れました。もう一度ログインしてください');
    }
    await db.run('UPDATE players SET session_seen_at = ? WHERE id = ?', now(), p.id);
    return p;
  }

  function checkTerminal(terminalId) {
    if (typeof terminalId !== 'string' || !terminalId) throw new ApiError(400, 'BAD_TERMINAL', '端末IDがありません');
  }

  // ログイン状態にする（端末ロック・前の人の後始末）
  async function startSession(p, terminalId) {
    if (isLockedByOther(p, terminalId)) {
      throw new ApiError(423, 'LOCKED', 'この名前は別の端末でプレイ中です。そちらを終了してからログインしてください');
    }
    for (const { id: other } of await db.all('SELECT id FROM players WHERE active_session = ?', terminalId)) {
      if (other !== p.id) {
        await forfeitPending(other, 'replaced');
        await releaseLock(other);
      }
    }
    await forfeitPending(p.id, 'relogin');
    const token = randomHex(16);
    await db.run('UPDATE players SET active_session = ?, session_token = ?, session_seen_at = ? WHERE id = ?', terminalId, token, now(), p.id);
    const fresh = await getPlayer(p.id);
    // チップが0なら「最初からやり直す」を案内する（ログインはしたまま）
    return { status: fresh.chips <= 0 ? 'no_chips' : 'ok', token, player: playerView(fresh) };
  }

  // ---------- 管理 ----------
  async function checkAdmin(token) {
    const s = token ? await db.get('SELECT * FROM admin_sessions WHERE token = ?', token) : null;
    if (!s || s.expires_at < now()) throw new ApiError(401, 'ADMIN_AUTH', '管理画面にログインしてください');
  }

  const adminPlayerView = async (p) => p && {
    ...playerView(p),
    activeSession: p.session_seen_at && now() - p.session_seen_at < lockMs ? p.active_session : null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    vrToday: await countToday(p.id, 'vr_bonus'),
    pendingRound: (await pendingRound(p.id))?.game || null,
  };

  // 内部ID（U…）または登録名で探す
  async function findPlayer(idOrName) {
    const q = String(idOrName ?? '').trim();
    const byId = q ? await getPlayer(q) : null;
    if (byId) return byId;
    const list = q ? await allByName(nameKey(q)) : [];
    if (!list.length) throw new ApiError(404, 'NOT_FOUND', `「${q}」という名前は登録されていません`);
    if (list.length > 1) throw new ApiError(409, 'AMBIGUOUS', `「${q}」は${list.length}人います。一覧から選んでください`);
    return list[0];
  }

  // ---------- ルート定義 ----------
  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

  route('GET', '/config', () => ({ ...publicConfig(cfg), platform }));
  route('GET', '/health', () => ({ ok: true, time: new Date(now()).toISOString() }));

  // 名前が使えるか（新規登録画面で入力中に確認）
  route('GET', '/name-check', async ({ query }) => {
    const v = validateNickname(cfg, String(query.get('name') ?? ''));
    if (!v.ok) return { ok: false, message: v.error };
    const same = (await allByName(nameKey(v.nickname))).length;
    if (same && !cfg.account.allowDuplicateNames) return { ok: false, message: 'この名前はすでに使われています' };
    if (same) return { ok: true, same: true, message: `同じ名前の人が${same}人います（パスワードで区別するので登録できます）` };
    return { ok: true, message: 'この名前は使えます' };
  });

  route('POST', '/register', async ({ body }) => {
    const { username, password, terminalId, easyMode } = body || {};
    checkTerminal(terminalId);
    const v = validateNickname(cfg, username);
    if (!v.ok) throw new ApiError(400, 'BAD_NAME', v.error);
    const pw = validatePassword(cfg, password);
    if (!pw.ok) throw new ApiError(400, 'BAD_PASSWORD', pw.error);
    const key = nameKey(v.nickname);
    const same = await allByName(key);
    if (same.length && !cfg.account.allowDuplicateNames) throw new ApiError(409, 'NAME_TAKEN', 'この名前はすでに使われています。別の名前にしてね');
    // 同じ名前＋同じパスワードだとログインで区別できないので登録できない
    for (const o of same) {
      if (await verifyPassword(pw.password, o.password_hash)) {
        throw new ApiError(409, 'SAME_NAME_PASSWORD', '同じ名前で同じパスワードの人がいます。パスワードを変えてね');
      }
    }
    const id = 'U' + randomHex(5);
    const ts = stamp();
    const init = cfg.chips.initial;
    await db.batch([
      [`INSERT INTO players (id, nickname, name_key, password_hash, easy_mode, chips, peak_chips, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, v.nickname, key, await hashPassword(pw.password), easyMode ? 1 : 0, init, init, ts, ts]],
      [ADD_TX, [id, 'initial', null, null, null, init, init, null, terminalId, ts]],
    ]);
    return startSession(await getPlayer(id), terminalId);
  });

  route('POST', '/login', async ({ body }) => {
    const { username, password, terminalId } = body || {};
    checkTerminal(terminalId);
    const key = nameKey(username ?? '');
    // 同じ名前が複数いてもパスワードが合う人を探す
    for (const o of key ? await allByName(key) : []) {
      if (await verifyPassword(String(password ?? ''), o.password_hash)) return startSession(o, terminalId);
    }
    throw new ApiError(401, 'BAD_LOGIN', '名前かパスワードがちがいます。忘れたときは受付で聞いてね');
  });

  route('POST', '/logout', async ({ body }) => {
    const p = await auth(body);
    await forfeitPending(p.id, 'logout');
    await releaseLock(p.id);
    return { ok: true };
  });

  route('POST', '/heartbeat', async ({ body }) => ({ ok: true, player: playerView(await auth(body)) }));

  route('POST', '/profile', async ({ body }) => {
    const p = await auth(body);
    if (body.easyMode !== undefined) await db.run('UPDATE players SET easy_mode = ? WHERE id = ?', body.easyMode ? 1 : 0, p.id);
    return { player: playerView(await getPlayer(p.id)) };
  });

  route('POST', '/round/start', async ({ body }) => {
    const p = await auth(body);
    const { game } = body;
    const gameCfg = cfg.games[game];
    if (!gameCfg || !gameCfg.enabled) throw new ApiError(400, 'BAD_GAME', 'そのゲームは遊べません');
    await forfeitPending(p.id, 'restart');
    const cur = await getPlayer(p.id);
    const bet = Math.floor(Number(body.bet));
    const leverage = p.easy_mode ? 1 : Math.floor(Number(body.leverage));
    const range = betRange(cur.chips, cfg.chips.minBet);
    if (cur.chips <= 0) throw new ApiError(400, 'NO_CHIPS', 'チップがありません');
    if (!Number.isFinite(bet) || bet < range.min || bet > range.max) {
      throw new ApiError(400, 'BAD_BET', `賭けチップは${range.min}〜${range.max}の範囲で選んでください`);
    }
    if (!cfg.chips.leverages.includes(leverage)) throw new ApiError(400, 'BAD_LEVERAGE', 'レバレッジが不正です');
    const roundId = randomHex(8);
    await db.run('INSERT INTO rounds (id, player_id, game, bet, leverage, terminal, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      roundId, p.id, game, bet, leverage, p.active_session, now());
    return { roundId, bet, leverage, chips: cur.chips };
  });

  route('POST', '/round/finish', async ({ body }) => {
    const p = await auth(body);
    const { roundId, result } = body;
    const r = await db.get('SELECT * FROM rounds WHERE id = ?', String(roundId ?? ''));
    if (!r || r.player_id !== p.id) throw new ApiError(404, 'NO_ROUND', 'このゲームは既に終了しています');
    const outcome = resolveOutcome(r.game, cfg.games[r.game], result, r.bet);
    const cur = await getPlayer(p.id);
    const delta = computeDelta({ bet: r.bet, leverage: r.leverage, multiplier: outcome.multiplier, raw: outcome.raw, chips: cur.chips });
    const out = await applyDelta(p.id, {
      game: r.game, delta, bet: r.bet, leverage: r.leverage, multiplier: outcome.multiplier,
      detail: { result, label: outcome.label }, terminal: r.terminal, countLosscut: true,
      extra: [['DELETE FROM rounds WHERE id = ?', [r.id]]],
    });
    return {
      delta: out.delta, multiplier: outcome.multiplier, label: outcome.label, bet: r.bet, leverage: r.leverage,
      losscut: out.player.chips <= 0, player: playerView(out.player),
    };
  });

  route('POST', '/round/abort', async ({ body }) => {
    const p = await auth(body);
    const out = await forfeitPending(p.id, body.reason === 'idle' ? 'idle' : 'abort');
    const cur = await getPlayer(p.id);
    return { delta: out ? out.delta : 0, losscut: cur.chips <= 0, player: playerView(cur) };
  });

  // チップを全部失ったら、最初のチップからやり直す（最高記録はそのまま残る）
  route('POST', '/restart', async ({ body }) => {
    const p = await auth(body);
    if (p.chips > 0) throw new ApiError(400, 'NOT_ZERO', 'チップが残っているのでやり直しはできません');
    const out = await applyDelta(p.id, { game: 'restart', delta: cfg.chips.initial, terminal: p.active_session });
    return { player: playerView(out.player) };
  });

  route('GET', '/ranking', async ({ joinUrl }) => {
    const ranking = await db.all(`SELECT nickname, peak_chips, chips, losscut_count FROM players
      WHERE nickname IS NOT NULL ORDER BY peak_chips DESC, created_at ASC LIMIT ?`, cfg.ranking.limit);
    const recentBig = await db.all(`SELECT p.nickname, t.game, t.delta, t.leverage, t.created_at FROM transactions t
      JOIN players p ON p.id = t.player_id
      WHERE t.bet IS NOT NULL AND t.reverted_by IS NULL AND p.nickname IS NOT NULL AND t.delta >= ?
      ORDER BY t.id DESC LIMIT 8`, cfg.chips.initial);
    const stats = await db.get(`SELECT
      (SELECT COUNT(*) FROM players WHERE nickname IS NOT NULL) AS players,
      (SELECT COUNT(*) FROM transactions WHERE bet IS NOT NULL) AS plays,
      (SELECT COALESCE(SUM(losscut_count),0) FROM players) AS losscuts`);
    return {
      joinUrl: joinUrl || null,
      ranking: ranking.map((r, i) => ({ rank: i + 1, nickname: r.nickname, peakChips: r.peak_chips, chips: r.chips, losscutCount: r.losscut_count })),
      recentBig: recentBig.map((r) => ({ nickname: r.nickname, game: cfg.games[r.game]?.name || r.game, delta: r.delta, leverage: r.leverage, at: r.created_at })),
      stats,
    };
  });

  // ---------- 管理API ----------
  route('POST', '/admin/login', async ({ body }) => {
    if (!adminPassword) throw new ApiError(403, 'ADMIN_DISABLED', '管理画面のパスワードが設定されていません（README参照）');
    const pw = String(body?.password ?? '');
    if (pw !== String(adminPassword)) throw new ApiError(401, 'BAD_PASSWORD', 'パスワードが違います');
    const token = randomHex(16);
    await db.batch([
      ['DELETE FROM admin_sessions WHERE expires_at < ?', [now()]],
      ['INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)', [token, now() + cfg.admin.sessionHours * 3600e3]],
    ]);
    return { token };
  });

  const adminRoute = (method, pattern, fn) => route(method, `/admin${pattern}`, async (ctx) => {
    await checkAdmin(ctx.adminToken);
    return fn(ctx);
  });

  adminRoute('GET', '/players', async ({ query }) => {
    const q = String(query.get('q') || '').trim();
    const like = `%${q}%`;
    const rows = await db.all(`SELECT * FROM players WHERE (? = '' OR id LIKE ? OR nickname LIKE ? OR name_key LIKE ?)
      ORDER BY updated_at DESC LIMIT 200`, q, like, like, `%${nameKey(q)}%`);
    return { players: await Promise.all(rows.map(adminPlayerView)) };
  });

  adminRoute('GET', '/players/:id', async ({ params }) => {
    const p = await findPlayer(params.id);
    const txs = await db.all('SELECT * FROM transactions WHERE player_id = ? ORDER BY id DESC LIMIT 300', p.id);
    return { player: await adminPlayerView(p), transactions: txs };
  });

  adminRoute('POST', '/players/:id/chips', async ({ params, body }) => {
    const p = await findPlayer(params.id);
    const { kind, note } = body || {};
    const c = cfg.chips;
    let game, delta;
    if (kind === 'vr_bonus') {
      if (await countToday(p.id, 'vr_bonus') >= c.vrBonusPerDay) throw new ApiError(400, 'LIMIT', 'VRボーナスは本日付与済みです');
      game = 'vr_bonus';
      delta = c.vrBonus;
    } else if (kind === 'adjust') {
      delta = Math.trunc(Number(body.amount));
      if (!Number.isFinite(delta) || delta === 0) throw new ApiError(400, 'BAD_AMOUNT', '増減額を入力してください');
      game = 'admin_adjust';
    } else if (kind === 'set') {
      const target = Math.trunc(Number(body.amount));
      if (!Number.isFinite(target) || target < 0) throw new ApiError(400, 'BAD_AMOUNT', '0以上の値を入力してください');
      delta = target - p.chips;
      game = 'admin_set';
    } else {
      throw new ApiError(400, 'BAD_KIND', '種類が不正です');
    }
    const out = await applyDelta(p.id, { game, delta, detail: note ? { note: String(note).slice(0, 200) } : null, terminal: 'admin' });
    return { player: await adminPlayerView(out.player), delta: out.delta };
  });

  adminRoute('POST', '/players/:id/update', async ({ params, body }) => {
    const p = await findPlayer(params.id);
    const { nickname, peakChips, easyMode } = body || {};
    if (nickname !== undefined) {
      const v = validateNickname(cfg, nickname);
      if (!v.ok) throw new ApiError(400, 'BAD_NICKNAME', v.error);
      const others = (await allByName(nameKey(v.nickname))).filter((o) => o.id !== p.id);
      if (!cfg.account.allowDuplicateNames && others.length) throw new ApiError(409, 'NAME_TAKEN', 'その名前はほかの人が使っています');
      await db.run('UPDATE players SET nickname = ?, name_key = ? WHERE id = ?', v.nickname, nameKey(v.nickname), p.id);
    }
    if (peakChips !== undefined) {
      const v = Math.trunc(Number(peakChips));
      if (!Number.isFinite(v) || v < 0) throw new ApiError(400, 'BAD_PEAK', '最高チップが不正です');
      await db.run('UPDATE players SET peak_chips = ? WHERE id = ?', v, p.id);
    }
    if (easyMode !== undefined) await db.run('UPDATE players SET easy_mode = ? WHERE id = ?', easyMode ? 1 : 0, p.id);
    return { player: await adminPlayerView(await getPlayer(p.id)) };
  });

  // パスワードを忘れた人のために再設定
  adminRoute('POST', '/players/:id/password', async ({ params, body }) => {
    const p = await findPlayer(params.id);
    const pw = validatePassword(cfg, body?.password);
    if (!pw.ok) throw new ApiError(400, 'BAD_PASSWORD', pw.error);
    await db.run('UPDATE players SET password_hash = ? WHERE id = ?', await hashPassword(pw.password), p.id);
    return { player: await adminPlayerView(await getPlayer(p.id)) };
  });

  adminRoute('POST', '/players/:id/unlock', async ({ params }) => {
    const p = await findPlayer(params.id);
    await forfeitPending(p.id, 'admin_unlock');
    await releaseLock(p.id);
    return { player: await adminPlayerView(await getPlayer(p.id)) };
  });

  adminRoute('POST', '/transactions/:id/revert', async ({ params }) => {
    const t = await db.get('SELECT * FROM transactions WHERE id = ?', Number(params.id));
    if (!t) throw new ApiError(404, 'NOT_FOUND', '履歴が見つかりません');
    if (t.reverted_by) throw new ApiError(400, 'ALREADY', 'この履歴は取り消し済みです');
    if (t.game === 'admin_revert') throw new ApiError(400, 'BAD', '取り消し操作は取り消せません。調整を使ってください');
    const out = await applyDelta(t.player_id, { game: 'admin_revert', delta: -t.delta, detail: { revertOf: t.id }, terminal: 'admin' });
    await db.run('UPDATE transactions SET reverted_by = ? WHERE id = ?', out.txId, t.id);
    return { player: await adminPlayerView(out.player), delta: out.delta };
  });

  adminRoute('GET', '/transactions', async ({ query }) => {
    const limit = Math.min(Number(query.get('limit')) || 100, 1000);
    return { transactions: await db.all(`SELECT t.*, p.nickname FROM transactions t JOIN players p ON p.id = t.player_id
      ORDER BY t.id DESC LIMIT ?`, limit) };
  });

  adminRoute('GET', '/stats', async () => {
    const byGame = await db.all(`SELECT game, COUNT(*) AS plays, SUM(delta) AS net,
        SUM(CASE WHEN substr(created_at,1,10) = ? THEN 1 ELSE 0 END) AS today
      FROM transactions GROUP BY game ORDER BY plays DESC`, today());
    const totals = await db.get(`SELECT COUNT(*) AS players, SUM(nickname IS NOT NULL) AS registered,
      COALESCE(SUM(chips),0) AS chips, COALESCE(SUM(chips = 0),0) AS zero FROM players`);
    const active = (await db.all(`SELECT p.id, p.nickname, p.active_session, p.session_seen_at, r.game FROM players p
      LEFT JOIN rounds r ON r.player_id = p.id WHERE p.active_session IS NOT NULL`))
      .filter((r) => now() - r.session_seen_at < lockMs)
      .map((r) => ({ id: r.id, nickname: r.nickname, terminal: r.active_session, game: r.game || null }));
    return { totals, byGame, active };
  });

  // 全データをJSONで書き出す（バックアップ用。PC版・Cloudflare版共通）
  adminRoute('GET', '/export', async () => ({
    exportedAt: stamp(),
    players: await db.all('SELECT * FROM players ORDER BY created_at'),
    transactions: await db.all('SELECT * FROM transactions ORDER BY id'),
  }));

  adminRoute('POST', '/reset', async ({ body }) => {
    if (body?.confirm !== 'RESET') throw new ApiError(400, 'CONFIRM', '確認文字列が違います');
    await db.batch([
      ['DELETE FROM transactions', []],
      ['DELETE FROM players', []],
      ['DELETE FROM rounds', []],
      ["DELETE FROM sqlite_sequence WHERE name = 'transactions'", []],
    ]);
    return { ok: true };
  });

  // ---------- 入口 ----------
  // req: { method, path（/api より後ろ）, query: URLSearchParams, body, adminToken, joinUrl }
  async function handle(req) {
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(req.path);
        if (!m) continue;
        const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
        const json = await r.fn({ ...req, params, body: req.body || {} });
        return { status: 200, json };
      }
      return { status: 404, json: { error: 'NOT_FOUND', message: 'APIが見つかりません' } };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, json: { error: e.code, message: e.message } };
      if (e instanceof SettleError) return { status: 400, json: { error: 'BAD_RESULT', message: e.message } };
      console.error(e);
      return { status: 500, json: { error: 'INTERNAL', message: 'サーバーエラーが発生しました' } };
    }
  }

  return { handle, checkAdmin };
}
