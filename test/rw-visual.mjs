// 拾径 · Wordloom — 视觉回归测试
// 在固定种子 + 冻结动画的确定性状态下截三张图（引导页 / 游戏中 / 结算页），
// 与 test/baselines/ 下的基线做像素对比。浏览器负责解码 PNG，无需第三方依赖。
//
// 用法：
//   node test/rw-visual.mjs           比对基线（差异 > 2% 判失败）
//   node test/rw-visual.mjs --update  重新生成基线
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChrome, tempProfile } from './chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_DIR = path.join(ROOT, 'test', 'baselines');
const URL = 'https://localhost:8543/rw/index.html';
const UPDATE = process.argv.includes('--update');
const THRESHOLD_PCT = 2;

const PROFILE = tempProfile('rw-visual');
const chrome = spawn(resolveChrome(), [
  '--headless=new', '--disable-gpu-sandbox', '--no-first-run',
  `--user-data-dir=${PROFILE}`, '--remote-debugging-port=0',
  '--window-size=1280,800', '--ignore-certificate-errors', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let port = 0;
for (let i = 0; i < 60; i++) {
  await sleep(300);
  const p = `${PROFILE}/DevToolsActivePort`;
  if (fs.existsSync(p)) { const line = fs.readFileSync(p, 'utf8').split('\n')[0].trim(); if (line) { port = Number(line); break; } }
}
if (!port) { console.error('DevTools 端口未就绪'); chrome.kill(); process.exit(1); }

let targets = null;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break; } catch {}
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });
await sleep(2200);
// 关掉新手引导，保证截图稳定
await evalJs(`localStorage.setItem('rw-tutorial-done','1'); localStorage.setItem('rw-lang','zh'); localStorage.setItem('rw-diff','normal'); true`);
await send('Page.reload');
await sleep(2400);

const shots = [];
const shoot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  shots.push({ name, b64: s.result.data });
};

// 1) 引导页
await evalJs(`window.__rw.debugFreeze(true)`);
await sleep(300);
await shoot('intro');

// 2) 游戏中（固定种子 + 冻结动画）
await evalJs(`window.__rw.debugStartSeeded(20261109)`);
await sleep(600);
await evalJs(`window.__rw.debugFreeze(true)`);
await sleep(300);
await shoot('game');

// 3) 结算页
await evalJs(`window.__rw.endRound(false)`);
await sleep(500);
await shoot('end');

fs.mkdirSync(BASE_DIR, { recursive: true });

const compare = async (aB64, bB64) => evalJs(`(async () => {
  const load = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  const [ia, ib] = await Promise.all([load('data:image/png;base64,${aB64}'), load('data:image/png;base64,${bB64}')]);
  if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true, a: [ia.width, ia.height], b: [ib.width, ib.height] };
  const w = ia.width, h = ia.height;
  const c1 = document.createElement('canvas'); c1.width = w; c1.height = h;
  const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
  const x1 = c1.getContext('2d'); const x2 = c2.getContext('2d');
  x1.drawImage(ia, 0, 0); x2.drawImage(ib, 0, 0);
  const d1 = x1.getImageData(0, 0, w, h).data; const d2 = x2.getImageData(0, 0, w, h).data;
  let diff = 0;
  for (let i = 0; i < d1.length; i += 4) {
    const m = Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i + 1] - d2[i + 1]), Math.abs(d1[i + 2] - d2[i + 2]));
    if (m > 20) diff++;
  }
  return { diff, total: w * h, pct: +(100 * diff / (w * h)).toFixed(3) };
})()`);

let pass = 0, fail = 0;
for (const s of shots) {
  const file = path.join(BASE_DIR, `${s.name}.png`);
  if (UPDATE || !fs.existsSync(file)) {
    fs.writeFileSync(file, Buffer.from(s.b64, 'base64'));
    console.log(`  · ${s.name}: 已生成基线 ${path.basename(file)}${UPDATE ? '' : '（首次）'}`);
    continue;
  }
  const baseline = fs.readFileSync(file).toString('base64');
  const r = await compare(baseline, s.b64);
  const okShot = !r.sizeMismatch && r.pct <= THRESHOLD_PCT;
  if (okShot) { pass++; console.log(`  ✓ ${s.name}: 差异 ${r.pct}%`); }
  else { fail++; console.log(`  ✗ ${s.name}: ${r.sizeMismatch ? '尺寸不一致' : `差异 ${r.pct}% > ${THRESHOLD_PCT}%`}`); }
}

console.log(`\n视觉回归: ${pass} 通过 / ${fail} 失败${UPDATE ? '（基线已更新）' : ''}`);
chrome.kill();
process.exit(fail > 0 ? 1 : 0);
