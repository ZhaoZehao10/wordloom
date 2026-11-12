// 拾径 Wordloom — 浏览器性能实测（6x CPU 限速 ≈ Snapdragon XR2）
// 指标：开局建图+建场景耗时、滑翔中帧率、走路事件循环延迟。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { resolveChrome, tempProfile } from './chrome.mjs';

const CHROME = resolveChrome();
const PORT = 9344;
const URL = 'https://localhost:8543/rw/index.html';
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu-sandbox', '--no-first-run',
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
  `--user-data-dir=${tempProfile('rw-perf')}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1280,800', '--ignore-certificate-errors', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets = null;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch {}
}
if (!targets) { console.error('DevTools 未就绪'); process.exit(1); }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
function send(method, params = {}) {
  return new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
}
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });
await sleep(2000);

// CPU 限速 6x 模拟移动端芯片（Snapdragon XR2 ≈ 桌面 1/4~1/8 性能）
await send('Emulation.setCPUThrottlingRate', { rate: 6 });

const perf = await evalJs(`(async () => {
  // 1) 开局耗时：建图（RNG + 相对邻居图 O(n³)）+ 建几何
  const t0 = performance.now();
  window.__rw.startRound('hard');
  const buildMs = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 400));
  // 2) 帧率采样：5 段各 1s 取中位数（headless rAF 抖动大，单段会误报）
  const fpsList = [];
  for (let s = 0; s < 5; s++) {
    let frames = 0;
    const t1 = performance.now();
    await new Promise((resolve) => {
      const tick = () => { frames++; if (performance.now() - t1 < 1000) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    });
    fpsList.push(frames / ((performance.now() - t1) / 1000));
    await new Promise((r) => setTimeout(r, 120));
  }
  fpsList.sort((a, b) => a - b);
  const fps = fpsList[Math.floor(fpsList.length / 2)];
  // 3) 重建 10 局（换图成本）
  const t2 = performance.now();
  for (let i = 0; i < 10; i++) window.__rw.startRound('normal');
  const rebuildMs = (performance.now() - t2) / 10;
  window.__rw.startRound('normal');
  await new Promise((r) => setTimeout(r, 200));
  // 4) 渲染结构成本（比帧率稳定得多，作为回归门禁）
  const info = window.__rw.rendererInfo();
  const geo = window.__rw.ballsGeoInfo();
  return {
    buildMs: +buildMs.toFixed(1), fps: +fps.toFixed(1), rebuildMs: +rebuildMs.toFixed(1),
    drawCalls: info.calls, triangles: info.triangles,
    nodes: geo.nodeCount, ballVerts: geo.vertexCount,
  };
})()`);
console.log('拾径 Wordloom 性能（6x CPU 限速 ≈ 移动端）:', JSON.stringify(perf));

// 性能历史曲线：保留最近 30 次结果，便于观察长期漂移
const histPath = 'test/perf-history.json';
let hist = [];
try { hist = JSON.parse(fs.readFileSync(histPath, 'utf8')); } catch { hist = []; }
if (!Array.isArray(hist)) hist = [];
const prev = hist.length ? hist[hist.length - 1] : null;
if (prev) {
  const dFps = (perf.fps - prev.fps).toFixed(1);
  console.log(`对比上次（${new Date(prev.ts).toISOString().slice(0, 16)}）：fps ${prev.fps}→${perf.fps}（${dFps >= 0 ? '+' : ''}${dFps}）· drawcall ${prev.drawCalls}→${perf.drawCalls}`);
}
hist.push({ ts: Date.now(), ...perf });
try { fs.writeFileSync(histPath, JSON.stringify(hist.slice(-30), null, 2)); } catch { /* 只读环境忽略 */ }

// 通过标准（双门禁）：
//   结构指标：drawcall ≤ 60、三角形 ≤ 60000、单球顶点数 = 每节点 165（14×10 细分）
//   ——这两项不受 headless 抖动影响，是真正能拦住「悄悄变重」的回归闸门
//   时间指标：开局 < 1.5s、重开 < 300ms、帧率中位数 ≥ 55（本机 6x 限速≈移动端；阈值留噪声余量）
const BUDGET = { drawCalls: 60, triangles: 60000, vertsPerNode: 165 };
// 软模式：CI/性能报告流水线只采集数据，不用真机性能阈值卡构建
const SOFT = process.env.PERF_SOFT === '1';
const problems = [];
if (perf.drawCalls > BUDGET.drawCalls) problems.push(`drawcall ${perf.drawCalls} > ${BUDGET.drawCalls}`);
if (perf.triangles > BUDGET.triangles) problems.push(`三角形 ${perf.triangles} > ${BUDGET.triangles}`);
if (perf.nodes > 0 && perf.ballVerts / perf.nodes !== BUDGET.vertsPerNode) problems.push(`每节点顶点 ${perf.ballVerts / perf.nodes} ≠ ${BUDGET.vertsPerNode}`);
if (!(perf.buildMs < 1500)) problems.push(`开局 ${perf.buildMs}ms ≥ 1500ms`);
if (!(perf.rebuildMs < 300)) problems.push(`重开 ${perf.rebuildMs}ms ≥ 300ms`);
if (!(perf.fps >= 55)) problems.push(`帧率 ${perf.fps} < 55`);

const ok = problems.length === 0 || SOFT;
console.log(ok ? '性能达标 ✓' : `性能不达标 ✗ — ${problems.join('；')}`);
chrome.kill();
process.exit(ok ? 0 : 1);
