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
      el('div', '台をゆらす：プレイ中に', el('b', 'スペース'), el('br'), el('span.muted', '（ボールが止まったときに）')),
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
    const COLORS = { bumper: '#ff4fb8', sling: '#ff4d5e', post: '#4da3ff', target: '#f6c453', rollover: '#3ddc84', jackpot: '#ff8a3d', spinner: '#b57bff' };
    let lastTier = 'miss';
    function onEvent(e) {
      if (e.type === 'bumper' || e.type === 'post' || e.type === 'sling') { sound.bumper(); shake = Math.max(shake, e.type === 'bumper' ? 5 : 3); }
      else if (e.type === 'target' || e.type === 'rollover' || e.type === 'jackpot') sound.target();
      else if (e.type === 'bonus') { sound.win(); showBanner('BONUS!', `+${fmt(e.points)}`, 60); shake = 8; }
      else if (e.type === 'launch') sound.launch();
      else if (e.type === 'nudge') { sound.bumper(); shake = 10; if (e.manual) fx.push({ x: 272, y: 760, text: 'ゆらした！', life: 40, color: '#7fd3ff' }); }
      else if (e.type === 'rescue') { showBanner('RESCUE!', 'ボールを戻しました', 60, '#7fd3ff'); }
      if (e.type === 'jackpot') { showBanner('JACKPOT!', `+${fmt(e.points)}`, 60, '#ff8a3d'); shake = 10; }
      if (e.points && e.body) {
        fx.push({ x: e.body.position.x, y: e.body.position.y - 30, text: `+${e.points}`, life: 40, big: e.points >= 250 });
        burst(e.body.position.x, e.body.position.y, COLORS[e.type] || '#fff', e.points >= 250 ? 24 : 12);
      }
      // 倍率のランクが上がったら演出
      const tier = scoreFor(sim.score, cfg);
      if (tier !== lastTier && ['target', 'high', 'super'].indexOf(tier) > ['target', 'high', 'super'].indexOf(lastTier)) {
        lastTier = tier;
        showBanner(`${TIER_NAMES[tier]}！`, `倍率 ${multLabel(cfg.multipliers[tier])} × レバレッジ${leverage}`, 90, '#3ddc84');
        sound.bigWin();
        for (let k = 0; k < 4; k++) burst(100 + k * 110, 300, ['#f6c453', '#3ddc84', '#ff4fb8', '#4da3ff'][k], 30);
      }
    }

    function showBanner(text, sub, frames = 90, color) {
      banner = { text, sub, until: frameCount + frames, frames, color };
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
        else if (phase === 'play') sim.nudge();
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
      for (const pa of particles) { pa.x += pa.vx; pa.y += pa.vy; pa.vy += 0.15; pa.vx *= 0.97; pa.life--; }
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
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
    // 背景（盤面の模様）は一度だけ描いてキャッシュ
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = W;
    bgCanvas.height = H;
    (function paintBackground() {
      const b = bgCanvas.getContext('2d');
      b.save();
      b.beginPath();
      b.arc(300, 300, 290, Math.PI, 0);
      b.lineTo(590, H);
      b.lineTo(10, H);
      b.closePath();
      b.clip();
      const grd = b.createRadialGradient(272, 420, 40, 272, 420, 620);
      grd.addColorStop(0, '#3a1670');
      grd.addColorStop(0.45, '#1a0f45');
      grd.addColorStop(1, '#060818');
      b.fillStyle = grd;
      b.fillRect(0, 0, W, H);
      // 放射状の光線
      b.globalAlpha = 0.07;
      for (let i = 0; i < 24; i++) {
        const a1 = (i / 24) * Math.PI * 2;
        b.fillStyle = i % 2 ? '#ff4fb8' : '#4da3ff';
        b.beginPath();
        b.moveTo(272, 430);
        b.arc(272, 430, 700, a1, a1 + Math.PI / 24);
        b.closePath();
        b.fill();
      }
      // ひし形のタイル模様
      b.globalAlpha = 0.06;
      b.strokeStyle = '#ffffff';
      for (let y = -40; y < H + 40; y += 40) {
        for (let x = -40; x < W + 40; x += 40) {
          b.beginPath();
          b.moveTo(x, y - 20); b.lineTo(x + 20, y); b.lineTo(x, y + 20); b.lineTo(x - 20, y); b.closePath();
          b.stroke();
        }
      }
      // 星
      b.globalAlpha = 0.6;
      for (let i = 0; i < 70; i++) {
        b.fillStyle = ['#fff', '#ffd6f0', '#bfe3ff'][i % 3];
        b.beginPath();
        b.arc(Math.random() * W, Math.random() * H * 0.8, Math.random() * 1.4 + 0.3, 0, Math.PI * 2);
        b.fill();
      }
      // 中央のロゴ
      b.globalAlpha = 0.22;
      b.fillStyle = '#f6c453';
      b.textAlign = 'center';
      b.font = '900 70px sans-serif';
      b.fillText(`×${leverage}`, 272, 530);
      b.font = '900 20px sans-serif';
      b.fillText('L E V E R A G E', 272, 556);
      b.restore();
    })();

    const particles = [];
    const trail = [];
    let shake = 0;
    function burst(x, y, color, n = 14) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1.5 + Math.random() * 4;
        particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 25 + Math.random() * 15, color });
      }
    }

    function glowLine(x1, y1, x2, y2, color, width, blur) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.shadowBlur = 0;
    }

    function draw() {
      g.save();
      g.clearRect(0, 0, W, H);
      if (shake > 0) {
        g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        shake *= 0.85;
        if (shake < 0.3) shake = 0;
      }
      g.drawImage(bgCanvas, 0, 0);
      const t = frameCount;

      // ドームのチェイスライト
      for (let i = 0; i <= 30; i++) {
        const a = Math.PI + (Math.PI * i) / 30;
        const x = 300 + Math.cos(a) * 278, y = 300 + Math.sin(a) * 278;
        const on = (i + Math.floor(t / 4)) % 6 < 2;
        g.fillStyle = on ? '#fff3b0' : 'rgba(246,196,83,.25)';
        if (on) { g.shadowColor = '#f6c453'; g.shadowBlur = 12; }
        g.beginPath(); g.arc(x, y, on ? 3.5 : 2.5, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
      }

      // 矢印（点滅）
      for (let k = 0; k < 3; k++) {
        const on = Math.floor(t / 8) % 3 === k;
        g.fillStyle = on ? 'rgba(255,79,184,.9)' : 'rgba(255,255,255,.12)';
        const y = 690 - k * 26;
        g.beginPath(); g.moveTo(272, y); g.lineTo(256, y + 18); g.lineTo(288, y + 18); g.fill();
      }

      // 壁（ネオン）
      g.lineCap = 'round';
      for (const w of sim.parts.walls) {
        const [x1, y1, x2, y2] = w.render.line;
        glowLine(x1, y1, x2, y2, '#7fd3ff', Math.min(8, w.render.thick * 0.45), 10);
        g.strokeStyle = '#e8f6ff';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
      // 発射レーンのゲート
      if (!sim.parts.gate.isSensor) poly(sim.parts.gate.vertices, '#4da3ff');

      // スリングショット（三角の台座＋光るキッカー面）
      for (const sl of sim.parts.slings) {
        const lit = sim.flash.has(sl);
        const grd = g.createLinearGradient(sl.face.a.x, sl.face.a.y, sl.face.f.x, sl.face.f.y + 80);
        grd.addColorStop(0, lit ? '#ff9db0' : '#7a1430');
        grd.addColorStop(1, '#2a0612');
        g.fillStyle = grd;
        g.beginPath();
        sl.poly.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        g.closePath();
        g.fill();
        glowLine(sl.face.a.x, sl.face.a.y, sl.face.f.x, sl.face.f.y, lit ? '#ffffff' : '#ff4d5e', 7, lit ? 30 : 14);
      }

      // ロールオーバー
      for (const r of sim.parts.rollovers) {
        const lit = sim.rolloverLit[r.index];
        g.fillStyle = lit ? '#3ddc84' : (Math.floor(t / 20) % 3 === r.index ? 'rgba(61,220,132,.45)' : 'rgba(61,220,132,.18)');
        g.shadowColor = '#3ddc84'; g.shadowBlur = lit ? 20 : 0;
        g.beginPath(); g.arc(r.position.x, r.position.y, 10, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
      }
      // スピナー
      const sp = sim.parts.spinner;
      const spinLit = sim.flash.has(sp);
      glowLine(sp.position.x - 30, sp.position.y, sp.position.x + 30, sp.position.y, spinLit ? '#fff' : '#b57bff', 4, spinLit ? 20 : 8);
      g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '800 11px sans-serif'; g.textAlign = 'center';
      g.fillText('SPINNER', sp.position.x, sp.position.y - 9);

      // ターゲット・ジャックポット
      for (const tg of sim.parts.targets) {
        const lit = sim.targetLit[tg.index];
        g.shadowColor = '#f6c453'; g.shadowBlur = lit ? 18 : 0;
        poly(tg.vertices, lit ? '#ffe08a' : (sim.flash.has(tg) ? '#fff' : '#8a6510'));
        g.shadowBlur = 0;
      }
      const jp = sim.parts.jackpot;
      const jpOn = sim.flash.has(jp) || Math.floor(t / 15) % 2 === 0;
      g.shadowColor = '#ff8a3d'; g.shadowBlur = jpOn ? 18 : 4;
      poly(jp.vertices, sim.flash.has(jp) ? '#fff' : '#ff8a3d');
      g.shadowBlur = 0;
      g.save(); g.translate(jp.position.x - 16, jp.position.y); g.rotate(-Math.PI / 2);
      g.fillStyle = jpOn ? '#ffb27a' : '#a5582a'; g.font = '900 12px sans-serif'; g.textAlign = 'center'; g.fillText('JACKPOT', 0, 0); g.restore();

      // バンパー
      for (const bp of sim.parts.bumpers) {
        const lit = sim.flash.has(bp);
        const { x, y } = bp.position;
        g.fillStyle = 'rgba(0,0,0,.35)';
        g.beginPath(); g.arc(x + 3, y + 5, 30, 0, Math.PI * 2); g.fill();
        const grd = g.createRadialGradient(x - 8, y - 8, 3, x, y, 30);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.35, lit ? '#fff0fa' : '#ff9de0');
        grd.addColorStop(0.75, '#ff2fa8');
        grd.addColorStop(1, '#6a0c4a');
        g.fillStyle = grd;
        g.shadowColor = '#ff4fb8'; g.shadowBlur = lit ? 45 : 16;
        g.beginPath(); g.arc(x, y, 28, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
        g.strokeStyle = lit ? '#fff' : 'rgba(255,255,255,.6)';
        g.lineWidth = 3;
        g.beginPath(); g.arc(x, y, 20 + (lit ? 4 : 0), 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#3b0428'; g.font = '900 13px sans-serif'; g.textAlign = 'center'; g.fillText('100', x, y + 5);
      }
      for (const pt of sim.parts.posts) {
        const lit = sim.flash.has(pt);
        g.shadowColor = '#4da3ff'; g.shadowBlur = lit ? 25 : 10;
        g.fillStyle = lit ? '#fff' : '#4da3ff';
        g.beginPath(); g.arc(pt.position.x, pt.position.y, 11, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
      }

      // フリッパー
      for (const side of ['left', 'right']) {
        const f = sim.parts.flippers[side];
        g.shadowColor = '#f6c453'; g.shadowBlur = f.pressed ? 22 : 8;
        const v = f.body.vertices;
        const grd = g.createLinearGradient(v[0].x, v[0].y, v[Math.floor(v.length / 2)].x, v[Math.floor(v.length / 2)].y);
        grd.addColorStop(0, '#fff3c4');
        grd.addColorStop(1, '#e09b1a');
        poly(v, grd);
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
        const pg = g.createLinearGradient(0, 746, 0, 604);
        pg.addColorStop(0, '#3ddc84'); pg.addColorStop(0.6, '#f6c453'); pg.addColorStop(1, '#ff4d5e');
        g.fillStyle = pg;
        g.fillRect(LANE_WALL_X + 12, 746 - 142 * charge, 32, 142 * charge);
        g.fillStyle = '#fff'; g.font = '700 12px sans-serif'; g.textAlign = 'center';
        g.fillText('POWER', LANE_WALL_X + 28, 595);
      }

      // ボールの軌跡とボール
      if (sim.ball) {
        const { x, y } = sim.ball.position;
        trail.push({ x, y });
        if (trail.length > 10) trail.shift();
        trail.forEach((q, i) => {
          g.fillStyle = `rgba(160,220,255,${(i / trail.length) * 0.35})`;
          g.beginPath(); g.arc(q.x, q.y, BALL_R * (i / trail.length), 0, Math.PI * 2); g.fill();
        });
        const grd = g.createRadialGradient(x - 4, y - 4, 2, x, y, BALL_R);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.4, '#d7dde8');
        grd.addColorStop(1, '#6d7486');
        g.fillStyle = grd;
        g.shadowColor = '#bfe3ff'; g.shadowBlur = 12;
        g.beginPath(); g.arc(x, y, BALL_R, 0, Math.PI * 2); g.fill();
        g.shadowBlur = 0;
      } else trail.length = 0;

      // パーティクル
      for (const pa of particles) {
        g.globalAlpha = Math.max(0, pa.life / 40);
        g.fillStyle = pa.color;
        g.beginPath(); g.arc(pa.x, pa.y, 2.5, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;

      // 得点ポップアップ
      g.textAlign = 'center';
      for (const f of fx) {
        g.globalAlpha = Math.max(0, f.life / 40);
        g.fillStyle = f.color || '#fff';
        g.font = `900 ${f.big ? 26 : 18}px sans-serif`;
        g.shadowColor = '#000'; g.shadowBlur = 4;
        g.fillText(f.text, f.x, f.y);
        g.shadowBlur = 0;
      }
      g.globalAlpha = 1;

      // バナー
      if (banner && frameCount < banner.until) {
        const age = frameCount - (banner.until - banner.frames);
        const sc = Math.min(1, 0.4 + age / 10);
        g.save();
        g.translate(272, 470);
        g.scale(sc, sc);
        const bg = g.createLinearGradient(-262, 0, 262, 0);
        bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(0.15, 'rgba(20,0,40,.8)'); bg.addColorStop(0.85, 'rgba(20,0,40,.8)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = bg;
        g.fillRect(-262, -60, 524, 120);
        g.fillStyle = banner.color || '#f6c453'; g.font = '900 50px sans-serif';
        g.shadowColor = banner.color || '#f6c453'; g.shadowBlur = 20;
        g.fillText(banner.text, 0, 0);
        g.shadowBlur = 0;
        if (banner.sub) { g.fillStyle = '#fff'; g.font = '700 22px sans-serif'; g.fillText(banner.sub, 0, 38); }
        g.restore();
      }
      // 外枠
      g.strokeStyle = '#3b4560'; g.lineWidth = 4;
      g.beginPath(); g.arc(300, 300, 291, Math.PI, 0); g.lineTo(591, H); g.moveTo(9, H); g.lineTo(9, 300); g.stroke();
      g.restore();
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
