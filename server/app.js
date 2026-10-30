// Express アプリ本体（テストからも使えるように index.js と分離）
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { ROOT, publicConfig } from './config.js';
import { Store, tx } from './db.js';
import { nameKey, validatePassword, hashPassword, verifyPassword, LoginGuard } from './accounts.js';
import { validateNickname } from './ngwords.js';
import { resolveOutcome, computeDelta, betRange, SettleError } from '../public/js/lib/settle.js';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const rand = (n = 16) => crypto.randomBytes(n).toString('hex');

export function createApp(cfg, db, { now = () => Date.now() } = {}) {
  const store = new Store(db);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // 進行中のラウンド（サーバー再起動で消えるのは許容）
  const rounds = new Map(); // roundId -> round
  const pendingByPlayer = new Map(); // playerId -> roundId
  const adminTokens = new Map(); // token -> expiresAt
  const guard = new LoginGuard({ now });

  const lockMs = cfg.session.lockTimeoutSec * 1000;

  // ---------- 共通ヘルパー ----------
  const playerView = (p) => p && {
    id: p.id,
    nickname: p.nickname,
    chips: p.chips,
    peakChips: p.peak_chips,
    losscutCount: p.losscut_count,
    easyMode: !!p.easy_mode,
  };

  const releaseLock = db.prepare('UPDATE players SET active_session = NULL, session_token = NULL, session_seen_at = NULL WHERE id = ?');
  const takeLock = db.prepare('UPDATE players SET active_session = ?, session_token = ?, session_seen_at = ? WHERE id = ?');
  const touchLock = db.prepare('UPDATE players SET session_seen_at = ? WHERE id = ?');
  const playersOnTerminal = db.prepare('SELECT id FROM players WHERE active_session = ?');

  function isLockedByOther(p, terminal) {
    return p.active_session && p.active_session !== terminal && p.session_seen_at && now() - p.session_seen_at < lockMs;
  }

  // 途中放棄されたラウンドを「負け(-1)」として精算する
  function forfeitPending(playerId, reason) {
    const rid = pendingByPlayer.get(playerId);
    if (!rid) return null;
    const r = rounds.get(rid);
    pendingByPlayer.delete(playerId);
    rounds.delete(rid);
    if (!r) return null;
    const p = store.getPlayer(playerId);
    const delta = computeDelta({ bet: r.bet, leverage: r.leverage, multiplier: -1, chips: p.chips });
    return store.applyDelta(playerId, {
      game: r.game, delta, bet: r.bet, leverage: r.leverage, multiplier: -1,
      detail: { forfeit: reason }, terminal: r.terminal, countLosscut: true,
    });
  }

  // 端末からのリクエストの認証（playerId + token）
  function auth(req) {
    const { playerId, token } = req.body || {};
    const p = typeof playerId === 'string' ? store.getPlayer(playerId) : null;
    if (!p || !token || p.session_token !== token) {
      throw new ApiError(409, 'SESSION_LOST', 'セッションが切れました。もう一度ログインしてください');
    }
    touchLock.run(now(), p.id);
    return p;
  }

  const wrap = (fn) => (req, res) => {
    try {
      const out = fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (e) {
      if (e instanceof ApiError) return res.status(e.status).json({ error: e.code, message: e.message });
      if (e instanceof SettleError) return res.status(400).json({ error: 'BAD_RESULT', message: e.message });
      console.error(e);
      res.status(500).json({ error: 'INTERNAL', message: 'サーバーエラーが発生しました' });
    }
  };

  // ---------- 公開API ----------
  app.get('/api/config', wrap(() => publicConfig(cfg)));

  app.get('/api/health', wrap(() => ({ ok: true, time: new Date(now()).toISOString() })));

  function checkTerminal(terminalId) {
    if (typeof terminalId !== 'string' || !terminalId) throw new ApiError(400, 'BAD_TERMINAL', '端末IDがありません');
  }

  // ログイン状態にする（端末ロック・前の人の後始末）
  function startSession(p, terminalId) {
    if (isLockedByOther(p, terminalId)) {
      throw new ApiError(423, 'LOCKED', 'この名前は別の端末でプレイ中です。そちらを終了してからログインしてください');
    }
    // この端末に前の人が残っていたら解放
    for (const { id: other } of playersOnTerminal.all(terminalId)) {
      if (other !== p.id) {
        forfeitPending(other, 'replaced');
        releaseLock.run(other);
      }
    }
    // 自分の未精算ラウンド（別端末で放置など）も精算
    forfeitPending(p.id, 'relogin');
    const fresh = store.getPlayer(p.id);
    if (fresh.chips <= 0) {
      releaseLock.run(p.id);
      return { status: 'no_chips', player: playerView(fresh) };
    }
    const token = rand();
    takeLock.run(terminalId, token, now(), p.id);
    return { status: 'ok', token, player: playerView(store.getPlayer(p.id)) };
  }

  // 名前が使えるか（新規登録画面で入力中に確認）
  app.get('/api/name-check', wrap((req) => {
    const v = validateNickname(cfg, String(req.query.name ?? ''));
    if (!v.ok) return { ok: false, message: v.error };
    const same = store.allByName(nameKey(v.nickname)).length;
    if (same && !cfg.account.allowDuplicateNames) return { ok: false, message: 'この名前はすでに使われています' };
    if (same) return { ok: true, same: true, message: `同じ名前の人が${same}人います（パスワードで区別するので登録できます）` };
    return { ok: true, message: 'この名前は使えます' };
  }));

  app.post('/api/register', wrap((req) => {
    const { username, password, terminalId, easyMode } = req.body || {};
    checkTerminal(terminalId);
    const v = validateNickname(cfg, username);
    if (!v.ok) throw new ApiError(400, 'BAD_NAME', v.error);
    const pw = validatePassword(cfg, password);
    if (!pw.ok) throw new ApiError(400, 'BAD_PASSWORD', pw.error);
    const key = nameKey(v.nickname);
    const allowDup = !!cfg.account.allowDuplicateNames;
    if (allowDup) {
      // 同じ名前＋同じパスワードだとログインで区別できないので登録できない
      const wait = guard.blockedFor(key);
      if (wait) throw new ApiError(429, 'TOO_MANY', `${wait}秒待ってからもう一度試してね`);
      if (store.allByName(key).some((o) => verifyPassword(pw.password, o.password_hash))) {
        guard.fail(key);
        throw new ApiError(409, 'SAME_NAME_PASSWORD', '同じ名前で同じパスワードの人がいます。パスワードを変えてね');
      }
    }
    const p = store.createPlayer({
      id: 'U' + rand(5), nickname: v.nickname, nameKey: key, passwordHash: hashPassword(pw.password),
      easyMode: !!easyMode, initialChips: cfg.chips.initial, terminal: terminalId, unique: !allowDup,
    });
    if (!p) throw new ApiError(409, 'NAME_TAKEN', 'この名前はすでに使われています。別の名前にしてね');
    return startSession(p, terminalId);
  }));

  app.post('/api/login', wrap((req) => {
    const { username, password, terminalId } = req.body || {};
    checkTerminal(terminalId);
    const key = nameKey(username ?? '');
    const wait = guard.blockedFor(key);
    if (wait) throw new ApiError(429, 'TOO_MANY', `パスワードを何度も間違えたので、${wait}秒待ってからもう一度試してね`);
    // 同じ名前が複数いてもパスワードが合う人を探す
    const candidates = key ? store.allByName(key) : [];
    const p = candidates.find((o) => verifyPassword(String(password ?? ''), o.password_hash));
    if (!p) {
      if (candidates.length) guard.fail(key);
      throw new ApiError(401, 'BAD_LOGIN', '名前かパスワードがちがいます。忘れたときは受付で聞いてね');
    }
    guard.success(key);
    return startSession(p, terminalId);
  }));

  app.post('/api/logout', wrap((req) => {
    const p = auth(req);
    forfeitPending(p.id, 'logout');
    releaseLock.run(p.id);
    return { ok: true };
  }));

  app.post('/api/heartbeat', wrap((req) => {
    const p = auth(req);
    return { ok: true, player: playerView(p) };
  }));

  app.post('/api/profile', wrap((req) => {
    const p = auth(req);
    const { easyMode } = req.body;
    if (easyMode !== undefined) {
      db.prepare('UPDATE players SET easy_mode = ? WHERE id = ?').run(easyMode ? 1 : 0, p.id);
    }
    return { player: playerView(store.getPlayer(p.id)) };
  }));

  app.post('/api/round/start', wrap((req) => {
    const p = auth(req);
    const { game } = req.body;
    const gameCfg = cfg.games[game];
    if (!gameCfg || !gameCfg.enabled) throw new ApiError(400, 'BAD_GAME', 'そのゲームは遊べません');
    forfeitPending(p.id, 'restart');
    const cur = store.getPlayer(p.id);
    const bet = Math.floor(Number(req.body.bet));
    const leverage = p.easy_mode ? 1 : Math.floor(Number(req.body.leverage));
    const range = betRange(cur.chips, cfg.chips.minBet);
    if (cur.chips <= 0) throw new ApiError(400, 'NO_CHIPS', 'チップがありません');
    if (!Number.isFinite(bet) || bet < range.min || bet > range.max) {
      throw new ApiError(400, 'BAD_BET', `賭けチップは${range.min}〜${range.max}の範囲で選んでください`);
    }
    if (!cfg.chips.leverages.includes(leverage)) throw new ApiError(400, 'BAD_LEVERAGE', 'レバレッジが不正です');
    const roundId = rand(8);
    rounds.set(roundId, { id: roundId, playerId: p.id, game, bet, leverage, terminal: p.active_session, startedAt: now() });
    pendingByPlayer.set(p.id, roundId);
    return { roundId, bet, leverage, chips: cur.chips };
  }));

  app.post('/api/round/finish', wrap((req) => {
    const p = auth(req);
    const { roundId, result } = req.body;
    const r = rounds.get(roundId);
    if (!r || r.playerId !== p.id) throw new ApiError(404, 'NO_ROUND', 'このゲームは既に終了しています');
    const outcome = resolveOutcome(r.game, cfg.games[r.game], result, r.bet);
    rounds.delete(roundId);
    pendingByPlayer.delete(p.id);
    const cur = store.getPlayer(p.id);
    const delta = computeDelta({ bet: r.bet, leverage: r.leverage, multiplier: outcome.multiplier, raw: outcome.raw, chips: cur.chips });
    const out = store.applyDelta(p.id, {
      game: r.game, delta, bet: r.bet, leverage: r.leverage, multiplier: outcome.multiplier,
      detail: { result, label: outcome.label }, terminal: r.terminal, countLosscut: true,
    });
    if (out.player.chips <= 0) releaseLock.run(p.id);
    return {
      delta: out.delta,
      multiplier: outcome.multiplier,
      label: outcome.label,
      bet: r.bet,
      leverage: r.leverage,
      losscut: out.player.chips <= 0,
      player: playerView(out.player),
    };
  }));

  app.post('/api/round/abort', wrap((req) => {
    const p = auth(req);
    const out = forfeitPending(p.id, req.body.reason === 'idle' ? 'idle' : 'abort');
    const cur = store.getPlayer(p.id);
    if (cur.chips <= 0) releaseLock.run(p.id);
    return { delta: out ? out.delta : 0, losscut: cur.chips <= 0, player: playerView(cur) };
  }));

  const rankingStmt = db.prepare(`SELECT nickname, peak_chips, chips, losscut_count FROM players
    WHERE nickname IS NOT NULL ORDER BY peak_chips DESC, created_at ASC LIMIT ?`);
  const recentBigStmt = db.prepare(`SELECT p.nickname, t.game, t.delta, t.leverage, t.created_at FROM transactions t
    JOIN players p ON p.id = t.player_id
    WHERE t.bet IS NOT NULL AND t.reverted_by IS NULL AND p.nickname IS NOT NULL AND t.delta >= ?
    ORDER BY t.id DESC LIMIT 8`);
  const statsStmt = db.prepare(`SELECT
      (SELECT COUNT(*) FROM players WHERE nickname IS NOT NULL) AS players,
      (SELECT COUNT(*) FROM transactions WHERE bet IS NOT NULL) AS plays,
      (SELECT COALESCE(SUM(losscut_count),0) FROM players) AS losscuts`);

  // スマホから接続するためのURL（同じWi-Fi内のアドレス）
  function joinUrl() {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    const lan = ips.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) || ips[0];
    return lan ? `http://${lan}:${cfg.server.port}/` : null;
  }

  app.get('/api/ranking', wrap(() => ({
    joinUrl: joinUrl(),
    ranking: rankingStmt.all(cfg.ranking.limit).map((r, i) => ({
      rank: i + 1, nickname: r.nickname, peakChips: r.peak_chips, chips: r.chips, losscutCount: r.losscut_count,
    })),
    recentBig: recentBigStmt.all(cfg.chips.initial).map((r) => ({
      nickname: r.nickname, game: cfg.games[r.game]?.name || r.game, delta: r.delta, leverage: r.leverage, at: r.created_at,
    })),
    stats: statsStmt.get(),
  })));

  // ---------- 管理API ----------
  app.post('/api/admin/login', wrap((req) => {
    const pw = String(req.body?.password ?? '');
    const a = Buffer.from(pw);
    const b = Buffer.from(String(cfg.admin.password));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new ApiError(401, 'BAD_PASSWORD', 'パスワードが違います');
    const token = rand();
    adminTokens.set(token, now() + cfg.admin.sessionHours * 3600e3);
    return { token };
  }));

  const admin = express.Router();
  admin.use((req, res, next) => {
    const token = req.get('x-admin-token') || req.query.token;
    const exp = token && adminTokens.get(token);
    if (!exp || exp < now()) return res.status(401).json({ error: 'ADMIN_AUTH', message: '管理画面にログインしてください' });
    next();
  });

  const adminPlayerView = (p) => p && {
    ...playerView(p),
    activeSession: p.session_seen_at && now() - p.session_seen_at < lockMs ? p.active_session : null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    vrToday: store.countToday(p.id, 'vr_bonus'),
    reviveToday: store.countToday(p.id, 'revive'),
    pendingRound: pendingByPlayer.has(p.id) ? rounds.get(pendingByPlayer.get(p.id))?.game : null,
  };

  // 内部ID（U…）または登録名で探す
  function findPlayer(idOrName) {
    const q = String(idOrName ?? '').trim();
    if (q && store.getPlayer(q)) return store.getPlayer(q);
    const list = q ? store.allByName(nameKey(q)) : [];
    if (!list.length) throw new ApiError(404, 'NOT_FOUND', `「${q}」という名前は登録されていません`);
    if (list.length > 1) throw new ApiError(409, 'AMBIGUOUS', `「${q}」は${list.length}人います。一覧から選んでください`);
    return list[0];
  }

  admin.get('/players', wrap((req) => {
    const q = String(req.query.q || '').trim();
    const like = `%${q}%`;
    const rows = db.prepare(`SELECT * FROM players WHERE (? = '' OR id LIKE ? OR nickname LIKE ? OR name_key LIKE ?)
      ORDER BY updated_at DESC LIMIT 200`).all(q, like, like, `%${nameKey(q)}%`);
    return { players: rows.map(adminPlayerView) };
  }));

  admin.get('/players/:id', wrap((req) => {
    const p = findPlayer(req.params.id);
    const txs = db.prepare('SELECT * FROM transactions WHERE player_id = ? ORDER BY id DESC LIMIT 300').all(p.id);
    return { player: adminPlayerView(p), transactions: txs };
  }));

  admin.post('/players/:id/chips', wrap((req) => {
    const p = findPlayer(req.params.id);
    const { kind, note } = req.body || {};
    const c = cfg.chips;
    let game, delta;
    if (kind === 'vr_bonus') {
      if (store.countToday(p.id, 'vr_bonus') >= c.vrBonusPerDay) throw new ApiError(400, 'LIMIT', 'VRボーナスは本日付与済みです');
      game = 'vr_bonus';
      delta = c.vrBonus;
    } else if (kind === 'revive') {
      if (c.reviveOnlyWhenZero && p.chips > 0) throw new ApiError(400, 'NOT_ZERO', '復活はチップが0のときだけ使えます');
      if (store.countToday(p.id, 'revive') >= c.revivePerDay) throw new ApiError(400, 'LIMIT', '本日の復活は使用済みです');
      game = 'revive';
      delta = c.revive;
    } else if (kind === 'adjust') {
      delta = Math.trunc(Number(req.body.amount));
      if (!Number.isFinite(delta) || delta === 0) throw new ApiError(400, 'BAD_AMOUNT', '増減額を入力してください');
      game = 'admin_adjust';
    } else if (kind === 'set') {
      const target = Math.trunc(Number(req.body.amount));
      if (!Number.isFinite(target) || target < 0) throw new ApiError(400, 'BAD_AMOUNT', '0以上の値を入力してください');
      delta = target - p.chips;
      game = 'admin_set';
    } else {
      throw new ApiError(400, 'BAD_KIND', '種類が不正です');
    }
    const out = store.applyDelta(p.id, { game, delta, detail: note ? { note: String(note).slice(0, 200) } : null, terminal: 'admin' });
    return { player: adminPlayerView(out.player), delta: out.delta };
  }));

  admin.post('/players/:id/update', wrap((req) => {
    const p = findPlayer(req.params.id);
    const { nickname, peakChips, easyMode } = req.body || {};
    if (nickname !== undefined) {
      const v = validateNickname(cfg, nickname);
      if (!v.ok) throw new ApiError(400, 'BAD_NICKNAME', v.error);
      const other = store.getByName(nameKey(v.nickname));
      if (!cfg.account.allowDuplicateNames && other && other.id !== p.id) throw new ApiError(409, 'NAME_TAKEN', 'その名前はほかの人が使っています');
      db.prepare('UPDATE players SET nickname = ?, name_key = ? WHERE id = ?').run(v.nickname, nameKey(v.nickname), p.id);
    }
    if (peakChips !== undefined) {
      const v = Math.trunc(Number(peakChips));
      if (!Number.isFinite(v) || v < 0) throw new ApiError(400, 'BAD_PEAK', '最高チップが不正です');
      db.prepare('UPDATE players SET peak_chips = ? WHERE id = ?').run(v, p.id);
    }
    if (easyMode !== undefined) db.prepare('UPDATE players SET easy_mode = ? WHERE id = ?').run(easyMode ? 1 : 0, p.id);
    return { player: adminPlayerView(store.getPlayer(p.id)) };
  }));

  admin.post('/players/:id/unlock', wrap((req) => {
    const p = findPlayer(req.params.id);
    forfeitPending(p.id, 'admin_unlock');
    releaseLock.run(p.id);
    return { player: adminPlayerView(store.getPlayer(p.id)) };
  }));

  admin.post('/transactions/:id/revert', wrap((req) => {
    const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(req.params.id));
    if (!t) throw new ApiError(404, 'NOT_FOUND', '履歴が見つかりません');
    if (t.reverted_by) throw new ApiError(400, 'ALREADY', 'この履歴は取り消し済みです');
    if (t.game === 'admin_revert') throw new ApiError(400, 'BAD', '取り消し操作は取り消せません。調整を使ってください');
    const out = tx(db, () => {
      const r = store.applyDeltaNoTx(t.player_id, { game: 'admin_revert', delta: -t.delta, detail: { revertOf: t.id }, terminal: 'admin' });
      db.prepare('UPDATE transactions SET reverted_by = ? WHERE id = ?').run(r.txId, t.id);
      return r;
    });
    return { player: adminPlayerView(out.player), delta: out.delta };
  }));

  admin.get('/transactions', wrap((req) => {
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const rows = db.prepare(`SELECT t.*, p.nickname FROM transactions t JOIN players p ON p.id = t.player_id
      ORDER BY t.id DESC LIMIT ?`).all(limit);
    return { transactions: rows };
  }));

  admin.get('/stats', wrap(() => {
    const byGame = db.prepare(`SELECT game, COUNT(*) AS plays, SUM(delta) AS net,
        SUM(CASE WHEN substr(created_at,1,10) = date('now','localtime') THEN 1 ELSE 0 END) AS today
      FROM transactions GROUP BY game ORDER BY plays DESC`).all();
    const totals = db.prepare(`SELECT COUNT(*) AS players, SUM(nickname IS NOT NULL) AS registered,
      COALESCE(SUM(chips),0) AS chips, COALESCE(SUM(chips = 0),0) AS zero FROM players`).get();
    const active = db.prepare('SELECT id, nickname, active_session, session_seen_at FROM players WHERE active_session IS NOT NULL').all()
      .filter((r) => now() - r.session_seen_at < lockMs)
      .map((r) => ({ id: r.id, nickname: r.nickname, terminal: r.active_session, game: rounds.get(pendingByPlayer.get(r.id))?.game || null }));
    return { totals, byGame, active, dbFile: cfg.server.dbFile };
  }));

  function backupTo(dir, label = 'manual') {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date(now()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const file = path.join(dir, `casino-${stamp}-${label}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    return file;
  }
  app.locals.backupTo = backupTo;

  admin.post('/backup', wrap(() => {
    const file = backupTo(path.resolve(ROOT, cfg.server.backupDir));
    return { file };
  }));

  admin.get('/backup/download', (req, res) => {
    try {
      const tmpDir = path.resolve(ROOT, cfg.server.backupDir);
      const file = backupTo(tmpDir, 'download');
      res.download(file, path.basename(file));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'BACKUP_FAILED', message: String(e.message) });
    }
  });

  admin.post('/reset', wrap((req) => {
    if (req.body?.confirm !== 'RESET') throw new ApiError(400, 'CONFIRM', '確認文字列が違います');
    const file = backupTo(path.resolve(ROOT, cfg.server.backupDir), 'before-reset');
    tx(db, () => {
      db.exec('DELETE FROM transactions; DELETE FROM players; DELETE FROM sqlite_sequence WHERE name = \'transactions\';');
    });
    rounds.clear();
    pendingByPlayer.clear();
    return { ok: true, backup: file };
  }));

  // パスワードを忘れた人のために再設定
  admin.post('/players/:id/password', wrap((req) => {
    const p = findPlayer(req.params.id);
    const pw = validatePassword(cfg, req.body?.password);
    if (!pw.ok) throw new ApiError(400, 'BAD_PASSWORD', pw.error);
    db.prepare('UPDATE players SET password_hash = ? WHERE id = ?').run(hashPassword(pw.password), p.id);
    guard.success(p.name_key);
    return { player: adminPlayerView(store.getPlayer(p.id)) };
  }));

  app.use('/api/admin', admin);
  app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'APIが見つかりません' }));

  // ---------- 静的ファイル（外部CDNは使わない） ----------
  const pub = path.join(ROOT, 'public');
  app.use(express.static(pub, { extensions: ['html'] }));
  app.get('/ranking', (req, res) => res.sendFile(path.join(pub, 'ranking.html')));
  app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));

  return app;
}
