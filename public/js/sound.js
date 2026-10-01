// 効果音（WebAudio で合成。音源ファイルは使わない）
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('casino.muted') === '1'; } catch { /* ignore */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { dur = 0.12, type = 'square', vol = 0.08, at = 0, slide = 0 } = {}) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.1, at = 0 } = {}) {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  const g = a.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g).connect(a.destination);
  src.start(a.currentTime + at);
}

export const sound = {
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem('casino.muted', muted ? '1' : '0'); } catch { /* ignore */ }
    return muted;
  },
  unlock() { ac(); },
  click() { tone(880, { dur: 0.05, vol: 0.05 }); },
  chip() { tone(1400, { dur: 0.06, type: 'triangle', vol: 0.08 }); tone(1900, { dur: 0.05, type: 'triangle', vol: 0.06, at: 0.04 }); },
  card() { noise({ dur: 0.08, vol: 0.06 }); },
  scan() { tone(1200, { dur: 0.08 }); tone(1600, { dur: 0.12, at: 0.09 }); },
  error() { tone(200, { dur: 0.25, type: 'sawtooth', vol: 0.06 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, { dur: 0.18, type: 'triangle', vol: 0.1, at: i * 0.1 })); },
  bigWin() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, { dur: 0.2, type: 'square', vol: 0.07, at: i * 0.09 }));
  },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, { dur: 0.25, type: 'triangle', vol: 0.1, at: i * 0.15 })); },
  losscut() {
    for (let i = 0; i < 6; i++) { tone(880, { dur: 0.18, type: 'sawtooth', vol: 0.07, at: i * 0.4 }); tone(660, { dur: 0.18, type: 'sawtooth', vol: 0.07, at: i * 0.4 + 0.2 }); }
    tone(400, { dur: 1.2, type: 'sawtooth', vol: 0.08, at: 2.4, slide: -350 });
  },
  flipper() { tone(180, { dur: 0.05, type: 'square', vol: 0.05 }); },
  bumper() { tone(600 + Math.random() * 300, { dur: 0.07, type: 'square', vol: 0.06 }); },
  target() { tone(1000, { dur: 0.08, type: 'triangle', vol: 0.08 }); tone(1500, { dur: 0.1, type: 'triangle', vol: 0.08, at: 0.06 }); },
  launch() { noise({ dur: 0.25, vol: 0.08 }); tone(200, { dur: 0.3, type: 'sawtooth', vol: 0.05, slide: 600 }); },
  drain() { tone(300, { dur: 0.6, type: 'sawtooth', vol: 0.07, slide: -250 }); },
  tick() { tone(1500, { dur: 0.03, vol: 0.04 }); },
};
