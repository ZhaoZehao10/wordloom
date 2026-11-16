// 拾径 · Wordloom — 动画曲线（纯函数）
//
// 成就解锁提示用：DOM 弹出缩放、VR 面板缩放与淡出。
// 纯函数便于单测与调参，不依赖 DOM/Three。

const clampUnit = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** 弹出缩放：0 → 0.6（起始）、0.45 处过冲到 1.12、1 处回到 1。 */
export function popScale(progress) {
  const t = clampUnit(progress);
  if (t < 0.45) return 0.6 + (1.12 - 0.6) * (t / 0.45);
  return 1.12 - 0.12 * ((t - 0.45) / 0.55);
}

/** 提示透明度：保持 hold 秒后，在 fade 秒内线性淡出。 */
export function toastAlpha(elapsed, hold = 3.0, fade = 1.2) {
  const e = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  if (e <= hold) return 1;
  return Math.max(0, 1 - (e - hold) / Math.max(0.0001, fade));
}

/** 平滑上浮位移（米）：随时间从 0 升到 rise。 */
export function toastRise(elapsed, rise = 0.05, total = 4.2) {
  const e = clampUnit((Number.isFinite(elapsed) ? elapsed : 0) / Math.max(0.0001, total));
  return rise * e;
}
