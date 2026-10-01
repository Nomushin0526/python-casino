// レバレッジピンボール（3球・1球30秒）
/* global Matter */
import { el, clear, fmt, multLabel } from '../ui.js';
import { PinballSim, W, H, BALL_R, LANE_X, LANE_WALL_X, scoreFor } from './pinball-table.js';

const TIER_NAMES = { miss: '目標未達', target: '目標達成', high: '高得点', super: '超高得点' };
const BALL_SAVE_SEC = 3;
const AUTO_LAUNCH_SEC = 8;

export default {
  id: 'pinball',
  title: 'レバレッジピンボール',
  icon: '🎯',
  desc: '3球×30秒でハイスコアを狙え！ Z と / でフリッパー、スペースで発射。',
  payout: (cfg) => [
    [`${fmt(cfg.targetScore)}点未満`, cfg.multipliers.miss],
    [`${fmt(cfg.targetScore)}点〜`, cfg.multipliers.target],
    [`${fmt(cfg.highScore)}点〜`, cfg.multipliers.high],
    [`${fmt(cfg.superScore)}点〜`, cfg.multipliers.super],
  ],
  mount(root, ctx) {
    const { cfg, sound, leverage } = ctx;
    if (typeof Matter === 'undefined') {
      clear(root, el('div.panel', 'Matter.js が読み込めませんでした（vendor/matter.min.js を確認）'));
      return () => {};
    }
    let alive = true;
    const sim = new PinballSim(Matter, { onEvent });
    const fx = []; // 得点のポップアップ
    let ballNo = 0;
    let phase = 'ready'; // ready | play | between | over
    let ballTime = cfg.secondsPerBall;
    let launchedAt = 0;
    let readySince = 0;
    let charging = false;
    let charge = 0;
    let banner = null; // { text, sub, until }
    let frameCount = 0;

    // ---------- 画面 ----------
    const canvas = el('canvas');
    const g = canvas.getContext('2d');
    const scoreEl = el('div.num', { style: { fontSize: '56px', fontWeight: 900, color: 'var(--gold)', lineHeight: 1 } }, '0');
    const ballEl = el('div', { style: { fontSize: '22px' } });
    const timeEl = el('div.num', { style: { fontSize: '40px', fontWeight: 900 } });
    const tierBox = el('div.col', { style: { gap: '6px' } });
    const tiers = [
      ['super', cfg.superScore, cfg.multipliers.super],
      ['high', cfg.highScore, cfg.multipliers.high],
      ['target', cfg.targetScore, cfg.multipliers.target],
      ['miss', 0, cfg.multipliers.miss],
    ].map(([key, th, m]) => {
      const row = el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '8px 12px', borderRadius: '10px', background: 'rgba(255,255,255,.06)', fontSize: '17px' } },
        el('span', TIER_NAMES[key]), el('span.num', th ? `${fmt(th)}〜` : ''), el('b.num', `${multLabel(m)}×${leverage}`));
      row.dataset.key = key;
      tierBox.append(row);
      return row;
    });

    const hud = el('div.panel.col', { style: { width: '270px', gap: '14px' } },
      el('div.muted', 'SCORE'), scoreEl, ballEl,
      el('div.muted', 'この球の残り時間'), timeEl,
      el('div.muted', '結果（倍率×レバレッジ）'), tierBox);
    const help = el('div.panel.col', { style: { width: '230px', fontSize: '17px', gap: '10px' } },
      el('b', '操作'),
      el('div', '左フリッパー：', el('b', 'Z'), ' / ←', el('br'), el('span.muted', '（左クリックでもOK）')),
      el('div', '右フリッパー：', el('b', '/'), ' / →', el('br'), el('span.muted', '（右クリックでもOK）')),
      el('div', '発射：', el('b', 'スペース'), 'を長押しして離す'),
      el('div.muted', `${cfg.balls}球 × ${cfg.secondsPerBall}秒。発射後${BALL_SAVE_SEC}秒以内に落ちたら1回だけやり直し。`),
      el('div.muted', 'バンパー、上のレーン3つ、左のターゲット3つ、右のジャックポットで高得点！'));
    clear(root, el('div.row', { style: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'stretch', gap: '18px', minHeight: 0 } },
      hud, el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 } }, canvas), help));

    function resize() {
      const availH = root.clientHeight - 30;
      const availW = root.clientWidth - 270 - 230 - 80;
      const scale = Math.max(0.3, Math.min(availH / H, availW / W));
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = W * scale + 'px';
      canvas.style.height = H * scale + 'px';
      canvas.width = Math.round(W * scale * dpr);
      canvas.height = Math.round(H * scale * dpr);
      g.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    }
    window.addEventListener('resize', resize);
    requestAnimationFrame(resize);

    // ---------- イベント ----------
    function onEvent(e) {
      if (e.type === 'bumper' || e.type === 'post' || e.type === 'sling') sound.bumper();
      else if (e.type === 'target' || e.type === 'rollover' || e.type === 'jackpot') sound.target();
      else if (e.type === 'bonus') { sound.win(); showBanner('BONUS!', `+${fmt(e.points)}`, 60); }
      else if (e.type === 'launch') sound.launch();
      if (e.points && e.body) fx.push({ x: e.body.position.x, y: e.body.position.y - 30, text: `+${e.points}`, life: 40 });
    }

    function showBanner(text, sub, frames = 90) {
      banner = { text, sub, until: frameCount + frames };
    }

    function nextBall() {
      ballNo++;
      if (ballNo > cfg.balls) return gameOver();
      sim.serveBall();
      phase = 'ready';
      ballTime = cfg.secondsPerBall;
      readySince = frameCount;
      sim.ballSaveUsed = false;
      showBanner(`BALL ${ballNo}`, 'スペース長押しで発射', 70);
    }

    function endBall(reason) {
      phase = 'between';
      sim.removeBall();
      sim.parts.flippers.left.pressed = false;
      sim.parts.flippers.right.pressed = false;
      if (reason === 'drain') sound.drain();
      showBanner(reason === 'time' ? 'TIME UP!' : 'DRAIN…', `BALL ${ballNo} 終了`, 80);
      setTimeout(() => alive && nextBall(), 1500);
    }

    function gameOver() {
      phase = 'over';
      const tier = scoreFor(sim.score, cfg);
      showBanner('GAME OVER', `${fmt(sim.score)}点 → ${TIER_NAMES[tier]}`, 600);
      tier === 'miss' ? sound.lose() : sound.bigWin();
      setTimeout(() => alive && ctx.finish({ score: sim.score }), 2200);
    }

    function doLaunch() {
      if (phase !== 'ready') return;
      if (sim.launch(charge)) {
        phase = 'play';
        launchedAt = frameCount;
      }
      charging = false;
      charge = 0;
    }

    // ---------- 入力 ----------
    const has = (list, e) => list.includes(e.key) || list.includes(e.code);
    const setFlipper = (side, on) => {
      const f = sim.parts.flippers[side];
      if (on && !f.pressed && phase !== 'over') sound.flipper();
      f.pressed = on && phase !== 'over';
    };
    const onDown = (e) => {
      if (e.repeat) { if (has(cfg.leftKeys, e) || has(cfg.rightKeys, e) || has(cfg.launchKeys, e)) e.preventDefault(); return; }
      if (has(cfg.leftKeys, e)) { setFlipper('left', true); e.preventDefault(); }
      if (has(cfg.rightKeys, e)) { setFlipper('right', true); e.preventDefault(); }
      if (has(cfg.launchKeys, e)) {
        e.preventDefault();
        if (phase === 'ready') { charging = true; charge = 0; }
      }
    };
    const onUp = (e) => {
      if (has(cfg.leftKeys, e)) setFlipper('left', false);
      if (has(cfg.rightKeys, e)) setFlipper('right', false);
      if (has(cfg.launchKeys, e) && charging) doLaunch();
    };
    const onMouseDown = (e) => {
      if (phase === 'ready' && e.button === 0 && e.target === canvas && charging === false && !sim.parts.flippers.left.pressed) {
        // 発射待ちのときは左クリックでも発射できる（長押しで強く）
        charging = true;
        charge = 0;
        return;
      }
      if (e.button === 0) setFlipper('left', true);
      if (e.button === 2) setFlipper('right', true);
    };
    const onMouseUp = (e) => {
      if (e.button === 0) { setFlipper('left', false); if (charging) doLaunch(); }
      if (e.button === 2) setFlipper('right', false);
    };
    const onCtx = (e) => e.preventDefault();
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('contextmenu', onCtx);
    const onBlur = () => { setFlipper('left', false); setFlipper('right', false); };
    window.addEventListener('blur', onBlur);

    // ---------- ループ ----------
    let last = performance.now();
    let acc = 0;
    function tick(now) {
      if (!alive) return;
      acc += Math.min(100, now - last);
      last = now;
      while (acc >= 1000 / 60) {
        acc -= 1000 / 60;
        update();
      }
      draw();
      requestAnimationFrame(tick);
    }

    function update() {
      frameCount++;
      if (charging) charge = Math.min(1, charge + 1 / 50);
      if (phase === 'ready' && frameCount - readySince > AUTO_LAUNCH_SEC * 60) { charge = 0.7; charging = true; doLaunch(); }
      if (phase === 'ready' || phase === 'play') {
        const r = sim.step();
        if (phase === 'ready' && !sim.inLane) { phase = 'play'; launchedAt = frameCount; }
        // 発射が弱くてレーンに戻ってきたら再発射できるようにする
        if (phase === 'play' && sim.inLane && sim.ball && sim.ball.position.y > 830 && sim.ball.speed < 0.5) { phase = 'ready'; readySince = frameCount; }
        if (r === 'drain') {
          if (phase === 'play' && frameCount - launchedAt < BALL_SAVE_SEC * 60 && !sim.ballSaveUsed) {
            sim.ballSaveUsed = true;
            sim.serveBall();
            phase = 'ready';
            readySince = frameCount;
            showBanner('BALL SAVE!', 'もう一度発射してね', 70);
          } else {
            endBall('drain');
          }
        }
        if (phase === 'play') {
          ballTime -= 1 / 60;
          if (ballTime <= 0) {
            ballTime = 0;
            endBall('time');
          }
        }
      } else {
        // ボールがなくてもフリッパーは動かす
        sim.step();
      }
      for (const f of fx) { f.y -= 0.8; f.life--; }
      while (fx.length && fx[0].life <= 0) fx.shift();
      updateHud();
    }

    let lastScore = -1;
    function updateHud() {
      if (sim.score !== lastScore) {
        lastScore = sim.score;
        scoreEl.textContent = fmt(sim.score);
        const tier = scoreFor(sim.score, cfg);
        for (const row of tiers) {
          const on = row.dataset.key === tier;
          row.style.background = on ? (tier === 'miss' ? 'rgba(255,77,94,.35)' : 'rgba(246,196,83,.35)') : 'rgba(255,255,255,.06)';
          row.style.outline = on ? '2px solid ' + (tier === 'miss' ? 'var(--red)' : 'var(--gold)') : 'none';
        }
      }
      ballEl.textContent = `BALL ${Math.min(ballNo, cfg.balls)} / ${cfg.balls}`;
      timeEl.textContent = phase === 'play' || phase === 'ready' ? ballTime.toFixed(1) + '秒' : '—';
      timeEl.style.color = ballTime <= 5 && phase === 'play' ? 'var(--red)' : '';
    }

    // ---------- 描画 ----------
    function draw() {
      g.clearRect(0, 0, W, H);
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1a0f3d');
      bg.addColorStop(0.5, '#0d1b3d');
      bg.addColorStop(1, '#071022');
      g.fillStyle = bg;
      g.beginPath();
      g.arc(300, 300, 290, Math.PI, 0);
      g.lineTo(590, H);
      g.lineTo(10, H);
      g.closePath();
      g.fill();

      // プレイフィールドの模様
      g.save();
      g.clip();
      g.globalAlpha = 0.08;
      g.strokeStyle = '#7fd3ff';
      for (let y = 0; y < H; y += 30) { g.beginPath(); g.moveTo(10, y); g.lineTo(LANE_WALL_X, y); g.stroke(); }
      g.globalAlpha = 0.18;
      g.fillStyle = '#f6c453';
      g.font = '900 64px sans-serif';
      g.textAlign = 'center';
      g.fillText(`×${leverage}`, 272, 520);
      g.font = '900 22px sans-serif';
      g.fillText('LEVERAGE', 272, 548);
      g.restore();

      // 矢印（レーン方向の装飾）
      g.fillStyle = 'rgba(255,255,255,.12)';
      for (const [x, y] of [[272, 640], [272, 670]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x - 14, y + 18); g.lineTo(x + 14, y + 18); g.fill(); }

      // 壁
      g.lineCap = 'round';
      for (const w of sim.parts.walls) {
        const [x1, y1, x2, y2] = w.render.line;
        const lit = sim.flash.has(w);
        g.strokeStyle = w.label === 'sling' ? (lit ? '#fff' : '#ff4d5e') : '#b9c3dd';
        g.lineWidth = w.label === 'sling' ? 10 : Math.min(10, w.render.thick * 0.5);
        if (w.label === 'sling') { g.shadowColor = '#ff4d5e'; g.shadowBlur = lit ? 25 : 8; }
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        g.shadowBlur = 0;
      }
      // 発射レーンのゲート
      if (!sim.parts.gate.isSensor) poly(sim.parts.gate.vertices, '#4da3ff');

      // ロールオーバー
      for (const r of sim.parts.rollovers) {
        const lit = sim.rolloverLit[r.index];
        g.fillStyle = lit ? '#3ddc84' : 'rgba(61,220,132,.2)';
        g.shadowColor = '#3ddc84'; g.shadowBlur = lit ? 18 : 0;
        g.beginPath(); g.arc(r.position.x, r.position.y, 9, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
      }
      // スピナー
      const sp = sim.parts.spinner;
      g.strokeStyle = sim.flash.has(sp) ? '#fff' : 'rgba(255,255,255,.5)';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(sp.position.x - 30, sp.position.y); g.lineTo(sp.position.x + 30, sp.position.y); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.4)'; g.font = '700 11px sans-serif'; g.textAlign = 'center';
      g.fillText('SPINNER', sp.position.x, sp.position.y - 8);

      // ターゲット・ジャックポット
      for (const t of sim.parts.targets) poly(t.vertices, sim.targetLit[t.index] ? '#f6c453' : (sim.flash.has(t) ? '#fff' : '#7a5a10'));
      const jp = sim.parts.jackpot;
      poly(jp.vertices, sim.flash.has(jp) ? '#fff' : '#ff8a3d');
      g.save(); g.translate(jp.position.x - 16, jp.position.y); g.rotate(-Math.PI / 2);
      g.fillStyle = '#ff8a3d'; g.font = '900 12px sans-serif'; g.textAlign = 'center'; g.fillText('JACKPOT', 0, 0); g.restore();

      // バンパー・ポスト
      for (const b of sim.parts.bumpers) {
        const lit = sim.flash.has(b);
        const grd = g.createRadialGradient(b.position.x, b.position.y, 4, b.position.x, b.position.y, 28);
        grd.addColorStop(0, lit ? '#fff' : '#ffd6f0');
        grd.addColorStop(0.5, lit ? '#ff9de0' : '#ff4fb8');
        grd.addColorStop(1, '#7a1458');
        g.fillStyle = grd;
        g.shadowColor = '#ff4fb8'; g.shadowBlur = lit ? 35 : 12;
        g.beginPath(); g.arc(b.position.x, b.position.y, 28, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
        g.fillStyle = '#2b0420'; g.font = '900 13px sans-serif'; g.textAlign = 'center'; g.fillText('100', b.position.x, b.position.y + 5);
      }
      for (const p of sim.parts.posts) {
        g.fillStyle = sim.flash.has(p) ? '#fff' : '#4da3ff';
        g.beginPath(); g.arc(p.position.x, p.position.y, 11, 0, Math.PI * 2); g.fill();
      }

      // フリッパー
      for (const side of ['left', 'right']) {
        const f = sim.parts.flippers[side];
        g.shadowColor = '#f6c453'; g.shadowBlur = f.pressed ? 16 : 4;
        poly(f.body.vertices, '#f6c453');
        g.shadowBlur = 0;
        g.fillStyle = '#6b4708';
        g.beginPath(); g.arc(f.pivot.x, f.pivot.y, 5, 0, Math.PI * 2); g.fill();
      }

      // プランジャー
      const plTop = 870 + charge * 20;
      g.fillStyle = '#555c70';
      g.fillRect(LANE_X - 12, plTop, 24, H - plTop);
      g.strokeStyle = '#9aa3bb'; g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 6; i++) { const y = plTop + 4 + i * ((H - plTop) / 6); g.moveTo(LANE_X - 12, y); g.lineTo(LANE_X + 12, y + 4); }
      g.stroke();
      if (phase === 'ready') {
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(LANE_WALL_X + 8, 600, 40, 150);
        g.fillStyle = charge > 0.8 ? '#ff4d5e' : '#f6c453';
        g.fillRect(LANE_WALL_X + 12, 746 - 142 * charge, 32, 142 * charge);
        g.fillStyle = '#fff'; g.font = '700 12px sans-serif'; g.textAlign = 'center';
        g.fillText('POWER', LANE_WALL_X + 28, 595);
      }

      // ボール
      if (sim.ball) {
        const { x, y } = sim.ball.position;
        const grd = g.createRadialGradient(x - 4, y - 4, 2, x, y, BALL_R);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.4, '#d7dde8');
        grd.addColorStop(1, '#6d7486');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, BALL_R, 0, Math.PI * 2); g.fill();
      }

      // 得点ポップアップ
      g.textAlign = 'center';
      for (const f of fx) {
        g.globalAlpha = Math.max(0, f.life / 40);
        g.fillStyle = '#fff'; g.font = '900 18px sans-serif';
        g.fillText(f.text, f.x, f.y);
      }
      g.globalAlpha = 1;

      // バナー
      if (banner && frameCount < banner.until) {
        g.fillStyle = 'rgba(0,0,0,.55)';
        g.fillRect(10, 410, LANE_WALL_X - 10, 120);
        g.fillStyle = '#f6c453'; g.font = '900 48px sans-serif';
        g.fillText(banner.text, 272, 470);
        if (banner.sub) { g.fillStyle = '#fff'; g.font = '700 22px sans-serif'; g.fillText(banner.sub, 272, 508); }
      }
      // 外枠
      g.strokeStyle = '#3b4560'; g.lineWidth = 4;
      g.beginPath(); g.arc(300, 300, 291, Math.PI, 0); g.lineTo(591, H); g.moveTo(9, H); g.lineTo(9, 300); g.stroke();
    }

    function poly(verts, color) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) g.lineTo(verts[i].x, verts[i].y);
      g.closePath();
      g.fill();
    }

    nextBall();
    requestAnimationFrame((t) => { last = t; tick(t); });

    return () => {
      alive = false;
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', resize);
      Matter.Engine.clear(sim.engine);
    };
  },
};
