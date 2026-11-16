// 拾径 · Wordloom — 跨浏览器矩阵冒烟
//
// 用本机已安装的浏览器（Chrome / Edge）各跑一遍最小链路：
//   页面加载 → __rw 钩子 → 开局 → 图节点/渲染器 → 无控制台异常
// 缺失的浏览器明确「跳过」而不是失败（CI 通常没有 Edge）。
// 用法：node test/rw-browser-matrix.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveChrome, tempProfile } from './chrome.mjs';

const URL = 'https://localhost:8543/rw/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function edgePath() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/microsoft-edge',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function runBrowser(name, exe, port) {
  const profile = tempProfile(`rw-matrix-${name}`);
  const chrome = spawn(exe, [
    '--headless=new', '--disable-gpu-sandbox', '--no-first-run', '--disable-dev-shm-usage',
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--window-size=1280,800', '--ignore-certificate-errors', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let targets = null;
    for (let i = 0; i < 80; i++) {
      await sleep(400);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        targets = await res.json();
        if (targets && targets.length) break;
      } catch { /* retry */ }
    }
    if (!targets) return { name, ok: false, reason: 'DevTools 未就绪' };
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let msgId = 0; const pending = new Map(); const errors = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
    };
    const send = (method, params = {}) => new Promise((res) => {
      const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
    });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.navigate', { url: URL });
    await sleep(2500);
    const r = await send('Runtime.evaluate', {
      expression: `(async () => {
        const hook = !!window.__rw;
        if (!hook) return { hook: false };
        window.__rw.startRound('normal');
        await new Promise((r) => setTimeout(r, 600));
        const st = window.__rw.state;
        return {
          hook: true,
          nodes: st.graph ? st.graph.nodes.length : 0,
          calls: window.__rw.rendererInfo().calls,
          title: document.title,
        };
      })()`,
      awaitPromise: true, returnByValue: true,
    });
    ws.close();
    const v = r.result?.result?.value || {};
    const ok = v.hook && v.nodes > 5 && v.calls > 0 && errors.length === 0;
    return { name, ok, reason: ok ? '' : JSON.stringify({ v, errors }).slice(0, 300) };
  } finally {
    try { chrome.kill(); } catch { /* 忽略 */ }
  }
}

const results = [];
const chromeExe = resolveChrome();
if (chromeExe) results.push(await runBrowser('chrome', chromeExe, 9345));
else results.push({ name: 'chrome', ok: false, reason: '未安装' });
const edge = edgePath();
if (edge) results.push(await runBrowser('edge', edge, 9346));
else results.push({ name: 'edge', ok: true, skipped: true, reason: '未安装，跳过' });

let fail = 0;
for (const r of results) {
  if (r.skipped) console.log(`  ⚠️ ${r.name}: SKIP（${r.reason}）`);
  else if (r.ok) console.log(`  ✓ ${r.name}: 冒烟通过`);
  else { fail++; console.log(`  ✗ ${r.name}: ${r.reason}`); }
}
console.log(`\n跨浏览器矩阵: ${results.filter((r) => !r.skipped && r.ok).length} 通过 / ${fail} 失败${results.some((r) => r.skipped) ? '（含跳过）' : ''}`);
process.exit(fail ? 1 : 0);
