// ピンボール台の物理構造（Matter.js）。DOMに依存しないので Node でもシミュレーションできる
export const W = 600;
export const H = 900;
export const BALL_R = 11;
export const LANE_X = 567; // 発射レーンの中心
export const LANE_WALL_X = 540;
export const FIELD_R = 535; // プレイフィールド右端

export const FLIPPER = {
  length: 86,
  rootR: 13,
  tipR: 6,
  restAngle: 0.52, // 下がっている時の角度（左フリッパー基準、右は反転）
  upAngle: -0.48,
  speedUp: 0.30, // 1フレーム（1/60秒）あたりの回転量
  speedDown: 0.12,
  left: { x: 168, y: 792 },
  right: { x: 377, y: 792 },
};

// スリングショットの形（壁側の上端・キッカー面の下端・ガイド上の根元）
export const SLING = { top: 540, tipX: 118, tipY: 680, baseX: 140 };

export const STUCK_FRAMES = 120; // 2秒動かなければ救済
export const NUDGE_COOLDOWN = 90; // 台をゆらす のクールダウン（フレーム）

export const SCORE = {
  bumper: 100,
  sling: 30,
  post: 50,
  rollover: 100,
  rolloverAll: 1000,
  target: 250,
  targetAll: 1500,
  jackpot: 750,
  spinner: 20,
};

// 凸多角形でフリッパーを作る（ピボットを原点としたローカル座標）
function flipperVertices(dir) {
  const { length, rootR, tipR } = FLIPPER;
  const pts = [];
  const seg = 8;
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / seg; // 根元の半円（左側）
    pts.push({ x: Math.cos(a) * rootR, y: Math.sin(a) * rootR });
  }
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / seg; // 先端の半円（右側）
    pts.push({ x: length + Math.cos(a) * tipR, y: Math.sin(a) * tipR });
  }
  return dir < 0 ? pts.map((p) => ({ x: -p.x, y: p.y })).reverse() : pts;
}

function centroid(pts) {
  // 多角形の重心（Matter は重心を position にする）
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const cr = p.x * q.y - q.x * p.y;
    a += cr;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function buildTable(Matter) {
  const { Bodies, Body, Composite, Engine } = Matter;
  const engine = Engine.create({ enableSleeping: false });
  engine.gravity.y = 1.15;
  engine.positionIterations = 10;
  engine.velocityIterations = 8;
  const world = engine.world;
  const parts = { walls: [], bumpers: [], slings: [], posts: [], rollovers: [], targets: [], sensors: {} };

  const wallOpts = (extra = {}) => ({ isStatic: true, restitution: 0.35, friction: 0.02, label: 'wall', ...extra });

  // 線分を太い長方形の壁にする
  function seg(x1, y1, x2, y2, thick = 20, opts = {}) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const b = Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, len, thick, wallOpts(opts));
    Body.setAngle(b, Math.atan2(y2 - y1, x2 - x1));
    b.render = { line: [x1, y1, x2, y2], thick };
    parts.walls.push(b);
    return b;
  }

  // 外枠：左右の壁と上部のドーム
  const domeC = { x: 300, y: 300 }, domeR = 290;
  seg(10 - 10, 300, 10 - 10, H + 40, 20); // 左壁（内側 x=10）
  seg(W - 10 + 10, 300, W - 10 + 10, H + 40, 20); // 右壁（内側 x=590）
  const steps = 28;
  for (let i = 0; i < steps; i++) {
    const a1 = Math.PI + (Math.PI * i) / steps;
    const a2 = Math.PI + (Math.PI * (i + 1)) / steps;
    const r = domeR + 10;
    seg(domeC.x + Math.cos(a1) * r, domeC.y + Math.sin(a1) * r, domeC.x + Math.cos(a2) * r, domeC.y + Math.sin(a2) * r, 22);
  }
  // 発射レーンの仕切り
  seg(LANE_WALL_X, 250, LANE_WALL_X, H + 40, 10);
  // 発射レーン出口のゲート（ボールがフィールドに出たら閉じる）
  const gate = Bodies.rectangle((LANE_WALL_X + W - 10) / 2, 238, W - 10 - LANE_WALL_X, 8, wallOpts({ isSensor: true, label: 'gate' }));
  Body.setAngle(gate, -0.35);
  parts.gate = gate;
  // プランジャーの床
  seg(LANE_WALL_X + 5, 868, W - 10, 868, 12);

  // インレーンのガイド（左右）
  seg(10, 640, FLIPPER.left.x - 14, FLIPPER.left.y - 8, 14);
  seg(FIELD_R, 640, FLIPPER.right.x + 14, FLIPPER.right.y - 8, 14);

  // スリングショット：壁・ガイドとすき間なくつながった三角形の台座（ボールがはまる穴を作らない）
  // 上側の斜面（キッカー面）に当たると弾き返す
  const sling = (pts) => {
    const c = centroid(pts);
    // fromVertices は配列を並べ替えるのでコピーを渡す
    const b = Bodies.fromVertices(c.x, c.y, [pts.map((q) => ({ ...q }))], { isStatic: true, restitution: 0.5, friction: 0.02, label: 'sling' });
    const [a, f] = pts; // キッカー面 a→f
    const dx = f.x - a.x, dy = f.y - a.y, len = Math.hypot(dx, dy);
    // 面の法線（プレイフィールド側＝上向き）
    let nx = dy / len, ny = -dx / len;
    if (ny > 0) { nx = -nx; ny = -ny; }
    b.kick = { x: nx, y: ny };
    b.face = { a, f };
    b.poly = pts;
    parts.slings.push(b);
  };
  const L = SLING;
  sling([{ x: 10, y: L.top }, { x: L.tipX, y: L.tipY }, { x: L.baseX, y: 640 + (L.baseX - 10) }, { x: 10, y: 640 }]);
  const mx = (x) => 10 + FIELD_R - x; // 左右反転
  sling([{ x: FIELD_R, y: L.top }, { x: mx(L.tipX), y: L.tipY }, { x: mx(L.baseX), y: 640 + (L.baseX - 10) }, { x: FIELD_R, y: 640 }]);

  // ポップバンパー
  for (const [x, y] of [[190, 285], [350, 285], [270, 385]]) {
    const b = Bodies.circle(x, y, 28, { isStatic: true, restitution: 0.9, label: 'bumper' });
    parts.bumpers.push(b);
  }
  // ポスト
  for (const [x, y] of [[120, 540], [425, 540]]) {
    parts.posts.push(Bodies.circle(x, y, 11, { isStatic: true, restitution: 0.8, label: 'post' }));
  }

  // 上部のロールオーバーレーン（センサー）と仕切りポスト
  for (const x of [165, 235, 305, 375]) seg(x, 95, x, 150, 8);
  for (const [i, x] of [200, 270, 340].entries()) {
    const s = Bodies.rectangle(x, 125, 40, 30, { isStatic: true, isSensor: true, label: 'rollover' });
    s.index = i;
    parts.rollovers.push(s);
  }

  // 左側のスタンドアップターゲット
  for (const [i, y] of [440, 490, 540].entries()) {
    // 壁からの出っ張りはボール半径より小さく（上に乗って止まらないように）
    const t = Bodies.rectangle(10 + 4, y, 8, 34, { isStatic: true, restitution: 0.5, label: 'target' });
    t.index = i;
    parts.targets.push(t);
  }
  // 右側のジャックポット
  parts.jackpot = Bodies.rectangle(FIELD_R - 4, 470, 8, 44, { isStatic: true, restitution: 0.5, label: 'jackpot' });

  // スピナー（中央上部のセンサー）
  parts.spinner = Bodies.rectangle(270, 200, 60, 10, { isStatic: true, isSensor: true, label: 'spinner' });

  // ドレイン（下端のセンサー）
  parts.sensors.drain = Bodies.rectangle(W / 2, H + 30, W * 2, 40, { isStatic: true, isSensor: true, label: 'drain' });

  // フリッパー（static のまま角度と位置を毎ステップ更新して速度を与える）
  const makeFlipper = (side) => {
    const dir = side === 'left' ? 1 : -1;
    const local = flipperVertices(dir);
    const c = centroid(local);
    const pivot = FLIPPER[side];
    const body = Bodies.fromVertices(pivot.x + c.x, pivot.y + c.y, [local], {
      isStatic: true, restitution: 0.2, friction: 0.01, label: 'flipper',
    });
    // fromVertices は重心に移動するので、ピボットからの重心オフセットを保持
    const f = { side, dir, body, pivot, offset: c, angle: 0, pressed: false, local };
    setFlipperAngle(Matter, f, FLIPPER.restAngle, false);
    return f;
  };
  parts.flippers = { left: makeFlipper('left'), right: makeFlipper('right') };

  Composite.add(world, [
    ...parts.walls, gate, ...parts.slings, ...parts.bumpers, ...parts.posts, ...parts.rollovers, ...parts.targets,
    parts.jackpot, parts.spinner, parts.sensors.drain, parts.flippers.left.body, parts.flippers.right.body,
  ]);
  return { engine, world, parts };
}

// フリッパーの角度を設定（angle は左フリッパー基準。右は反転して適用）
export function setFlipperAngle(Matter, f, angle, updateVelocity = true) {
  const { Body } = Matter;
  const a = angle * f.dir;
  const cos = Math.cos(a), sin = Math.sin(a);
  const pos = { x: f.pivot.x + f.offset.x * cos - f.offset.y * sin, y: f.pivot.y + f.offset.x * sin + f.offset.y * cos };
  Body.setAngle(f.body, a, updateVelocity);
  Body.setPosition(f.body, pos, updateVelocity);
  f.angle = angle;
}

// 1サブステップ分フリッパーを動かす（frac: 1フレームに対する割合）
export function stepFlipper(Matter, f, frac) {
  const target = f.pressed ? FLIPPER.upAngle : FLIPPER.restAngle;
  const speed = (f.pressed ? FLIPPER.speedUp : FLIPPER.speedDown) * frac;
  let a = f.angle;
  if (a > target) a = Math.max(target, a - speed);
  else if (a < target) a = Math.min(target, a + speed);
  setFlipperAngle(Matter, f, a, true);
}

export function makeBall(Matter) {
  return Matter.Bodies.circle(LANE_X, 845, BALL_R, {
    restitution: 0.35, friction: 0.005, frictionAir: 0.0006, frictionStatic: 0, density: 0.004, label: 'ball',
  });
}

export function scoreFor(totalScore, cfg) {
  if (totalScore >= cfg.superScore) return 'super';
  if (totalScore >= cfg.highScore) return 'high';
  if (totalScore >= cfg.targetScore) return 'target';
  return 'miss';
}

// ゲーム進行（スコア・衝突・ボール管理）。描画と入力は別
export class PinballSim {
  constructor(Matter, { substeps = 4, onEvent = () => {} } = {}) {
    this.M = Matter;
    this.substeps = substeps;
    this.onEvent = onEvent;
    const t = buildTable(Matter);
    Object.assign(this, t);
    this.score = 0;
    this.ball = null;
    this.inLane = false;
    this.rolloverLit = [false, false, false];
    this.targetLit = [false, false, false];
    this.flash = new Map(); // body -> 残りフレーム（描画用）
    this.frame = 0;
    this.trail = []; // 直近の位置（引っかかり検出用）
    this.rescueCount = 0;
    this.lastNudgeFrame = -9999;
    Matter.Events.on(this.engine, 'collisionStart', (e) => this.onCollide(e));
  }

  add(points, what, body) {
    this.score += points;
    if (body) this.flash.set(body, 10);
    this.onEvent({ type: what, points, body });
  }

  serveBall() {
    const { Composite, Body } = this.M;
    if (this.ball) Composite.remove(this.world, this.ball);
    this.ball = makeBall(this.M);
    Composite.add(this.world, this.ball);
    this.inLane = true;
    this.parts.gate.isSensor = true;
    Body.setVelocity(this.ball, { x: 0, y: 0 });
    this.trail = [];
    this.rescueCount = 0;
  }

  // 「台をゆらす」：プレイヤー操作。止まりかけのボールを上に弾く（クールダウンあり）
  nudge() {
    if (!this.ball || this.inLane || this.frame - this.lastNudgeFrame < NUDGE_COOLDOWN) return false;
    this.lastNudgeFrame = this.frame;
    const v = this.ball.velocity;
    this.M.Body.setVelocity(this.ball, { x: v.x + (Math.random() - 0.5) * 4, y: Math.min(v.y, 0) - 6 });
    this.onEvent({ type: 'nudge', manual: true });
    return true;
  }

  // power: 0〜1
  launch(power) {
    if (!this.ball || !this.inLane || this.ball.position.y < 780) return false;
    this.M.Body.setVelocity(this.ball, { x: 0, y: -(23 + 8 * power) });
    this.onEvent({ type: 'launch' });
    return true;
  }

  removeBall() {
    if (this.ball) this.M.Composite.remove(this.world, this.ball);
    this.ball = null;
  }

  onCollide(e) {
    const { Body } = this.M;
    for (const pair of e.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      const ball = a.label === 'ball' ? a : b.label === 'ball' ? b : null;
      if (!ball) continue;
      const other = ball === a ? b : a;
      switch (other.label) {
        case 'bumper': {
          const dx = ball.position.x - other.position.x, dy = ball.position.y - other.position.y;
          const d = Math.hypot(dx, dy) || 1;
          Body.setVelocity(ball, { x: (dx / d) * 11, y: (dy / d) * 11 });
          this.add(SCORE.bumper, 'bumper', other);
          break;
        }
        case 'sling': {
          // キッカー面（上側の斜面）に当たったときだけ弾く
          const { a: fa, f: ff } = other.face;
          const ex = ff.x - fa.x, ey = ff.y - fa.y;
          const t = ((ball.position.x - fa.x) * ex + (ball.position.y - fa.y) * ey) / (ex * ex + ey * ey);
          const side = (ball.position.x - fa.x) * other.kick.x + (ball.position.y - fa.y) * other.kick.y;
          if (t > -0.05 && t < 1.05 && side > 0) {
            const sp = 7 + Math.random() * 3;
            Body.setVelocity(ball, { x: other.kick.x * sp + (Math.random() - 0.5) * 2, y: other.kick.y * sp - 2 + (Math.random() - 0.5) * 2 });
            this.add(SCORE.sling, 'sling', other);
          }
          break;
        }
        case 'post':
          this.add(SCORE.post, 'post', other);
          break;
        case 'rollover':
          if (!this.rolloverLit[other.index]) {
            this.rolloverLit[other.index] = true;
            this.add(SCORE.rollover, 'rollover', other);
            if (this.rolloverLit.every(Boolean)) {
              this.rolloverLit = [false, false, false];
              this.add(SCORE.rolloverAll, 'bonus', null);
            }
          }
          break;
        case 'target':
          if (!this.targetLit[other.index]) {
            this.targetLit[other.index] = true;
            this.add(SCORE.target, 'target', other);
            if (this.targetLit.every(Boolean)) {
              this.targetLit = [false, false, false];
              this.add(SCORE.targetAll, 'bonus', null);
            }
          } else {
            this.add(10, 'post', other);
          }
          break;
        case 'jackpot':
          this.add(SCORE.jackpot, 'jackpot', other);
          break;
        case 'spinner':
          this.add(SCORE.spinner * Math.min(10, Math.ceil(Math.abs(ball.velocity.y))), 'spinner', other);
          break;
        case 'drain':
          this.drained = true;
          break;
        default:
          break;
      }
    }
  }

  // 1フレーム（1/60秒）進める。ボールが落ちたら 'drain' を返す
  step() {
    const { Engine, Body } = this.M;
    const dt = 1000 / 60 / this.substeps;
    this.drained = false;
    for (let i = 0; i < this.substeps; i++) {
      stepFlipper(this.M, this.parts.flippers.left, 1 / this.substeps);
      stepFlipper(this.M, this.parts.flippers.right, 1 / this.substeps);
      Engine.update(this.engine, dt);
      if (this.ball) {
        // 速度の上限（すり抜け防止）
        const v = this.ball.velocity;
        const sp = Math.hypot(v.x, v.y);
        if (sp > 32) Body.setVelocity(this.ball, { x: (v.x / sp) * 32, y: (v.y / sp) * 32 });
      }
    }
    this.frame++;
    for (const [body, n] of this.flash) n <= 1 ? this.flash.delete(body) : this.flash.set(body, n - 1);
    const ball = this.ball;
    if (!ball) return null;
    const p = ball.position;
    // レーンから出たらゲートを閉じる
    if (this.inLane && p.x < LANE_WALL_X - BALL_R && p.y < 300) {
      this.inLane = false;
      this.parts.gate.isSensor = false;
    }
    // 万一ボールが場外に出たときの保険
    if (this.drained || p.y > H + 20 || p.x < -50 || p.x > W + 50 || p.y < -100 || Number.isNaN(p.x)) return 'drain';
    // 引っかかり対策：一定時間ほとんど動いていなければ弾き出す。
    // それでも抜けなければボールを中央に戻す（フリッパーで抱えている間は除く）
    const holding = ['left', 'right'].some((side) => {
      const f = this.parts.flippers[side];
      return f.pressed && Math.abs(p.x - f.pivot.x) < FLIPPER.length + 15 && Math.abs(p.y - f.pivot.y) < 50;
    });
    this.trail.push({ x: p.x, y: p.y });
    if (this.trail.length > STUCK_FRAMES) this.trail.shift();
    if (this.inLane || holding) {
      this.trail = [];
    } else if (this.trail.length === STUCK_FRAMES) {
      let maxD = 0;
      for (const q of this.trail) maxD = Math.max(maxD, Math.hypot(q.x - p.x, q.y - p.y));
      if (maxD < 10) {
        this.trail = [];
        if (++this.rescueCount >= 2) {
          Body.setPosition(ball, { x: 272, y: 470 });
          Body.setVelocity(ball, { x: (Math.random() - 0.5) * 4, y: 1 });
          this.rescueCount = 0;
          this.onEvent({ type: 'rescue' });
        } else {
          Body.setVelocity(ball, { x: p.x < 272 ? 5 : -5, y: -10 });
          this.onEvent({ type: 'nudge' });
        }
      }
    }
    return null;
  }
}
