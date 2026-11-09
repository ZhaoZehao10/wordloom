// 单文件离线版 file:// 验证：加载 → 无脚本错误 → 开局 → 走子 → 结算 → WebXR 接口探测
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { resolveChrome, tempProfile } from './chrome.mjs';
import path from 'node:path';

const CHROME = resolveChrome();
const PORT = 9353;
const FILE = 'dist/拾径-离线版.html';
// Windows 路径需转成正斜杠，否则 encodeURI 会把反斜杠编码为 %5C，file:// 打不开
const URL = 'file:///' + encodeURI(path.resolve(FILE).replace(/\\/g, '/')).replace(/#/g, '%23');

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu-sandbox', '--no-first-run',
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
  `--user-data-dir=${tempProfile('rw-offline')}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1280,800', '--allow-file-access-from-files', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

let targets = null;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    targets = await res.json();
    if (targets && targets.length) break;
  } catch { /* retry */ }
}
if (!targets) { console.error('DevTools 未就绪'); process.exit(1); }
const page = targets.find((t) => t.type === 'page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let msgId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value || a.description || '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  }
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });
await sleep(2200);

console.log('\n[1] file:// 加载');
const boot = await evalJs(`({
  title: document.title,
  hook: !!window.__rw,
  THREE: typeof THREE !== 'undefined' && !!THREE.Scene,
  fileProtocol: location.protocol === 'file:',
})`);
ok(boot.fileProtocol, 'file:// 协议');
ok(boot.title.includes('拾径'), '标题正确');
ok(boot.THREE, 'THREE 全局可用（内联成功）');
ok(boot.hook, '游戏钩子可用');

console.log('\n[2] 开局 + 走子 + 结算');
const play = await evalJs(`(async () => {
  const st = window.__rw.state;
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 300));
  const adj = {};
  for (const [a, b] of st.graph.edges) (adj[a] ||= []).push(b), (adj[b] ||= []).push(a);
  const waitGlide = async () => { while (st.glide) await new Promise(r => setTimeout(r, 60)); };
  await waitGlide();
  let cur = st.at, steps = 0;
  const goal = st.graph.goalIdx;
  while (cur !== goal && steps < 60) {
    let best = null, bd = Infinity;
    for (const v of adj[cur]) {
      const d = st.graph.nodes[v].pos.distanceToSquared(st.graph.nodes[goal].pos);
      if (d < bd) { bd = d; best = v; }
    }
    if (best == null) break;
    window.__rw.tryWalk(best);
    await waitGlide();
    if (st.at === cur) break;
    cur = st.at; steps++;
  }
  return { mode: st.mode, steps, collected: st.collected.length, score: st.score };
})()`);
ok(play.mode === 'ended', `完整流程可玩（${play.steps} 步抵达，${play.collected} 词，${play.score} 分）`, JSON.stringify(play));

console.log('\n[3] WebXR 接口探测（file:// 安全上下文）');
const xr = await evalJs(`({
  secure: window.isSecureContext,
  hasXR: !!navigator.xr,
  hasXRPromise: typeof navigator.xr?.isSessionSupported === 'function',
})`);
console.log('    isSecureContext:', xr.secure, '· navigator.xr:', xr.hasXR);
ok(xr.hasXR, 'file:// 下 navigator.xr 存在（Pico 浏览器待真机复核）');

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('test/rw-offline-preview.png', Buffer.from(shot.result.data, 'base64'));

console.log(`\n========== 离线版: ${pass} 通过 / ${fail} 失败 ==========`);
if (consoleErrors.length) {
  console.log('控制台错误:');
  consoleErrors.slice(0, 6).forEach((e) => console.log('  · ' + e.slice(0, 220)));
}
chrome.kill();
process.exit(fail > 0 || consoleErrors.length > 0 ? 1 : 0);
