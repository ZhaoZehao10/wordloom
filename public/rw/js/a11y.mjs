// 拾径 · Wordloom — 可访问性：颜色对比度（WCAG 2.1）
//
// VR 里环境光不可控、镜片有眩光，配色对比度不够会直接影响可读性。
// 这里把 WCAG 相对亮度/对比度算法做成纯函数，对所有皮肤做自动审计，
// 并把阈值写进单元测试：以后换配色不会悄悄变得看不清。

/** 0xRRGGBB → [r,g,b]（0..1，sRGB）。 */
export function hexToRgb(hex) {
  const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB 通道 → 线性值。 */
function linearize(c) {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 相对亮度。 */
export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 两色对比度（1 ~ 21）。 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 审计一套皮肤。
 * 阈值：正文文字 ≥ 4.5（WCAG AA），大号目标/图形 ≥ 3，装饰细线 ≥ 1.5。
 */
export function auditSkin(skin) {
  const checks = [
    { pair: '词文字/背景', fg: skin.word, bg: skin.bg, min: 4.5, level: 'AA 正文' },
    { pair: '终点/背景', fg: skin.goal, bg: skin.bg, min: 3, level: 'AA 大图形' },
    { pair: '起点/背景', fg: skin.start, bg: skin.bg, min: 3, level: 'AA 大图形' },
    { pair: '墨线/背景', fg: skin.line, bg: skin.bg, min: 1.5, level: '装饰线' },
    { pair: '可走高亮/背景', fg: skin.halo, bg: skin.bg, min: 3, level: 'AA 大图形' },
  ];
  return checks.map((c) => {
    const ratio = contrastRatio(c.fg, c.bg);
    return {
      ...c,
      ratio: Math.round(ratio * 100) / 100,
      pass: ratio >= c.min,
    };
  });
}

/** 全部皮肤审计汇总：返回失败项列表（空 = 全通过）。 */
export function auditAllSkins(skins) {
  const failures = [];
  for (const [name, skin] of Object.entries(skins || {})) {
    for (const r of auditSkin(skin)) {
      if (!r.pass) failures.push({ skin: name, ...r });
    }
  }
  return failures;
}
