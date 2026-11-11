// 拾径 · Wordloom — 性能趋势报告
//
// 读取 test/perf-history.json（由 test/rw-perf.mjs 每次追加），
// 生成一个自包含的 HTML 报告：帧率/ drawcall 趋势 SVG + 明细表 + 与上次对比。
//
// 用法：node tools/perf-report.mjs [历史文件] [输出文件]
// 也导出 renderPerfReport(history) 供测试直接断言 HTML 内容。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 生成 SVG 折线图。values 为空时返回占位文本。 */
export function svgLine(values, { width = 520, height = 120, color = '#6cd0ff', min = 0, max = null } = {}) {
  const vals = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v));
  if (!vals.length) return '<text x="8" y="20" fill="#5f6a88" font-size="12">暂无数据</text>';
  const hi = max === null ? Math.max(...vals, min + 1) : max;
  const lo = min;
  const span = Math.max(1e-6, hi - lo);
  const stepX = vals.length > 1 ? width / (vals.length - 1) : 0;
  const pts = vals.map((v, i) => {
    const x = vals.length > 1 ? i * stepX : width / 2;
    const y = height - ((v - lo) / span) * (height - 10) - 5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}" />` +
    vals.map((v, i) => {
      const x = vals.length > 1 ? i * stepX : width / 2;
      const y = height - ((v - lo) / span) * (height - 10) - 5;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${color}" />`;
    }).join('');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 生成完整报告 HTML（纯函数，便于测试）。 */
export function renderPerfReport(history) {
  const list = (Array.isArray(history) ? history : []).filter((r) => r && Number.isFinite(r.fps));
  if (!list.length) {
    return '<!DOCTYPE html><html><body><p>暂无性能历史数据。</p></body></html>';
  }
  const latest = list[list.length - 1];
  const prev = list.length > 1 ? list[list.length - 2] : null;
  const best = Math.max(...list.map((r) => r.fps));
  const worst = Math.min(...list.map((r) => r.fps));
  const rows = list.map((r, i) => {
    const d = prev && i === list.length - 1 ? (r.fps - prev.fps) : null;
    return `<tr><td>${new Date(r.ts).toISOString().slice(0, 16).replace('T', ' ')}</td>` +
      `<td>${r.fps}</td><td>${r.drawCalls}</td><td>${r.triangles}</td><td>${r.buildMs}ms</td>` +
      `<td>${d === null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(1)}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>拾径 · 性能趋势</title>
<style>
 body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#0b1020;color:#dfe7ff;padding:24px}
 h1{font-size:20px;letter-spacing:2px} .card{background:rgba(20,27,51,.7);border:1px solid rgba(140,165,255,.2);border-radius:12px;padding:16px;margin:16px 0;max-width:760px}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
 table{width:100%;border-collapse:collapse;font-size:12px} th,td{padding:4px 8px;text-align:right;border-bottom:1px solid rgba(140,165,255,.12)}
 th:first-child,td:first-child{text-align:left}
 .k{color:#8b96b8;font-size:12px}
</style></head><body>
<h1>拾径 · 性能趋势</h1>
<div class="card"><span class="k">共 ${list.length} 次记录 · 最近一次 ${new Date(latest.ts).toISOString().slice(0, 16).replace('T', ' ')}</span>
<p>帧率 <b>${latest.fps}</b> fps（历史最佳 <b>${best}</b> / 最差 <b>${worst}</b>） · drawcall <b>${latest.drawCalls}</b> · 三角形 <b>${latest.triangles}</b> · 开局 <b>${latest.buildMs}ms</b>
${prev ? ` · 较上次帧率 <b>${(latest.fps - prev.fps >= 0 ? '+' : '') + (latest.fps - prev.fps).toFixed(1)}</b>` : ''}</p></div>
<div class="grid">
 <div class="card"><div class="k">帧率趋势</div><svg width="520" height="120">${svgLine(list.map((r) => r.fps), { color: '#6cd0ff' })}</svg></div>
 <div class="card"><div class="k">Drawcall 趋势</div><svg width="520" height="120">${svgLine(list.map((r) => r.drawCalls), { color: '#b18cff' })}</svg></div>
</div>
<div class="card"><table><thead><tr><th>时间</th><th>fps</th><th>drawcall</th><th>三角形</th><th>开局</th><th>Δfps</th></tr></thead><tbody>${rows}</tbody></table></div>
</body></html>`;
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('perf-report.mjs')) {
  const inFile = process.argv[2] || path.join(ROOT, 'test', 'perf-history.json');
  const outFile = process.argv[3] || path.join(ROOT, 'dist', 'perf-report.html');
  let history = [];
  try { history = JSON.parse(fs.readFileSync(inFile, 'utf8')); } catch { history = []; }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, renderPerfReport(history), 'utf8');
  console.log(`性能报告已生成: ${outFile}（${Array.isArray(history) ? history.length : 0} 条记录）`);
}
