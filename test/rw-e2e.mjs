// 拾径 Wordloom — 桌面端到端验证（CDP，零依赖）
// 覆盖：页面加载无错误 → 开始游走 → 走一步/收词 → 步数耗尽失败结算 →
//       再走一条 → 主干可达性统计 → 彩蛋（标题连点 / 1024 键盘）→ 截图。
// 用法：先启动 node server.mjs，再 node test/rw-e2e.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { resolveChrome, tempProfile } from './chrome.mjs';

const CHROME = resolveChrome();
const PORT = 9343;
const URL = 'https://localhost:8543/rw/index.html';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu-sandbox', '--no-first-run',
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
  `--user-data-dir=${tempProfile('rw-cdp')}`, `--remote-debugging-port=${PORT}`,
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
ok(boot.title.includes('拾径'), '标题正确', JSON.stringify(boot));
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
  // BFS 最短路径：贪心可能绕远导致步数耗尽（测试不稳定），最短路才可复现
  const prev = new Map([[st.at, null]]);
  const queue = [st.at];
  while (queue.length) {
    const u = queue.shift();
    if (u === goalIdx) break;
    for (const v of adj[u]) if (!prev.has(v)) { prev.set(v, u); queue.push(v); }
  }
  const path = [];
  for (let c = prev.has(goalIdx) ? goalIdx : null; c !== null; c = prev.get(c)) path.unshift(c);
  let steps = 0;
  for (let i = 1; i < path.length; i++) {
    window.__rw.tryWalk(path[i]);
    await waitGlide();                       // 走一步 = 滑翔一段，等抵达再走下一步
    steps++;
  }
  const cur = st.at;
  return { reached: cur === goalIdx, steps, collected: st.collected.length, mode: st.mode, pathLen: path.length - 1 };
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

console.log('\n[9] VR 内菜单');
const menu = await evalJs(`(() => {
  window.__rw.debugMenuToggle(true);
  const open = window.__rw.debugMenuOpen();
  const ids = window.__rw.debugMenuButtons();
  const hit = window.__rw.debugMenuHit(0.5, 0.247);   // 第一行中间按钮（标准）
  const gap = window.__rw.debugMenuHit(0.5, 0.5);     // 行间空隙应无按钮
  window.__rw.debugMenuSelect('diff:easy');
  window.__rw.debugMenuSelect('skin:celadon');
  window.__rw.debugMenuSelect('timbre:chime');
  const st = window.__rw.state;
  const applied = { pending: st.pendingDiff, skin: st.skin, timbre: window.__rw.audio.timbre };
  window.__rw.debugMenuSelect('start');
  const after = { open: window.__rw.debugMenuOpen(), steps: st.stepsLeft, mode: st.mode };
  return { open, ids, hit, gap, applied, after };
})()`);
ok(menu.open, '握键打开菜单');
ok(menu.ids.length === 12 && menu.ids.includes('diff:easy') && menu.ids.includes('move:teleport') && menu.ids.includes('start'), '菜单按钮齐全（含移动模式）', JSON.stringify(menu.ids));
ok(menu.hit === 'diff:normal', `按钮中心命中正确（${menu.hit}）`);
ok(menu.gap === null, '行间空隙不命中按钮（不会误点）');
ok(menu.applied.pending === 'easy', '菜单选难度 → 下一局用 easy');
ok(menu.applied.skin === 'celadon', '菜单换皮肤 → celadon');
ok(menu.applied.timbre === 'chime', '菜单换音色 → chime');
ok(menu.after.open === false, '点开始后菜单自动收起');
ok(menu.after.mode === 'playing' && menu.after.steps === 16, `点开始 → 按 easy 开新局（${menu.after.steps} 步）`, JSON.stringify(menu.after));

console.log('\n[10] 战绩统计 & 难度记忆 & VR 结算面板');
const stats = await evalJs(`(async () => {
  const st = window.__rw.state;
  window.__rw.debugMenuSelect('diff:hard');        // 选紧绷（下一局及重开都记住）
  const before = window.__rw.historyInfo();
  window.__rw.endRound(false);                      // 直接结算一局
  await new Promise(r => setTimeout(r, 100));
  const after = window.__rw.historyInfo();
  const actions = window.__rw.debugShowEndPanel(false);
  const q0 = window.__rw.debugQuote();
  let changed = false;
  for (let i = 0; i < 6 && !changed; i++) {
    const q = window.__rw.debugRerollQuote();
    if (q.text !== q0.text || q.flavor !== q0.flavor) changed = true;
  }
  window.__rw.debugEndAction('again');              // 按「再来一局」应沿用 hard
  await new Promise(r => setTimeout(r, 100));
  return {
    beforeCount: before.count, afterCount: after.count,
    rounds: after.summary.rounds, persisted: after.persisted,
    historyText: document.getElementById('end-history').textContent,
    diffText: document.getElementById('end-stats').textContent,
    actions, quoteChanged: changed,
    restartSteps: st.stepsLeft, restartDiff: st.diff, mode: st.mode,
    savedDiff: localStorage.getItem('rw-diff'),
    savedHistoryLen: JSON.parse(localStorage.getItem('rw-history') || '[]').length,
  };
})()`);
ok(stats.afterCount === stats.beforeCount + 1, `结算后战绩 +1（${stats.beforeCount}→${stats.afterCount}）`);
ok(stats.rounds >= 1 && stats.persisted >= 1, '战绩已写入 localStorage 并可读回', JSON.stringify(stats.rounds));
ok(stats.historyText.includes('历史') && stats.historyText.includes('最佳'), `结算页显示历史摘要「${stats.historyText}」`);
ok(stats.diffText.startsWith('悠然'), `结算页显示「本局难度」（第 9 节开的是悠然）「${stats.diffText}」`);
ok(stats.actions.join(',') === 'replay,requote,again', `VR 结算面板三个按钮：${stats.actions.join(',')}`);
ok(stats.quoteChanged, '面板「换一句」能换出新一言');
ok(stats.restartDiff === 'hard' && stats.restartSteps === 9, `「再来一局」沿用 hard（9 步），不再硬编码标准难度`);
ok(stats.mode === 'playing', '重开后回到游玩态');
ok(stats.savedDiff === 'hard', '难度选择已持久化（rw-diff）');
ok(stats.savedHistoryLen === stats.afterCount, '战绩持久化条数与内存一致');

console.log('\n[11] 词集收藏（跨局元进度）');
const coll = await evalJs(`(async () => {
  const st = window.__rw.state;
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 300));
  const before = window.__rw.collectionInfo();
  const adj = {};
  for (const [a, b] of st.graph.edges) (adj[a] ||= []).push(b), (adj[b] ||= []).push(a);
  const waitGlide = async () => { while (st.glide) await new Promise(r => setTimeout(r, 60)); };
  await waitGlide();
  let cur = st.at;
  for (let i = 0; i < 4 && st.mode === 'playing'; i++) {
    const un = adj[cur].filter((v) => !st.graph.nodes[v].collected);
    const next = un.length ? un[0] : adj[cur][0];
    if (next === undefined) break;
    window.__rw.tryWalk(next, 'right');
    await waitGlide();
    cur = st.at;
  }
  window.__rw.endRound(false);
  await new Promise(r => setTimeout(r, 150));
  const after = window.__rw.collectionInfo();
  return {
    before: before.count, after: after.count, roundNew: after.roundNew.length,
    persisted: after.persisted, prog: after.progress,
    hud: document.getElementById('hud-collection').textContent + '/' + document.getElementById('hud-collection-total').textContent,
    hist: document.getElementById('end-history').textContent,
  };
})()`);
ok(coll.after >= coll.before, `词集只增不减（${coll.before}→${coll.after}）`);
ok(coll.roundNew === coll.after - coll.before, `本局新词数 = 词集增量（${coll.roundNew}）`);
ok(coll.persisted === coll.after, '词集已持久化且与内存一致');
ok(coll.hud.split('/')[1] === '120', `引导页词集进度显示 ${coll.hud}（总词库 120）`);
ok(coll.hist.includes('词集'), `结算页显示词集进度「${coll.hist}」`);
ok(coll.prog.collected <= coll.prog.total && coll.prog.ratio <= 1, '词集进度不超过 100%', JSON.stringify(coll.prog));

console.log('\n[12] 词集一览面板');
const panel = await evalJs(`(() => {
  const r = window.__rw.debugOpenCollection();
  const visible = !document.getElementById('coll').classList.contains('hidden');
  const countText = document.getElementById('coll-count').textContent;
  const closed = window.__rw.debugCloseCollection();
  return { ...r, visible, countText, closed, collection: window.__rw.collectionInfo().count };
})()`);
ok(panel.visible, '点词集打开一览面板');
ok(panel.chips === 120, `面板渲染全部词库条目（${panel.chips} 个）`);
ok(panel.got === panel.collection, `已收集高亮数 = 词集数（${panel.got}/${panel.collection}）`);
ok(panel.countText.split('/')[1] === '120', `面板标题显示进度 ${panel.countText}（总词库 120）`);
ok(panel.closed, '可关闭面板');

console.log('\n[13] 路径回放 / 空间音效 / 跨难度成就');
const replay = await evalJs(`(async () => {
  const st = window.__rw.state;
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 250));
  const adj = {};
  for (const [a, b] of st.graph.edges) (adj[a] ||= []).push(b), (adj[b] ||= []).push(a);
  const waitGlide = async () => { while (st.glide) await new Promise(r => setTimeout(r, 60)); };
  await waitGlide();
  let cur = st.at;
  for (let i = 0; i < 3; i++) {
    const next = adj[cur][0];
    if (next === undefined) break;
    window.__rw.tryWalk(next);
    await waitGlide();
    cur = st.at;
  }
  window.__rw.endRound(false);
  await new Promise(r => setTimeout(r, 150));
  const okStart = window.__rw.debugStartReplay();
  const mode = st.mode;
  await new Promise(r => setTimeout(r, 700));
  const info = window.__rw.replayInfo();
  const stopped = window.__rw.debugStopReplay();
  return {
    okStart, mode, info, stopped, modeAfter: st.mode,
    btn: !!document.getElementById('replay-btn'),
    tipHidden: document.getElementById('replay-tip').classList.contains('hidden'),
  };
})()`);
ok(replay.btn, '结算页有「▶ 重放路径」按钮');
ok(replay.okStart, '结算后可启动路径回放');
ok(replay.mode === 'replaying', '进入回放态（replaying）');
ok(replay.info && replay.info.points >= 3, `回放路径点数 ${replay.info?.points} ≥ 3`);
ok(replay.info && (Math.abs(replay.info.rig.x) + Math.abs(replay.info.rig.z)) > 0.01, '回放中镜头确实在移动', JSON.stringify(replay.info?.rig));
ok(replay.stopped && replay.modeAfter === 'ended-fail', '跳过回放后回到结算态');
ok(replay.tipHidden, '回放结束后提示条隐藏');

const spatial = await evalJs(`window.__rw.debugSpatial({ freq: 880 })`);
ok(spatial.played === false, '桌面（无 XR）时空间音效回落，不抛异常');
ok(spatial.poolSize === 0, '未进入 VR 不创建 panner 池（省资源）');

const ach = await evalJs(`(async () => {
  const st = window.__rw.state;
  st.collection = Array.from({ length: 31 }, (_, i) => 'w' + i);
  st.history = [
    { win: true, score: 10, steps: 3, words: 2, diff: 'easy' },
    { win: true, score: 10, steps: 3, words: 2, diff: 'normal' },
    { win: true, score: 10, steps: 3, words: 2, diff: 'hard' },
  ];
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 200));
  window.__rw.endRound(true);
  await new Promise(r => setTimeout(r, 120));
  return document.getElementById('end-ach').textContent;
})()`);
ok(ach.includes('词集三十'), `词集 ≥30 成就生效（${ach.trim().replace(/\\s+/g, ' ')}）`);
ok(ach.includes('三途皆涉'), '三难度全胜成就生效');

console.log('\n[14] 每日挑战');
const daily = await evalJs(`(async () => {
  const st = window.__rw.state;
  const info = window.__rw.dailyInfo();
  window.__rw.debugStartDaily();
  await new Promise(r => setTimeout(r, 250));
  const snap = () => JSON.stringify({
    n: st.graph.nodes.map((n) => [n.word, +n.pos.x.toFixed(4), +n.pos.z.toFixed(4)]),
    e: st.graph.edges,
  });
  const g1 = snap();
  const isDaily1 = st.isDaily;
  const diff1 = st.diff;
  const steps1 = st.stepsLeft;
  window.__rw.debugStartDaily();          // 同一天再进一次
  await new Promise(r => setTimeout(r, 250));
  const g2 = snap();
  window.__rw.endRound(false);
  await new Promise(r => setTimeout(r, 150));
  const after = window.__rw.dailyInfo();
  return {
    key: info.key, seed: info.seed, diff: info.difficulty,
    sameGraph: g1 === g2, isDaily1, diff1, steps1,
    after, text: document.getElementById('daily-status').textContent,
    statsLine: document.getElementById('end-stats').textContent,
  };
})()`);
ok(/^\d{4}-\d{2}-\d{2}$/.test(daily.key), `日期键格式 ${daily.key}`);
ok(Number.isInteger(daily.seed) && daily.seed > 0, `种子稳定生成（${daily.seed}）`);
ok(daily.sameGraph, '同一天重复进入 → 完全相同的词图（每日固定）');
ok(daily.isDaily1 === true, '每日挑战标记正确');
ok(daily.steps1 === { easy: 16, normal: 12, hard: 9 }[daily.diff1], `每日难度与步数一致（${daily.diff1}/${daily.steps1}）`);
ok(daily.after.status.played === true, '完成后记录为已挑战');
ok(daily.text.includes('已完成'), `引导页显示每日状态「${daily.text}」`);
ok(daily.statsLine.includes('每日挑战'), `结算页标明每日挑战「${daily.statsLine}」`);

console.log('\n[15] 存档导出 / 导入 / 重置');
const save = await evalJs(`(() => {
  const st = window.__rw.state;
  st.best = 777; st.collection = ['光', '熵', '梦']; st.history = [];
  st.unlocked = ['reach', 'calm'];
  const text = window.__rw.exportSaveText();
  const parsed = JSON.parse(text);
  st.best = 0; st.collection = []; st.unlocked = [];
  const ok1 = window.__rw.importSaveText(text);
  const restored = { best: st.best, coll: st.collection.length, ach: st.unlocked.length };
  const bad = window.__rw.importSaveText('{"app":"other","version":1}');
  const didReset = window.__rw.resetAll();
  return {
    parsed, ok: ok1.ok, restored, badOk: bad.ok, didReset,
    afterReset: { best: st.best, coll: st.collection.length, ach: st.unlocked.length },
  };
})()`);
ok(save.parsed.app === 'wordloom-vr' && save.parsed.version === 2, '导出存档格式正确（v2）');
ok(save.parsed.progress && save.parsed.progress.achievements.length === 2, '存档包含成就进度');
ok(save.ok && save.restored.best === 777 && save.restored.coll === 3 && save.restored.ach === 2, '导入恢复最佳分/词集/成就', JSON.stringify(save.restored));
ok(save.badOk === false, '其它应用的存档被拒绝');
ok(save.didReset && save.afterReset.best === 0 && save.afterReset.coll === 0 && save.afterReset.ach === 0, '重置清空进度（含成就）');

console.log('\n[16] 存储脏数据注入（健壮性）');
await evalJs(`(() => {
  localStorage.setItem('rw-history', '{{{bad');
  localStorage.setItem('rw-collection', '"not-array"');
  localStorage.setItem('rw-best', 'abc');
  localStorage.setItem('rw-daily', '{"key":123}');
  localStorage.setItem('rw-diff', 'weird');
  return true;
})()`);
await send('Page.reload');
await sleep(2600);
const fuzz = await evalJs(`({
  hook: !!window.__rw,
  intro: !!document.getElementById('intro'),
  best: window.__rw ? window.__rw.state.best : -1,
  history: window.__rw ? window.__rw.state.history.length : -1,
  collection: window.__rw ? window.__rw.state.collection.length : -1,
  daily: window.__rw ? window.__rw.state.daily : 'missing',
})`);
ok(fuzz.hook && fuzz.intro, '脏数据后页面仍能正常启动');
ok(fuzz.best === 0 && fuzz.history === 0 && fuzz.collection === 0 && fuzz.daily === null,
  '脏数据被安全忽略并回落默认值', JSON.stringify(fuzz));

console.log('\n[17] 新手引导 / 移动模式 / 语言');
const ux = await evalJs(`(async () => {
  const st = window.__rw.state;
  // 先把引导标记清掉，模拟首次进入
  window.__rw.debugResetTutorial();
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 250));
  const firstOpen = window.__rw.tutorialInfo();
  window.__rw.debugDismissTutorial();
  const afterDismiss = window.__rw.tutorialInfo();
  const savedFlag = localStorage.getItem('rw-tutorial-done');
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 250));
  const secondOpen = window.__rw.tutorialInfo();

  // 移动模式：瞬移
  window.__rw.debugSetMoveMode('teleport');
  const mode = window.__rw.moveModeInfo();
  const savedMove = localStorage.getItem('rw-move');
  const adj = {};
  for (const [a, b] of st.graph.edges) (adj[a] ||= []).push(b), (adj[b] ||= []).push(a);
  const first = adj[st.at][0];
  const target = st.graph.nodes[first].pos;
  window.__rw.tryWalk(first);
  const teleportState = { glide: !!st.glide, at: st.at === first, rigX: +window.__rw.debugRig().x.toFixed(2), targetX: +target.x.toFixed(2) };

  // 切回滑翔
  window.__rw.debugSetMoveMode('glide');
  const first2 = adj[st.at].find((v) => v !== st.at);
  window.__rw.tryWalk(first2);
  const glideState = { glide: !!st.glide };

  // 语言
  window.__rw.debugSetLang('en');
  const en = {
    html: document.documentElement.lang,
    start: document.getElementById('start-btn').textContent.trim(),
    skin: document.getElementById('skin-btn').textContent.trim(),
  };
  window.__rw.debugSetLang('zh');
  const zh = {
    html: document.documentElement.lang,
    start: document.getElementById('start-btn').textContent.trim(),
  };
  return { firstOpen, afterDismiss, savedFlag, secondOpen, mode, savedMove, teleportState, glideState, en, zh };
})()`);
ok(ux.firstOpen.open === true && ux.firstOpen.done === false, '首次进入自动展示引导');
ok(ux.afterDismiss.open === false && ux.afterDismiss.done === true, '关闭引导后标记为已完成');
ok(ux.savedFlag === '1', '引导完成标记已持久化');
ok(ux.secondOpen.open === false, '再次进入不再展示引导');
ok(ux.mode === 'teleport' && ux.savedMove === 'teleport', '移动模式切换并持久化');
ok(ux.teleportState.at && ux.teleportState.glide === false, '瞬移模式：一步到位，无滑翔过程');
ok(Math.abs(ux.teleportState.rigX - ux.teleportState.targetX) < 0.3, '瞬移后位置即目标点', JSON.stringify(ux.teleportState));
ok(ux.glideState.glide === true, '切回滑翔模式后恢复滑翔动画');
ok(ux.en.html === 'en' && ux.en.start === 'Start ▸' && ux.en.skin.includes('Skin'), `英文界面生效（${ux.en.start} / ${ux.en.skin}）`);
ok(ux.zh.html === 'zh-CN' && ux.zh.start === '开始游走 ▸', '切回中文界面正常');

console.log('\n[18] 主题词包 / 每日 7 日榜 / 舒适性');
const extras = await evalJs(`(async () => {
  const st = window.__rw.state;
  // 词包
  const pack0 = window.__rw.packInfo();
  window.__rw.debugSetPack('poetry');
  const pack1 = window.__rw.packInfo();
  const list = window.__rw.packList();
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 250));
  const graphWords = st.graph.nodes.filter((n) => n.kind === 'word').map((n) => n.word);
  const allFromPack = graphWords.every((w) => list.includes(w));
  window.__rw.endRound(false);
  await new Promise(r => setTimeout(r, 120));

  // 每日 7 日榜（先造一条今日记录，避免依赖前面用例的重置状态）
  window.__rw.debugSetDailyHistory([{ key: window.__rw.dailyInfo().key, score: 7, win: false }]);
  const dh = window.__rw.dailyHistoryInfo();
  const boardDom = document.querySelectorAll('#daily-board .daily-chip').length;

  // 音量
  window.__rw.debugSetVolume(0.3);
  const vol = window.__rw.volumeInfo();
  const volSaved = localStorage.getItem('rw-volume');

  // 防晕遮罩：开启时滑翔中途应 >0，关闭时为 0
  window.__rw.debugToggleVignette();      // 先关
  const off = window.__rw.vignetteInfo();
  window.__rw.debugToggleVignette();      // 再开
  window.__rw.debugSetMoveMode('glide');
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 250));
  const adj = {};
  for (const [a, b] of st.graph.edges) (adj[a] ||= []).push(b), (adj[b] ||= []).push(a);
  window.__rw.tryWalk(adj[st.at][0]);
  let maxOp = 0;
  for (let i = 0; i < 30; i++) {
    maxOp = Math.max(maxOp, window.__rw.vignetteInfo().opacity);
    if (maxOp > 0) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  const during = { ...window.__rw.vignetteInfo(), opacity: maxOp };

  // 座姿标定
  const seated = window.__rw.debugCalibrateSeated(1.2);
  const seatedInfo = window.__rw.seatedInfo();
  window.__rw.debugCalibrateSeated(1.6);
  const seatedReset = window.__rw.seatedInfo();
  return { pack0, pack1, allFromPack, graphWords: graphWords.length, dh, boardDom, vol, volSaved, off, during, seated, seatedInfo, seatedReset };
})()`);
ok(extras.pack0.packs.length === 5 && extras.pack0.words === 60, `默认词包经典（${extras.pack0.words} 词，共 5 个词包）`);
ok(extras.pack1.pack === 'poetry' && extras.pack1.words === 40, '切换到诗词词包（40 词）');
ok(extras.allFromPack && extras.graphWords > 5, `本局词节点全部来自所选词包（${extras.graphWords} 个）`);
ok(extras.dh.board.length === 7, '每日榜固定 7 格');
ok(extras.dh.board[0].played === true && extras.dh.board[0].score >= 0, '今日成绩在榜首');
ok(extras.boardDom === 7, `引导页渲染 7 个日期格（${extras.boardDom}）`);
ok(extras.vol.volume === 0.3 && extras.volSaved === '0.3', `音量设置生效并持久化（${extras.vol.percent}%）`);
ok(extras.off.enabled === false && extras.off.opacity === 0, '关闭遮罩后不透明度为 0');
ok(extras.during.enabled === true && extras.during.opacity > 0, `滑翔中出现遮罩（${extras.during.opacity}）`);
ok(extras.seated === 0.4 && extras.seatedInfo.rigY === 0.4, `座姿 1.2m → 世界抬高 0.4m（rigY=${extras.seatedInfo.rigY}）`);
ok(extras.seatedReset.offset === 0, '回到站立眼高后偏移归零');

console.log('\n[19] 词包成就 & 每日榜图表');
const packAch = await evalJs(`(async () => {
  const st = window.__rw.state;
  window.__rw.debugSetPack('poetry');
  st.collection = window.__rw.packList().slice();   // 诗词包全集
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 220));
  window.__rw.endRound(false);
  await new Promise(r => setTimeout(r, 150));
  return {
    ach: document.getElementById('end-ach').textContent,
    chart: window.__rw.chartInfo(),
    pack: window.__rw.packInfo().pack,
  };
})()`);
ok(packAch.pack === 'poetry', '当前为诗词词包');
ok(packAch.ach.includes('诗词全集'), `集满诗词词包 → 解锁「诗词全集」（${packAch.ach.trim().replace(/\s+/g, ' ')}）`);
ok(packAch.chart.ok && packAch.chart.litPixels > 100, `每日榜图表已绘制（${packAch.chart.litPixels} 个像素）`);

console.log('\n[20] 词包主题 / 月视图 / 存档携带');
const theme = await evalJs(`(async () => {
  const st = window.__rw.state;
  window.__rw.debugSetPack('poetry');
  const poetry = { skin: st.skin, timbre: window.__rw.audio.timbre };
  window.__rw.debugSetPack('geek');
  const geek = { skin: st.skin, timbre: window.__rw.audio.timbre };

  const month = window.__rw.debugOpenMonth();
  const cells = document.querySelectorAll('#month-grid .month-cell').length;
  const headers = document.querySelectorAll('#month-grid .month-head').length;
  const summary = document.getElementById('month-summary').textContent;
  const closed = window.__rw.debugCloseMonth();

  const saveText = window.__rw.exportSaveText();
  const saved = JSON.parse(saveText).settings;
  return { poetry, geek, month, cells, headers, summary, closed, savedPack: saved.pack, savedMove: saved.moveMode };
})()`);
ok(theme.poetry.skin === 'cinnabar' && theme.poetry.timbre === 'chime', '诗词词包自动套用朱砂/风铃主题', JSON.stringify(theme.poetry));
ok(theme.geek.skin === 'celadon' && theme.geek.timbre === 'synth', '极客词包自动套用青瓷/电子主题', JSON.stringify(theme.geek));
ok(theme.month.cells > 0 && theme.cells === theme.month.cells, `月视图网格格数正确（${theme.cells}）`);
ok(theme.headers === 7, '月视图 7 个星期表头');
ok(theme.summary.includes('本月'), `月视图摘要「${theme.summary}」`);
ok(theme.closed, '月视图可关闭');
ok(theme.savedPack === 'geek', '存档携带词包设置');
ok(theme.savedMove === 'glide', '存档携带移动模式设置');

console.log('\n[21] 混合词包 & 连续打卡');
const streak = await evalJs(`(async () => {
  const st = window.__rw.state;
  window.__rw.debugSetPack('mix');
  const mix = window.__rw.packInfo();
  // 造 7 天连续记录（含今天）
  const today = window.__rw.dailyInfo().key;
  const rows = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(new Date(today + 'T00:00:00').getTime() - i * 86400000);
    const p = (n) => String(n).padStart(2, '0');
    rows.push({ key: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), score: 10 + i, win: i === 6 });
  }
  window.__rw.debugSetDailyHistory(rows);
  const statusText = document.getElementById('daily-status').textContent;
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 220));
  window.__rw.endRound(false);
  await new Promise(r => setTimeout(r, 150));
  return { mix, statusText, ach: document.getElementById('end-ach').textContent };
})()`);
ok(streak.mix.pack === 'mix' && streak.mix.words === 120, `混合词包可用（${streak.mix.words} 词）`);
ok(streak.statusText.includes('连续 7'), `每日状态显示连续天数「${streak.statusText}」`);
ok(streak.ach.includes('七日不辍'), `连续 7 天解锁「七日不辍」（${streak.ach.trim().replace(/\s+/g, ' ')}）`);

console.log('\n[22] 打卡奖励 & 词包进度条');
const bonus = await evalJs(`(async () => {
  const st = window.__rw.state;
  // 构造 7 天连续（含今天）
  const today = window.__rw.dailyInfo().key;
  const rows = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(new Date(today + 'T00:00:00').getTime() - i * 86400000);
    const p = (n) => String(n).padStart(2, '0');
    rows.push({ key: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), score: 1, win: false });
  }
  window.__rw.debugSetDailyHistory(rows);
  const info = window.__rw.dailyInfo();
  window.__rw.debugStartDaily();
  await new Promise(r => setTimeout(r, 250));
  const stepsAfterBonus = st.stepsLeft;
  const maxSteps = st.stepsMax;
  const diff = st.diff;
  window.__rw.endRound(false);
  await new Promise(r => setTimeout(r, 150));
  const statsText = document.getElementById('end-stats').textContent;

  const coll = window.__rw.debugOpenCollection();
  const packRows = document.querySelectorAll('#pack-progress .pack-row').length;
  const bars = document.querySelectorAll('#pack-progress .pack-bar i').length;
  const firstWidth = document.querySelector('#pack-progress .pack-bar i')?.style.width || '';
  const hintText = document.getElementById('coll-hint').textContent;
  window.__rw.debugCloseCollection();
  return { diff, stepsAfterBonus, maxSteps, statsText, packRows, bars, firstWidth, hintText };
})()`);
const baseSteps = { easy: 16, normal: 12, hard: 9 }[bonus.diff];
ok(bonus.stepsAfterBonus === baseSteps + 2 && bonus.maxSteps === baseSteps + 2, `连续 7 天每日挑战 +2 步（${bonus.stepsAfterBonus}/${baseSteps}+2）`);
ok(bonus.statsText.includes('+2') && bonus.statsText.includes('步数奖励'), `结算页显示步数奖励「${bonus.statsText}」`);
ok(bonus.packRows === 4 && bonus.bars === 4, `词集面板显示 4 条词包进度（${bonus.packRows}）`);
ok(/%$/.test(bonus.firstWidth), `进度条有百分比宽度（${bonus.firstWidth}）`);
ok(bonus.hintText.includes('再收集') || bonus.hintText.includes('全部点亮'), `词集提示「${bonus.hintText}」`);

console.log('\n[23] 成就总览 & 历史最佳');
const achPanel = await evalJs(`(async () => {
  const st = window.__rw.state;
  // 确保有已解锁成就
  const info0 = window.__rw.achievementInfo();
  const panel = window.__rw.debugOpenAchievements();
  const gotDom = document.querySelectorAll('#ach-grid .ach-item.got').length;
  const lockedDom = document.querySelectorAll('#ach-grid .ach-item.locked').length;
  const countText = document.getElementById('ach-count').textContent;
  const closed = window.__rw.debugCloseAchievements();
  // 月视图历史最佳
  const today = window.__rw.dailyInfo().key;
  window.__rw.debugSetDailyHistory([
    { key: today, score: 42, win: false },
  ]);
  window.__rw.debugOpenMonth();
  const monthText = document.getElementById('month-summary').textContent;
  window.__rw.debugCloseMonth();
  return { info0, panel, gotDom, lockedDom, countText, closed, monthText };
})()`);
ok(achPanel.info0.total === 16, `成就总数 ${achPanel.info0.total}`);
ok(achPanel.info0.unlocked.length > 0, `已有解锁成就（${achPanel.info0.unlocked.length}）`);
ok(achPanel.panel.total === 16 && achPanel.panel.unlocked === achPanel.info0.unlocked.length, '成就面板统计一致');
ok(achPanel.gotDom === achPanel.info0.unlocked.length && achPanel.lockedDom > 0, `已解锁/未解锁渲染正确（${achPanel.gotDom}/${achPanel.lockedDom}）`);
ok(achPanel.countText === `${achPanel.info0.unlocked.length}/16`, `成就计数显示 ${achPanel.countText}`);
ok(achPanel.closed, '成就面板可关闭');
ok(achPanel.monthText.includes('历史最佳 42'), `月视图显示历史最佳「${achPanel.monthText}」`);

console.log('\n[24] 每周挑战 & 海报生涯成就');
const weekly = await evalJs(`(async () => {
  const st = window.__rw.state;
  const info = window.__rw.weeklyInfo();
  window.__rw.debugStartWeekly();
  await new Promise(r => setTimeout(r, 250));
  const snap = () => JSON.stringify({
    n: st.graph.nodes.map((n) => [n.word, +n.pos.x.toFixed(4), +n.pos.z.toFixed(4)]),
    e: st.graph.edges,
  });
  const g1 = snap();
  const isWeekly1 = st.isWeekly;
  const diff1 = st.diff;
  window.__rw.debugStartWeekly();                 // 同一周再进一次
  await new Promise(r => setTimeout(r, 250));
  const g2 = snap();
  window.__rw.endRound(false);
  await new Promise(r => setTimeout(r, 150));
  const after = window.__rw.weeklyInfo();
  const statusText = document.getElementById('weekly-status').textContent;
  const statsText = document.getElementById('end-stats').textContent;
  const posterUrl = window.__rw.buildPosterDataURL();
  return { info, sameGraph: g1 === g2, isWeekly1, diff1, after, statusText, statsText, posterOk: posterUrl.startsWith('data:image/png') && posterUrl.length > 20000 };
})()`);
ok(/^\d{4}-W\d{2}$/.test(weekly.info.key), `周键格式 ${weekly.info.key}`);
ok(weekly.sameGraph, '同一周重复进入 → 完全相同词图');
ok(weekly.isWeekly1 === true, '每周挑战标记正确');
ok(['easy', 'normal', 'hard'].includes(weekly.diff1), `周难度合法（${weekly.diff1}）`);
ok(weekly.after.status.played === true, '完成后记录本周已挑战');
ok(weekly.statusText.includes('本周已完成'), `引导页显示本周状态「${weekly.statusText}」`);
ok(weekly.statsText.includes('每周挑战'), `结算页标明每周挑战「${weekly.statsText}」`);
ok(weekly.posterOk, '海报可正常生成（含生涯成就行）');

console.log('\n[25] 成就飘字 & 每周本地榜');
const toast = await evalJs(`(async () => {
  const st = window.__rw.state;
  st.unlocked = [];                       // 清空已解锁，模拟首次
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 220));
  window.__rw.endRound(true);
  await new Promise(r => setTimeout(r, 200));
  const el = document.getElementById('ach-toast');
  const first = { shown: el.classList.contains('show'), text: el.textContent };
  // 再次胜利：成就已解锁，不应再次提示
  el.classList.remove('show');
  window.__rw.startRound('normal');
  await new Promise(r => setTimeout(r, 220));
  window.__rw.endRound(true);
  await new Promise(r => setTimeout(r, 200));
  const second = { shown: el.classList.contains('show') };
  // 周榜
  const month = window.__rw.debugOpenMonth();
  const weekChips = document.querySelectorAll('#week-board .week-chip').length;
  const firstWeekPlayed = document.querySelector('#week-board .week-chip')?.classList.contains('played');
  const monthText = document.getElementById('month-summary').textContent;
  window.__rw.debugCloseMonth();
  return { first, second, weekChips, firstWeekPlayed, weekRows: month.weekRows, monthText, hist: st.weeklyHistory.length };
})()`);
ok(toast.first.shown && toast.first.text.includes('新成就'), `首次解锁显示飘字「${toast.first.text}」`);
ok(toast.first.text.includes('抵达 1024'), '飘字包含成就名称');
ok(!toast.second.shown, '已解锁的成就不再重复提示');
ok(toast.weekChips === 8 && toast.weekRows === 8, `月视图显示最近 8 周榜（${toast.weekChips}）`);
ok(toast.firstWeekPlayed === true, '本周榜第一格标记为已挑战');
ok(toast.monthText.includes('周最佳'), `月视图显示周最佳「${toast.monthText}」`);

console.log('\n[26] 周报海报');
const weeklyPoster = await evalJs(`(() => {
  const url = window.__rw.debugWeeklyPoster();
  return { prefix: url.slice(0, 22), len: url.length };
})()`);
ok(weeklyPoster.prefix.startsWith('data:image/png'), '周报是 PNG data URL');
ok(weeklyPoster.len > 30000, `周报图片有实际内容（${Math.round(weeklyPoster.len / 1024)}KB）`);
const csv = await evalJs(`window.__rw.debugWeeklyCsv()`);
const csvLines = csv.trim().split('\n');
ok(csvLines[0] === 'week,score,win', 'CSV 表头正确');
ok(csvLines.length === 9, `CSV 共 8 周数据（${csvLines.length - 1} 行）`);

console.log('\n[27] 成就卡 & 冠军成就');
const cards = await evalJs(`(async () => {
  const st = window.__rw.state;
  const url = window.__rw.debugAchievementCard();
  // 日冠军：清空后赢一局每日挑战
  st.unlocked = [];
  window.__rw.debugStartDaily();
  await new Promise(r => setTimeout(r, 220));
  window.__rw.endRound(true);
  await new Promise(r => setTimeout(r, 200));
  const ach = window.__rw.achievementInfo();
  return { prefix: url.slice(0, 22), len: url.length, hasDailyWin: ach.unlocked.includes('dailyWin') };
})()`);
ok(cards.prefix.startsWith('data:image/png'), '成就卡是 PNG data URL');
ok(cards.len > 30000, `成就卡有实际内容（${Math.round(cards.len / 1024)}KB）`);
ok(cards.hasDailyWin, '每日挑战获胜解锁「日冠军」');

console.log('\n[28] 生涯统计面板');
const statsPanel = await evalJs(`(() => {
  const st = window.__rw.state;
  st.history = [
    { win: true, score: 30, steps: 8, words: 5, diff: 'easy', ts: 1 },
    { win: false, score: 10, steps: 12, words: 3, diff: 'hard', ts: 2 },
  ];
  const s = window.__rw.debugOpenStats();
  const items = document.querySelectorAll('#stats-grid .stat-item').length;
  const text = document.getElementById('stats-grid').textContent;
  const closed = window.__rw.debugCloseStats();
  return { s, items, text, closed };
})()`);
ok(statsPanel.s.total === 2 && statsPanel.s.winRate === 50 && statsPanel.s.best === 30, '统计数值正确', JSON.stringify(statsPanel.s));
ok(statsPanel.items === 10, `统计面板 10 项（${statsPanel.items}）`);
ok(statsPanel.text.includes('50%') && statsPanel.text.includes('30'), '面板显示胜率与最佳');
ok(statsPanel.closed, '统计面板可关闭');
const qr = await evalJs(`(() => { const q = window.__rw.debugQr(); const card = window.__rw.debugStatsCard(); return { q, len: card.length, prefix: card.slice(0, 22) }; })()`);
ok(qr.q.modules >= 21, `二维码模块数 ${qr.q.modules}`);
ok(qr.prefix.startsWith('data:image/png') && qr.len > 30000, `统计卡生成（${Math.round(qr.len / 1024)}KB，含二维码）`);
const shares = await evalJs(`({ stats: window.__rw.debugShareStats(), ach: window.__rw.debugShareAch(), weekly: window.__rw.debugShareWeekly() })`);
ok(shares.stats.includes('《拾径》') && shares.stats.includes('http'), '统计分享文案含链接');
ok(shares.ach.includes('/16'), `成就分享文案「${shares.ach.slice(0, 48)}…」`);
ok(shares.weekly.includes('《拾径》') && shares.weekly.includes('http'), '周报分享文案含链接');

console.log('\n[29] 渲染帧检查（drawcall + 游戏中截图）');
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
