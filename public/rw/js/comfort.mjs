// 拾径 · Wordloom — 舒适性与音频的纯计算
//
// 三个小能力都做成纯函数，便于单测：
//   · 防晕视野遮罩：滑翔过程中边缘渐暗，比例随行程先增后减
//   · 音量：0~1 钳制与百分比换算
//   · 座姿标定：根据头显当前眼高计算世界抬高量（坐着也能看到合适的节点高度）

/** 遮罩不透明度：0（起步）→ max（中途）→ 0（到达）。关闭时为 0。 */
export function vignetteOpacity(progress, enabled = true, max = 0.55) {
  if (!enabled) return 0;
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return Math.round(max * Math.sin(Math.PI * p) * 1000) / 1000;
}

/** 音量钳制到 [0,1]。 */
export function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.8;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/** 0..1 → 0..100 的滑杆值。 */
export function volumeToPercent(v) {
  return Math.round(clampVolume(v) * 100);
}

/**
 * 座姿偏移：坐姿眼高通常 1.1~1.3m，站立约 1.6m。
 * 返回需要把世界抬高多少（米），限制在 ±0.6m，避免极端值把场景顶飞。
 */
export function seatedOffset(headY, target = 1.6) {
  const h = Number(headY);
  if (!Number.isFinite(h) || h <= 0) return 0;
  const delta = target - h;
  return Math.round(Math.min(0.6, Math.max(-0.6, delta)) * 1000) / 1000;
}
