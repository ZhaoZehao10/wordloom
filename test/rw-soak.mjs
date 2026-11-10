// 拾径 · Wordloom — soak 稳定性测试
// 连续反复开局/走子/结算，观察 JS 堆增长与帧率漂移。
// 这类问题（纹理/几何未释放）在短测试里看不出来，跑几十局才会暴露。
//
// 通过标准（帧率门禁默认关闭，可用 SOAK_FPS_MIN 开启）：
//   · 热身后的堆增长 < 40 MB 且 < 60%
//   · 渲染结构（drawcall/三角形）在结束时与开始时同量级
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { resolveChrome, tempProfile } from './chrome.mjs';
import { trendSlope } from '../public/rw/js/chart.mjs';

const URL = 'https://localhost:8543/rw/index.html';
const ROUNDS = Number(process.env.SOAK_ROUNDS || 60);
const MAX_MS = Number(process.env.SOAK_MS || 90000);
// 帧率门禁默认关闭：CI 的软件渲染环境帧率不代表真机性能（性能由 rw-perf 单独把关）
const FPS_MIN = Number(process.env.SOAK_FPS_MIN || 0);
const PROFILE = tempProfile('rw-soak');

const chrome = spawn(resolveChrome(), [
  '--headless=new', '--disable-gpu-sandbox', '--no-first-run',
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
  '--enable-precise-memory-info', '--js-flags=--expose-gc',
  `--user-data-dir=${PROFILE}`, '--remote-debugging-port=0',
  '--window-size=1280,800', '--ignore-certificate-errors', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 端口交给 Chrome 自选，从 DevToolsActivePort 文件读回，避免撞上系统保留端口段
let port = 0;
for (let i = 0; i < 60; i++) {
  await sleep(300);
  try {
    const p = `${PROFILE}/DevToolsActivePort`;
    if (fs.existsSync(p)) {
      const line = fs.readFileSync(p, 'utf8').split('\n')[0].trim();
      if (line) { port = Number(line); break; }
    }
  } catch { /* retry */ }
}
if (!port) { console.error('DevTools 端口未就绪'); chrome.kill(); process.exit(1); }
console.log(`DevTools 端口: ${port}`);

let targets = null;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break; } catch {}
}
if (!targets) { console.error('DevTools 未就绪'); process.exit(1); }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });
await sleep(2500);

const result = await evalJs(`(async () => {
  const st = window.__rw.state;
  const mb = () => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0);
  const gc = () => { try { window.gc && window.gc(); } catch {} };

  // 走一小段路再结算，模拟真实游戏（会产生标签纹理等对象）
  const playRound = async (diff) => {
    window.__rw.startRound(diff);
    await new Promise((r) => setTimeout(r, 60));
    const adj = {};
    for (const [a, b] of st.graph.edges) (adj[a] ||= []).push(b), (adj[b] ||= []).push(a);
    let cur = st.at;
    for (let i = 0; i < 3; i++) {
      const next = (adj[cur] || [])[0];
      if (next === undefined) break;
      window.__rw.tryWalk(next);
      while (st.glide) await new Promise((r) => setTimeout(r, 30));
      cur = st.at;
    }
    window.__rw.endRound(false);
  };

  // 热身
  for (let i = 0; i < 5; i++) await playRound('easy');
  await new Promise((r) => setTimeout(r, 300));
  gc();
  const heapStart = mb();
  const infoStart = window.__rw.rendererInfo();

  // 主体循环（按轮数或时间上限）
  const t0 = performance.now();
  let rounds = 0;
  let frames = 0;
  let rafOn = true;
  const tick = () => { if (rafOn) { frames++; requestAnimationFrame(tick); } };
  requestAnimationFrame(tick);
  while (rounds < ${ROUNDS} && performance.now() - t0 < ${MAX_MS}) {
    await playRound(['easy', 'normal', 'hard'][rounds % 3]);
    rounds++;
  }
  const sampleSec = (performance.now() - t0) / 1000;
  rafOn = false;
  await new Promise((r) => setTimeout(r, 200));
  gc();
  await new Promise((r) => setTimeout(r, 200));
  const heapEnd = mb();
  const infoEnd = window.__rw.rendererInfo();

  return {
    rounds,
    seconds: +sampleSec.toFixed(1),
    fps: +(frames / sampleSec).toFixed(1),
    heapStartMB: +heapStart.toFixed(1),
    heapEndMB: +heapEnd.toFixed(1),
    heapGrowthMB: +(heapEnd - heapStart).toFixed(1),
    heapGrowthPct: heapStart > 0 ? +(((heapEnd - heapStart) / heapStart) * 100).toFixed(1) : 0,
    drawCalls: [infoStart.calls, infoEnd.calls],
    triangles: [infoStart.triangles, infoEnd.triangles],
  };
})()`);

console.log('soak 结果:', JSON.stringify(result));

// 内存趋势：最小二乘斜率（MB/局），比单点前后差值更能反映泄漏
const slope = trendSlope(result.heapSamples || []);
console.log('内存趋势斜率:', slope.toFixed(3), 'MB/局');
try { fs.writeFileSync('test/soak-trend.json', JSON.stringify({ ts: Date.now(), rounds: result.rounds, slope, samples: result.heapSamples || [] }, null, 2)); } catch {}

const problems = [];
if (result.heapSamples && result.heapSamples.length >= 3 && slope > 0.4) {
  problems.push(`内存趋势斜率 ${slope.toFixed(3)}MB/局 > 0.4`);
}
if (result.heapGrowthMB > 40) problems.push(`堆增长 ${result.heapGrowthMB}MB > 40MB`);
if (result.heapGrowthPct > 60) problems.push(`堆增长 ${result.heapGrowthPct}% > 60%`);
if (FPS_MIN > 0 && result.fps < FPS_MIN) problems.push(`帧率 ${result.fps} < ${FPS_MIN}（SOAK_FPS_MIN 设置）`);
if (result.drawCalls[1] > result.drawCalls[0] * 2 + 10) problems.push(`drawcall 从 ${result.drawCalls[0]} 涨到 ${result.drawCalls[1]}`);
if (errors.length) problems.push(`运行期异常 ${errors.length} 条`);

const ok = problems.length === 0;
console.log(ok ? '稳定性达标 ✓' : `稳定性不达标 ✗ — ${problems.join('；')}`);
chrome.kill();
process.exit(ok ? 0 : 1);
