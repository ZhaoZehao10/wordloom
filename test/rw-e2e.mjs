// 随机游走 VR — 桌面端到端验证（CDP，零依赖）
// 覆盖：页面加载无错误 → 开始游走 → 走一步/收词 → 步数耗尽失败结算 →
//       再走一条 → 主干可达性统计 → 彩蛋（标题连点 / 1024 键盘）→ 截图。
// 用法：先启动 node server.mjs，再 node test/rw-e2e.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9343;
const URL = 'https://localhost:8543/rw/index.html';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu-sandbox', '--no-first-run',
  `--user-data-dir=${process.env.TEMP}\\rw-cdp-${Date.now()}`, `--remote-debugging-port=${PORT}`,
  '--window-size=1280,800', '--ignore-certificate-errors', 'about:blank',
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
if (!targets) { console.error('DevTools 端口未就绪'); process.exit(1); }
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
  if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });
await sleep(2200);

console.log('\n[1] 页面加载');
const boot = await evalJs(`({
  title: document.title,
  introVisible: !document.getElementById('intro').classList.contains('hidden'),
  hasHook: !!window.__rw,
  sceneNodes: window.__rw ? 'hook-ok' : 'no-hook',
})`);
ok(boot.title.includes('随机游走'), '标题正确', JSON.stringify(boot));
ok(boot.introVisible, '引导页可见');
ok(boot.hasHook, '测试钩子存在');

console.log('\n[2] 开始游走（标准 12 步）');
await evalJs(`window.__rw.startRound('normal')`);
await sleep(600);
const g1 = await evalJs(`({
  mode: window.__rw.state.mode,
  steps: window.__rw.state.stepsLeft,
  nodes: window.__rw.state.graph.nodes.length,
  edges: window.__rw.state.graph.edges.length,
  start: window.__rw.state.graph.startIdx,
  goal: window.__rw.state.graph.goalIdx,
})`);
ok(g1.mode === 'playing', '进入 playing', JSON.stringify(g1));
ok(g1.steps === 12, '步数 12', `got ${g1.steps}`);
ok(g1.nodes >= 26, `节点数 ${g1.nodes} ≥ 26`);
ok(g1.edges >= g1.nodes - 1, `边数 ${g1.edges} ≥ 节点-1（连通前提）`);

console.log('\n[3] 图连通性（主干 start→goal 可达，跑 50 局）');
const conn = await evalJs(`(async () => {
  let allOk = true, minDeg = 99, maxDeg = 0;
  const { generateGraph } = await import('/rw/js/graph.mjs');
  const { WORDS } = await import('/rw/js/data.mjs');
  for (let s = 1; s <= 50; s++) {
    const g = generateGraph({ words: WORDS, steps: 12, seed: s * 1337, wordCount: 26 });
    // BFS
    const adj = Array.from({ length: g.nodes.length }, () => []);
    for (const [a, b] of g.edges) { adj[a].push(b); adj[b].push(a); }
    const seen = new Set([g.startIdx]); const q = [g.startIdx];
    while (q.length) { const u = q.pop(); for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); q.push(v); } }
    if (!seen.has(g.goalIdx)) allOk = false;
    for (const a of adj) { minDeg = Math.min(minDeg, a.length); maxDeg = Math.max(maxDeg, a.length); }
    if (minDeg === 0) allOk = false;
  }
  return { allOk, minDeg, maxDeg };
})()`);
ok(conn.allOk, '50 局全部 start→goal 连通且无孤岛', JSON.stringify(conn));
console.log(`    度数范围 ${conn.minDeg}~${conn.maxDeg}`);

console.log('\n[4] 沿主干走（贪心：每步选离 goal 更近的邻点，含滑翔等待）');
const walkResult = await evalJs(`(async () => {
  const st = window.__rw.state;
  const { nodes, edges, goalIdx } = st.graph;
  const adj = {};
  for (const [a, b] of edges) (adj[a] ||= []).push(b), (adj[b] ||= []).push(a);
  const waitGlide = async () => { while (st.glide) await new Promise(r => setTimeout(r, 60)); };
  await waitGlide();
  let cur = st.at, steps = 0;
  while (cur !== goalIdx && steps < 60) {
    let best = null, bd = Infinity;
    for (const v of adj[cur]) {
      const d = nodes[v].pos.distanceToSquared(nodes[goalIdx].pos);
      if (d < bd) { bd = d; best = v; }
    }
    if (best == null) break;
    window.__rw.tryWalk(best);
    await waitGlide();                       // 走一步 = 滑翔一段，等抵达再走下一步
    if (st.at === cur) break;                // walk 被拒（不应发生）
    cur = st.at; steps++;
  }
  return { reached: cur === goalIdx, steps, collected: st.collected.length, mode: st.mode };
})()`);
await sleep(800);
ok(walkResult.reached, `贪心走子抵达 1024（${walkResult.steps} 步，收录 ${walkResult.collected} 词）`, JSON.stringify(walkResult));
ok(walkResult.mode === 'ended', '胜利结算触发（滑翔抵达后）', walkResult.mode);
const g2 = await evalJs(`({ score: window.__rw.state.score, best: window.__rw.state.best })`);
ok(g2.score > 0, `得分 ${g2.score} > 0`);

console.log('\n[5] 再走一条 + 步数耗尽失败分支');
await evalJs(`window.__rw.startRound('hard')`);
await sleep(400);
const failResult = await evalJs(`(async () => {
  const st = window.__rw.state;
  const { edges, goalIdx } = st.graph;
  // 反着走：每步选离 goal 更远的邻点，耗光步数
  const adj = {};
  for (const [a, b] of edges) (adj[a] ||= []).push(b), (adj[b] ||= []).push(a);
  const waitGlide = async () => { while (st.glide) await new Promise(r => setTimeout(r, 60)); };
  await waitGlide();
  let cur = st.at;
  while (st.mode === 'playing' && st.stepsLeft > 0) {
    let worst = null, wd = -1;
    for (const v of adj[cur]) {
      const d = st.graph.nodes[v].pos.distanceToSquared(st.graph.nodes[goalIdx].pos);
      if (d > wd) { wd = d; worst = v; }
    }
    if (worst == null) break;
    window.__rw.tryWalk(worst);
    await waitGlide();
    if (st.at === cur) break;
    cur = st.at;
  }
  await new Promise(r => setTimeout(r, 300));
  return { mode: st.mode, stepsLeft: st.stepsLeft, collected: st.collected.length };
})()`);
await sleep(500);
ok(failResult.mode === 'ended-fail', '失败分支触发', JSON.stringify(failResult));
const endVisible = await evalJs(`!document.getElementById('end').classList.contains('hidden')`);
ok(endVisible, '2D 结算面板可见');
const endData = await evalJs(`({
  poem: document.getElementById('end-poem').textContent,
  quote: document.getElementById('end-quote').textContent.length > 4,
  ach: document.querySelectorAll('#end-ach .ach').length,
})`);
ok(endData.quote, '一言已生成');
ok(endData.poem.length > 0, '路径诗已生成', endData.poem);

console.log('\n[6] 彩蛋');
const egg1 = await evalJs(`(() => {
  const h = document.getElementById('title-h');
  for (let i = 0; i < 7; i++) h.click();
  return { unlimited: window.__rw.state.unlimited, title: h.textContent };
})()`);
ok(egg1.unlimited, '连点标题七次 → 解除步数限制', JSON.stringify(egg1));
const egg2 = await evalJs(`(() => {
  const ev = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  ['1','0','2','4'].forEach(ev);
  return { score: window.__rw.state.score, flashShown: !document.getElementById('egg-flash').classList.contains('hidden') };
})()`);
ok(egg2.score >= 24, '敲 1024 → 加 24 分', JSON.stringify(egg2));

console.log('\n[7] 音效/皮肤/难度切换');
const sw = await evalJs(`(() => {
  document.getElementById('skin-btn').click();
  document.getElementById('timbre-btn').click();
  document.getElementById('mute-btn').click();
  return {
    skin: window.__rw.state.skin,
    timbre: window.__rw.audio.timbre,
    muted: window.__rw.audio.muted,
  };
})()`);
ok(sw.skin === 'cinnabar', '皮肤切到朱砂', JSON.stringify(sw));
ok(sw.timbre !== 'wood', '音色已切换');
ok(sw.muted === true, '静音开关生效');
await evalJs(`document.getElementById('mute-btn').click()`); // 恢复音效

console.log('\n[8] 海报导出 & 舒适性快转');
const poster = await evalJs(`(() => {
  const url = window.__rw.buildPosterDataURL();
  return { isPng: url.startsWith('data:image/png;base64,'), bytes: url.length, btn: !!document.getElementById('poster-btn') };
})()`);
ok(poster.isPng, '海报导出为 PNG dataURL', JSON.stringify({ bytes: poster.bytes }));
ok(poster.bytes > 20000, `海报数据量 ${poster.bytes} 字符（含真实像素，非空白）`);
ok(poster.btn, '结算页存在「下载海报 PNG」按钮');

const snap = await evalJs(`(() => {
  const r0 = window.__rw.debugSnap(0, 'right');       // 先回中，确保已武装
  const r1 = window.__rw.debugSnap(1, 'right');       // 右推 → 应转 -30°
  const r2 = window.__rw.debugSnap(1, 'right');       // 未回中继续推 → 不应再转
  const r3 = window.__rw.debugSnap(0, 'right');       // 回中 → 重新武装
  const r4 = window.__rw.debugSnap(1, 'right');       // 再推 → 再转
  return { r0, r1, r2, r3, r4 };
})()`);
const STEP = Math.PI / 6;
ok(Math.abs(snap.r1 - snap.r0 + STEP) < 1e-6, '右推一次 = 右转 30°', JSON.stringify(snap));
ok(Math.abs(snap.r2 - snap.r1) < 1e-9, '未回中重复推 → 不再转（防转圈）');
ok(Math.abs(snap.r3 - snap.r2) < 1e-9, '回中本身不改变朝向');
ok(Math.abs(snap.r4 - snap.r3 + STEP) < 1e-6, '回中后再推 → 再次右转 30°');
await evalJs(`window.__rw.debugSnap(0, 'right')`);

console.log('\n[9] 渲染帧检查（drawcall + 游戏中截图）');
await evalJs(`window.__rw.startRound('normal')`);
await sleep(1200);
const frame = await evalJs(`({ calls: window.__rw.rendererInfo().calls, triangles: window.__rw.rendererInfo().triangles })`);
ok(frame.calls > 5 && frame.triangles > 100, `渲染活跃（${frame.calls} drawcalls, ${frame.triangles} 三角形）`, JSON.stringify(frame));

const shot2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('test/rw-preview-game.png', Buffer.from(shot2.result.data, 'base64'));
console.log('    游戏中截图已存 test/rw-preview-game.png');

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('test/rw-preview.png', Buffer.from(shot.result.data, 'base64'));
console.log('\n    截图已存 test/rw-preview.png');

console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
if (consoleErrors.length) {
  console.log('控制台错误:');
  consoleErrors.slice(0, 8).forEach((e) => console.log('  · ' + e.slice(0, 200)));
}
chrome.kill();
process.exit(fail > 0 || consoleErrors.length > 0 ? 1 : 0);
