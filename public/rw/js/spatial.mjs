// 拾径 · Wordloom — 空间音效的纯合成层
//
// 为什么自己合成 PCM：
//   现有 2D 音效是 WebAudio 振荡器直连 destination，没有任何方位信息。
//   three.js 的 PositionalAudio 需要 AudioBuffer（PannerNode 只能接 buffer/media），
//   而仓库坚持「零音频素材」，所以这里用纯 JS 算出采样点，再在浏览器里装进 AudioBuffer。
//   顺带的好处：合成逻辑是纯函数，可以直接在 Node 里断言波形与包络。

const TAU = Math.PI * 2;

/** 四种波形的采样函数（相位 t ∈ [0,1)）。 */
const WAVES = {
  sine: (t) => Math.sin(TAU * t),
  square: (t) => (t < 0.5 ? 1 : -1),
  triangle: (t) => 4 * Math.abs(t - 0.5) - 1,
  sawtooth: (t) => 2 * t - 1,
};

/**
 * 合成一段带包络的音。
 * @returns {Float32Array} 采样数据（幅度已限制在 [-1,1]，首尾包络归零）
 */
export function renderTonePCM({
  freq = 880,
  duration = 0.12,
  sampleRate = 48000,
  type = 'sine',
  gain = 0.6,
  attack = 0.008,
  harmonics = 0,
} = {}) {
  const f = Number.isFinite(freq) && freq > 0 ? freq : 880;
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0.12;
  const sr = Number.isFinite(sampleRate) && sampleRate >= 8000 ? sampleRate : 48000;
  const g = Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 0.6;
  const wave = WAVES[type] || WAVES.sine;

  const n = Math.max(1, Math.round(d * sr));
  const out = new Float32Array(n);
  const atk = Math.max(1, Math.round(Math.min(attack, d / 2) * sr));

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const phase = (f * t) % 1;
    let v = wave(phase);
    // 轻微谐波让它更「润」，避免纯正弦过于电子味
    if (harmonics > 0) v += harmonics * wave((f * 2 * t) % 1) * 0.5;
    // 包络：线性起音 + 指数衰减
    const env = i < atk ? i / atk : Math.pow(1 - (i - atk) / Math.max(1, n - atk), 2.2);
    out[i] = Math.max(-1, Math.min(1, v * env * g));
  }
  // 首尾强制归零，避免爆音
  out[0] = 0;
  out[n - 1] = 0;
  return out;
}

/** 生成缓存键（相同参数复用同一个 AudioBuffer）。 */
export function toneKey(opts = {}) {
  const { freq = 880, duration = 0.12, type = 'sine', gain = 0.6, harmonics = 0 } = opts;
  return `${type}|${Math.round(freq)}|${Math.round(duration * 1000)}|${Math.round(gain * 100)}|${harmonics}`;
}

/**
 * 五声音阶 → 频率。走第 n 步时升一个音（和 2D 音效保持同一套音阶）。
 */
export const NOTE_PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
export function stepFreq(n) {
  const i = Number.isFinite(n) ? Math.abs(Math.trunc(n)) % NOTE_PENTA.length : 0;
  return NOTE_PENTA[i];
}

/** 计算节点相对听者的方位角（弧度）与距离，用于调试/测试断言。 */
export function bearing(listener, target) {
  if (!listener || !target) return { azimuth: 0, distance: 0 };
  const dx = target.x - listener.x;
  const dz = target.z - listener.z;
  const dy = (target.y ?? 0) - (listener.y ?? 0);
  return {
    azimuth: Math.atan2(dx, -dz),           // 0 = 正前方，向右为正
    distance: Math.hypot(dx, dy, dz),
  };
}
