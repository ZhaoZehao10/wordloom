// 拾径 · Wordloom — 每日榜柱状图的纯几何
//
// 只算矩形，不碰 DOM：输入 7 天的分数，输出每根柱子的位置/高度/比例。
// 便于单测边界（全 0、单日极高、空数组、负值）。

/**
 * @param {number[]} values 每天的分数（按时间正序）
 * @param {object} opts width/height/gap/minBar
 * @returns {{x:number,y:number,w:number,h:number,ratio:number}[]}
 */
export function barLayout(values, { width = 280, height = 48, gap = 6, minBar = 2 } = {}) {
  const vals = Array.isArray(values) ? values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0)) : [];
  const n = vals.length;
  if (!n) return [];
  const max = Math.max(1, ...vals);
  const barW = Math.max(1, (width - gap * (n - 1)) / n);
  return vals.map((v, i) => {
    const ratio = v / max;
    const h = Math.max(minBar, Math.round(ratio * height));
    return {
      x: Math.round(i * (barW + gap)),
      y: height - h,
      w: Math.round(barW),
      h,
      ratio: Math.round(ratio * 1000) / 1000,
    };
  });
}

/** 图表摘要：最高分、总分、有成绩的天数。 */
export function chartSummary(values) {
  const vals = Array.isArray(values) ? values.filter((v) => Number.isFinite(v)) : [];
  return {
    max: vals.length ? Math.max(...vals) : 0,
    total: vals.reduce((s, v) => s + v, 0),
    activeDays: vals.filter((v) => v > 0).length,
  };
}
