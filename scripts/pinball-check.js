// フリッパーと発射の基本動作チェック
import Matter from 'matter-js';
import { PinballSim, FLIPPER } from '../public/js/games/pinball-table.js';

const sim = new PinballSim(Matter);
// 1. 発射してフィールドに入るか
for (const power of [0, 0.5, 1]) {
  sim.serveBall();
  for (let f = 0; f < 30; f++) sim.step();
  sim.launch(power);
  let minY = 9999, entered = false;
  for (let f = 0; f < 240; f++) {
    sim.step();
    if (!sim.ball) break;
    minY = Math.min(minY, sim.ball.position.y);
    if (!sim.inLane) entered = true;
  }
  console.log(`launch power=${power}: 最高到達 y=${minY.toFixed(0)} フィールド進入=${entered}`);
}
// 2. 左フリッパーの上にボールを置いて弾く
for (const side of ['left', 'right']) {
  sim.serveBall();
  const piv = FLIPPER[side];
  const dir = side === 'left' ? 1 : -1;
  Matter.Body.setPosition(sim.ball, { x: piv.x + dir * 45, y: piv.y - 60 });
  Matter.Body.setVelocity(sim.ball, { x: 0, y: 0 });
  sim.inLane = false;
  // ボールがフリッパーに届くまで待つ
  for (let f = 0; f < 120 && sim.ball.position.y < piv.y - 28; f++) sim.step();
  const before = { ...sim.ball.position };
  sim.parts.flippers[side].pressed = true;
  let minY = 9999;
  for (let k = 0; k < 90; k++) { const r = sim.step(); if (r) break; minY = Math.min(minY, sim.ball.position.y); }
  sim.parts.flippers[side].pressed = false;
  for (let k = 0; k < 30; k++) sim.step();
  console.log(`${side} flipper: 乗った位置 (${before.x.toFixed(0)},${before.y.toFixed(0)}) → 最高到達 y=${minY.toFixed(0)}`);
}
console.log('score', sim.score);
