// ピンボールの物理と目標スコアの調整用シミュレーション
//   node scripts/pinball-sim.js [試行回数]
// 「ボールがフリッパー付近に来たら弾く」簡易ボットで30秒×3球を遊ばせ、スコア分布を表示する
import Matter from 'matter-js';
import { PinballSim, FLIPPER } from '../public/js/games/pinball-table.js';
import { loadConfig } from '../server/config.js';

const cfg = loadConfig().games.pinball;
const trials = Number(process.argv[2] || 40);

function playBall(sim, skill) {
  sim.serveBall();
  for (let f = 0; f < 30; f++) sim.step();
  sim.launch(0.6 + Math.random() * 0.4);
  let frames = 0;
  let launched = true;
  const maxFrames = cfg.secondsPerBall * 60;
  let holdL = 0, holdR = 0;
  while (frames < maxFrames) {
    const b = sim.ball;
    const p = b.position, v = b.velocity;
    // ボットの判断：フリッパー上方の範囲にボールが落ちてきたら弾く
    const near = (piv, side) => {
      const dx = (p.x - piv.x) * (side === 'left' ? 1 : -1);
      return dx > -10 && dx < FLIPPER.length + 10 && p.y > piv.y - 60 && p.y < piv.y + 40 && v.y > -2;
    };
    if (holdL > 0) holdL--; else sim.parts.flippers.left.pressed = false;
    if (holdR > 0) holdR--; else sim.parts.flippers.right.pressed = false;
    if (Math.random() < skill && near(FLIPPER.left, 'left') && !sim.parts.flippers.left.pressed) { sim.parts.flippers.left.pressed = true; holdL = 12; }
    if (Math.random() < skill && near(FLIPPER.right, 'right') && !sim.parts.flippers.right.pressed) { sim.parts.flippers.right.pressed = true; holdR = 12; }
    const r = sim.step();
    frames++;
    if (r === 'drain') return { drained: true, frames };
  }
  sim.removeBall();
  return { drained: false, frames, launched };
}

function percentile(arr, q) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * q)];
}

for (const skill of [0.0, 0.3, 0.6]) {
  const scores = [];
  let drains = 0, balls = 0, frames = 0;
  for (let t = 0; t < trials; t++) {
    const sim = new PinballSim(Matter);
    for (let b = 0; b < cfg.balls; b++) {
      const r = playBall(sim, skill);
      balls++;
      frames += r.frames;
      if (r.drained) drains++;
    }
    scores.push(sim.score);
  }
  const rate = (th) => (scores.filter((s) => s >= th).length / scores.length * 100).toFixed(0) + '%';
  console.log(`skill=${skill}: 平均 ${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)} / 中央値 ${percentile(scores, 0.5)} / 90% ${percentile(scores, 0.9)} / 最大 ${Math.max(...scores)}`);
  console.log(`  1球の平均生存 ${(frames / balls / 60).toFixed(1)}秒, ドレイン率 ${(drains / balls * 100).toFixed(0)}%`);
  console.log(`  目標(${cfg.targetScore})達成 ${rate(cfg.targetScore)} / 高得点(${cfg.highScore}) ${rate(cfg.highScore)} / 超高得点(${cfg.superScore}) ${rate(cfg.superScore)}`);
}
