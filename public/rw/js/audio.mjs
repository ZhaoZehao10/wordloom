// 随机游走 VR — 程序化音效（WebAudio 合成，零音频文件）
// 事件：开局 / 走一步 / 收一词 / 胜 / 负 / 菜单 / 彩蛋。换音色 = 换乐器。
// 音色定义来自 data.mjs（step/collect/ui 三类振荡器参数）。

import { TIMBRES } from './data.mjs';

let ctx = null;
let timbreKey = 'wood';
let muted = false;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', gain = 0.12, delay = 0, slide = 0 } = {}) {
  if (muted) return;
  try {
    const a = ac();
    const t0 = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  } catch { /* 无音频设备时静默 */ }
}

const inst = () => (TIMBRES[timbreKey] || TIMBRES.wood);

// 音阶：五声音阶（宫商角徵羽），走一步升一个音，连续行走形成旋律感
const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

export const audio = {
  unlock() { try { ac(); } catch { /* ignore */ } },
  setTimbre(k) { timbreKey = k; },
  get timbre() { return timbreKey; },
  setMuted(m) { muted = m; },
  get muted() { return muted; },
};

export const sfx = {
  start() { tone(392, 0.18, inst().ui); tone(523.25, 0.22, { ...inst().ui, delay: 0.12 }); },
  step(n) { tone(PENTA[n % PENTA.length], 0.09, inst().step); },
  collect(wordLen) {
    const f = PENTA[(wordLen + 2) % PENTA.length] * 2;
    tone(f, 0.12, inst().collect);
    tone(f * 1.5, 0.14, { ...inst().collect, delay: 0.06 });
  },
  win()  { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { gain: 0.12, delay: i * 0.13 })); },
  fail() { tone(330, 0.25, { gain: 0.1 }); tone(262, 0.35, { gain: 0.1, delay: 0.18 }); },
  ui()   { tone(880, 0.05, inst().ui); },
  egg()  { [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.16, { gain: 0.1, delay: i * 0.09 })); },
};
