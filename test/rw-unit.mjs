// 拾径 Wordloom — 纯逻辑单元测试（不启动浏览器，毫秒级）
// 用法: node test/rw-unit.mjs
//
// 覆盖四层：
//   A. 图生成不变量（多随机种子 × 多难度）
//   B. 规则层边界（计分/成就/路径诗/一言/结算汇总）
//   C. 数据完整性（词库/一言/皮肤/音色/难度/成就）
//   D. 合批几何正确性（边缓冲 / 词球烘焙 / 顶点色回写）
import { generateGraph } from '../public/rw/js/graph.mjs';
import fs from 'node:fs';
import { WORDS, FLAVORS, QUOTES, SKINS, TIMBRES, DIFFICULTIES, ACHIEVEMENTS, SCORE, WORD_PACKS, PACK_KEYS, TOTAL_WORDS, normalizePack } from '../public/rw/js/data.mjs';
import {
  scoreForWalk, finalScore, achievementsFor, pathPoem, pickQuote, buildResult,
  snapTurn, normalizeYaw, MOVE_MODES, normalizeMoveMode, nextMoveMode,
} from '../public/rw/js/rules.mjs';
import {
  buildEdgeGeometry, paintEdges, buildNodeSpheres, recolorNode,
} from '../public/rw/js/geometry.mjs';
import { posterContent, drawPoster, POSTER_SIZE } from '../public/rw/js/poster.mjs';
import { buildMenuLayout, hitTestMenu, isSelected, drawMenu, MENU_W, MENU_H } from '../public/rw/js/menu.mjs';
import {
  renderTonePCM, toneKey, stepFreq, bearing, NOTE_PENTA,
} from '../public/rw/js/spatial.mjs';
import { buildReplayPath, replayAt, replayDuration } from '../public/rw/js/replay.mjs';
import {
  dailyKey, dailySeed, dailyDifficulty, parseDaily, dailyStatus, dailyRecord,
  parseDailyHistory, appendDailyHistory, dailyBoard, DAILY_HISTORY_LIMIT,
} from '../public/rw/js/daily.mjs';
import { vignetteOpacity, clampVolume, volumeToPercent, seatedOffset } from '../public/rw/js/comfort.mjs';
import { barLayout, chartSummary } from '../public/rw/js/chart.mjs';
import { exportSave, importSave, resetValues, SAVE_VERSION, SAVE_APP } from '../public/rw/js/save.mjs';
import { hexToRgb, relativeLuminance, contrastRatio, auditSkin, auditAllSkins } from '../public/rw/js/a11y.mjs';
import { TUTORIAL_STEPS, parseTutorialDone, shouldShowTutorial, tutorialDoneValue } from '../public/rw/js/tutorial.mjs';
import { tr, normalizeLang, EN } from '../public/rw/js/i18n.mjs';
import {
  makeRecord, appendRecord, summarize, isValidRecord, parseHistory, serializeHistory,
  summaryLine, HISTORY_LIMIT,
  parseCollection, serializeCollection, addToCollection, collectionProgress, diffsWon,
} from '../public/rw/js/stats.mjs';

let pass = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; return; }
  failures.push(`${name}${extra ? ' — ' + extra : ''}`);
  console.log(`  ✗ ${name} ${extra}`);
}
function eq(actual, expected, name) {
  ok(Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
    name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function section(title) { console.log(`\n[${title}]`); }

// ═══════════════════ A. 图生成不变量 ═══════════════════

section('A. 图生成不变量');

function bfsReaches(graph) {
  const adj = Array.from({ length: graph.nodes.length }, () => []);
  for (const [a, b] of graph.edges) { adj[a].push(b); adj[b].push(a); }
  const seen = new Set([graph.startIdx]);
  const q = [graph.startIdx];
  while (q.length) {
    const u = q.pop();
    for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); q.push(v); }
  }
  return { seen, adj };
}

{
  const SEEDS = 200;
  let badConnect = 0, badDegree = 0, badIndex = 0, badDup = 0, badSelf = 0;
  let badPos = 0, badCount = 0, minGapViolations = 0;
  let minTrunk = Infinity, maxTrunk = -Infinity;

  for (let seed = 1; seed <= SEEDS; seed++) {
    const diff = DIFFICULTIES[seed % DIFFICULTIES.length];
    const g = generateGraph({ words: WORDS, steps: diff.steps, seed: seed * 7919, wordCount: 14 + diff.steps });
    const { seen, adj } = bfsReaches(g);

    if (!seen.has(g.goalIdx)) badConnect++;
    if (adj.some((a) => a.length === 0)) badDegree++;

    const n = g.nodes.length;
    for (const [a, b] of g.edges) {
      if (!(a >= 0 && a < n && b >= 0 && b < n)) badIndex++;
      if (a === b) badSelf++;
    }
    const keys = new Set(g.edges.map(([a, b]) => (a < b ? `${a}_${b}` : `${b}_${a}`)));
    if (keys.size !== g.edges.length) badDup++;

    for (const nd of g.nodes) {
      const { x, y, z } = nd.pos;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) badPos++;
    }

    // 节点数 = 起点 + 终点 + 主干中间词 + 旁支词
    const expected = 2 + g.trunkLen + (n - 2 - g.trunkLen);
    if (expected !== n) badCount++;

    // 主干长度落在 [4, steps-2]
    if (g.trunkLen < 4 || g.trunkLen > diff.steps - 2) badCount++;
    minTrunk = Math.min(minTrunk, g.trunkLen);
    maxTrunk = Math.max(maxTrunk, g.trunkLen);

    // 旁支词节点与其他任何节点保持间距（graph.mjs 的 1.35m 阈值，留浮点余量）
    const trunkSet = new Set();
    for (let i = 0; i <= g.trunkLen; i++) trunkSet.add(i + (i === 0 ? 0 : 1)); // 0=start，其余 i+1
    for (let i = 2 + g.trunkLen; i < n; i++) {
      for (let j = 0; j < i; j++) {
        if (g.nodes[i].pos.distanceTo(g.nodes[j].pos) < 1.3) { minGapViolations++; break; }
      }
    }

    // 起点/终点位置约定
    if (Math.abs(g.nodes[g.startIdx].pos.y - 0.5) > 1e-6) badPos++;
    if (Math.abs(g.nodes[g.goalIdx].pos.y - 1.5) > 1e-6) badPos++;
  }

  eq(badConnect, 0, `${SEEDS} 个种子全部 start→goal 连通`);
  eq(badDegree, 0, `${SEEDS} 个种子无孤立节点`);
  eq(badIndex, 0, '边索引全部在节点范围内');
  eq(badSelf, 0, '无自环');
  eq(badDup, 0, '无重复边');
  eq(badPos, 0, '坐标全部有限且起终点位置符合约定');
  eq(badCount, 0, '节点数与主干长度符合生成规则');
  eq(minGapViolations, 0, '旁支词节点最小间距 ≥1.3m（防词牌重叠）');
  console.log(`    主干长度范围 ${minTrunk}~${maxTrunk}`);
}

{
  // 确定性：同种子 → 完全相同的图
  const a = generateGraph({ words: WORDS, steps: 12, seed: 424242, wordCount: 26 });
  const b = generateGraph({ words: WORDS, steps: 12, seed: 424242, wordCount: 26 });
  eq(JSON.stringify(a.nodes.map((n) => [n.word, n.pos.x, n.pos.y, n.pos.z])),
    JSON.stringify(b.nodes.map((n) => [n.word, n.pos.x, n.pos.y, n.pos.z])),
    '同种子生成的节点完全一致（可复现）');
  eq(JSON.stringify(a.edges), JSON.stringify(b.edges), '同种子生成的边完全一致');

  // 不同种子 → 不同图
  const c = generateGraph({ words: WORDS, steps: 12, seed: 999, wordCount: 26 });
  const diffCount = a.nodes.filter((n, i) => c.nodes[i] && Math.abs(n.pos.z - c.nodes[i].pos.z) > 1e-6).length;
  ok(diffCount > 0, '不同种子生成不同布局', `差异节点 ${diffCount}`);
}

{
  // degree 字段与真实邻接一致
  const g = generateGraph({ words: WORDS, steps: 12, seed: 2024, wordCount: 20 });
  const { adj } = bfsReaches(g);
  const mismatched = g.nodes.filter((nd, i) => nd.degree !== adj[i].length).length;
  eq(mismatched, 0, 'degree 字段与邻接表一致');
}

// ═══════════════════ B. 规则层边界 ═══════════════════

section('B. 规则层边界');

eq(scoreForWalk({ firstCollect: true }), SCORE.word, '首次收录得分 = SCORE.word');
eq(scoreForWalk({ firstCollect: false }), 0, '重复经过同一词不得分');

eq(finalScore({ win: false, stepsLeft: 0, wordCount: 3 }), 0, '失败且收录不足 → 0 分');
eq(finalScore({ win: true, stepsLeft: 0, wordCount: 3 }), SCORE.win, '胜利基础分');
eq(finalScore({ win: true, stepsLeft: 4, wordCount: 3 }), SCORE.win + 4 * SCORE.stepLeft, '胜利 + 剩余步数奖励');
eq(finalScore({ win: true, stepsLeft: 4, wordCount: 3, unlimited: true }), SCORE.win, '无限步彩蛋下不给步数奖励（防刷分）');
eq(finalScore({ win: true, stepsLeft: 0, wordCount: 10 }), SCORE.win + 50, '收录 ≥10 词额外 +50');
eq(finalScore({ win: false, stepsLeft: 3, wordCount: 10 }), 50, '失败但仍收录 ≥10 词 → 只给收录奖励');

{
  const names = (a) => a.map((x) => x.name);
  eq(names(achievementsFor({ win: true, stepsLeft: 5, wordCount: 3 })), ['抵达 1024', '从容不迫'], '胜利 + 剩 5 步 → 两成就');
  eq(names(achievementsFor({ win: true, stepsLeft: 4, wordCount: 3 })), ['抵达 1024'], '剩 4 步 → 无「从容不迫」（边界）');
  eq(names(achievementsFor({ win: true, stepsLeft: 5, wordCount: 3, unlimited: true })), ['抵达 1024', '1024 之魂'], '无限步不给从容、给彩蛋成就');
  eq(names(achievementsFor({ win: false, stepsLeft: 0, wordCount: 10 })), ['字字珠玑', '信步由缰'], '失败 + 10 词 → 字字珠玑 + 信步由缰（可叠加）');
  eq(names(achievementsFor({ win: false, stepsLeft: 0, wordCount: 6 })), ['信步由缰'], '失败 + 6 词 → 信步由缰（边界）');
  eq(names(achievementsFor({ win: false, stepsLeft: 0, wordCount: 5 })), [], '失败 + 5 词 → 无成就');
  eq(names(achievementsFor({ win: false, stepsLeft: 0, wordCount: 0, unlimited: true })), ['1024 之魂'], '仅彩蛋成就');
}

{
  eq(pathPoem(['光', '熵', '光', '梦']), { poem: '光 · 熵 · 梦', words: ['光', '熵', '梦'] }, '路径诗去重保序');
  eq(pathPoem([]).poem, '（一条无言的路）', '空路径的兜底文案');
  const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const p = pathPoem(nine);
  eq(p.words.length, 9, '词表保留全部（供结算展示）');
  ok(p.poem.endsWith('…'), '超过 8 个词时截断并加省略号', p.poem);
}

{
  eq(pickQuote(() => 0), { flavor: '哲思', text: QUOTES['哲思'][0] }, 'rand=0 → 第一类第一句');
  const last = pickQuote(() => 0.999999);
  eq(last.flavor, FLAVORS[FLAVORS.length - 1], 'rand≈1 → 最后一类');
  // 边界：rand 恰好返回 1 也不能越界（数组 undefined）
  const edge = pickQuote(() => 1);
  ok(edge.flavor && edge.text, 'rand=1 不越界', JSON.stringify(edge));
}

{
  const r = buildResult({
    win: true, visitedWords: ['光', '熵', '光'], collected: ['光', '熵'], steps: 3, stepsLeft: 6,
    quote: { flavor: '极客', text: '测试' },
  });
  eq(r.wordCount, 2, '结算收录数按去重计');
  eq(r.poem, '光 · 熵', '结算路径诗');
  eq(r.steps, 3, '结算步数透传');
  eq(r.quote.flavor, '极客', '外部指定一言优先');
  eq(r.achievements.map((a) => a.name), ['抵达 1024', '从容不迫'], '结算成就');
  eq(r.bonus, SCORE.win + 6 * SCORE.stepLeft, '结算附加分');
}

// ═══════════════════ C. 数据完整性 ═══════════════════

section('C. 数据完整性');

ok(WORDS.length >= 40, `词库规模 ${WORDS.length} ≥ 40`);
eq(new Set(WORDS).size, WORDS.length, '词库无重复词');
ok(WORDS.every((w) => typeof w === 'string' && w.length >= 1 && w.length <= 4), '每个词为 1–4 字符');
ok(WORDS.every((w) => !/\s/.test(w)), '词内无空白字符（保证标签排版）');

eq(FLAVORS.length, 5, '五种一言口味');
eq(Object.keys(QUOTES).sort().join(','), [...FLAVORS].sort().join(','), 'QUOTES 键与 FLAVORS 完全对应');
ok(FLAVORS.every((f) => Array.isArray(QUOTES[f]) && QUOTES[f].length >= 3), '每种口味至少 3 句');
ok(Object.values(QUOTES).flat().every((q) => typeof q === 'string' && q.trim().length > 0), '一言非空');

{
  const need = ['name', 'bg', 'fog', 'floor', 'grid1', 'grid2', 'line', 'trail', 'word', 'wordVisited', 'start', 'goal', 'halo'];
  for (const [key, s] of Object.entries(SKINS)) {
    const missing = need.filter((k) => s[k] === undefined);
    eq(missing.length, 0, `皮肤 ${key} 字段完整`, missing.join(','));
    ok(need.filter((k) => k !== 'name').every((k) => typeof s[k] === 'number'), `皮肤 ${key} 颜色均为数字`);
  }
  ok(Object.keys(SKINS).length >= 3, '至少 3 套皮肤');
}

for (const [key, t] of Object.entries(TIMBRES)) {
  ok(t.name, `音色 ${key} 有名称`);
  for (const ev of ['step', 'collect', 'ui']) {
    ok(t[ev] && typeof t[ev].type === 'string' && t[ev].gain > 0, `音色 ${key}.${ev} 参数完整`);
    ok(['sine', 'square', 'triangle', 'sawtooth'].includes(t[ev].type), `音色 ${key}.${ev} 振荡器类型合法`);
  }
}

{
  eq(new Set(DIFFICULTIES.map((d) => d.key)).size, DIFFICULTIES.length, '难度 key 唯一');
  const steps = DIFFICULTIES.map((d) => d.steps);
  ok(steps.every((s) => s >= 6 && s <= 30), '难度步数在合理区间');
  ok(steps[0] > steps[1] && steps[1] > steps[2], '难度步数严格递减', JSON.stringify(steps));
  ok(DIFFICULTIES.every((d) => d.name), '难度都有显示名');
}

ok(Object.values(ACHIEVEMENTS).every((a) => a.icon && a.name), '成就均有图标与名称');
ok(new Set(Object.values(ACHIEVEMENTS).map((a) => a.name)).size === Object.keys(ACHIEVEMENTS).length, '成就名称唯一');
ok([SCORE.word, SCORE.stepLeft, SCORE.win].every((v) => typeof v === 'number' && v > 0), '计分常量均为正数');

// ═══════════════════ D. 合批几何 ═══════════════════

section('D. 合批几何');

{
  const nodes = [
    { pos: { x: 0, y: 0, z: 0 } },
    { pos: { x: 1, y: 2, z: 3 } },
    { pos: { x: -1, y: 0.5, z: 2 } },
  ];
  const edges = [[0, 1], [1, 2]];
  const eg = buildEdgeGeometry(nodes, edges);
  eq(eg.edgeCount, 2, '边数');
  eq(eg.positions.length, 2 * 6, '边缓冲长度 = 边数×2 顶点×3');
  eq([...eg.positions.slice(0, 3)], [0, 0, 0], '边 0 起点坐标');
  eq([...eg.positions.slice(3, 6)], [1, 2, 3], '边 0 终点坐标');
  eq([...eg.positions.slice(6, 9)], [1, 2, 3], '边 1 起点坐标');

  paintEdges(eg.colors, 2, (k) => (k === 1 ? [1, 0, 0] : [0, 1, 0]));
  eq([...eg.colors.slice(0, 3)], [0, 1, 0], '边 0 起点色');
  eq([...eg.colors.slice(3, 6)], [0, 1, 0], '边 0 两端同色');
  eq([...eg.colors.slice(6, 9)], [1, 0, 0], '边 1 染色正确');

  let threw = false;
  try { buildEdgeGeometry([{ pos: { x: 0, y: 0, z: 0 } }], [[0, 5]]); } catch { threw = true; }
  ok(threw, '非法边引用应抛错（防止静默画出错误连线）');
}

{
  const N = 5, SEG = 8, RINGS = 6;
  const nodes = Array.from({ length: N }, (_, i) => ({ pos: { x: i, y: i * 0.5, z: -i } }));
  const radii = nodes.map((_, i) => 0.1 + i * 0.01);
  const geo = buildNodeSpheres(nodes, {
    radiusOf: (i) => radii[i],
    colorOf: () => [0.8, 0.9, 1],
    segments: SEG,
    rings: RINGS,
  });

  const perVerts = (RINGS + 1) * (SEG + 1);
  const perTris = RINGS * SEG * 2 - SEG * 2;
  eq(geo.perNodeVerts, perVerts, '每节点顶点数公式');
  eq(geo.perNodeTris, perTris, '每节点三角形数公式');
  eq(geo.vertexCount, N * perVerts, '总顶点数');
  eq(geo.triangleCount, N * perTris, '总三角形数');
  eq(geo.faceToNode.length, geo.triangleCount, '三角形→节点映射长度一致');
  eq(geo.colors.length, geo.vertexCount * 3, '顶点色长度');
  ok(geo.faceToNode.every((v) => v < N), '映射值全部在节点范围内');
  ok([...geo.indices].every((v) => v < geo.vertexCount), '索引全部在顶点范围内');

  // 顶点必须落在对应球面上
  let maxErr = 0;
  for (let i = 0; i < N; i++) {
    const rg = geo.ranges[i];
    for (let v = rg.vStart; v < rg.vStart + rg.vCount; v++) {
      const o = v * 3;
      const dx = geo.positions[o] - rg.center[0];
      const dy = geo.positions[o + 1] - rg.center[1];
      const dz = geo.positions[o + 2] - rg.center[2];
      maxErr = Math.max(maxErr, Math.abs(Math.hypot(dx, dy, dz) - radii[i]));
    }
  }
  ok(maxErr < 1e-4, '所有顶点精确落在球面上', `最大误差 ${maxErr.toExponential(2)}`);

  // 法线单位长
  let nErr = 0;
  for (let v = 0; v < geo.vertexCount; v++) {
    const o = v * 3;
    nErr = Math.max(nErr, Math.abs(Math.hypot(geo.normals[o], geo.normals[o + 1], geo.normals[o + 2]) - 1));
  }
  ok(nErr < 1e-5, '法线均为单位向量', `最大误差 ${nErr.toExponential(2)}`);

  ok([...geo.colors].every((c) => c >= 0 && c <= 1), '烘焙顶点色全部落在 [0,1]');

  // ranges 覆盖全部顶点、无重叠
  let cursor = 0, contiguous = true;
  for (let i = 0; i < N; i++) {
    if (geo.ranges[i].vStart !== cursor) contiguous = false;
    cursor += geo.ranges[i].vCount;
  }
  ok(contiguous && cursor === geo.vertexCount, '各节点顶点区间连续覆盖且无重叠');

  // 绕序正确性（回归：曾因绕序反向导致球面渲染背面、深度写在远侧，
  // 使穿过球体内部的边线错误地画在球前面）
  // 判据：三角形绕序算出的法线方向应与「质心 - 球心」同向（朝外，CCW 正面）。
  {
    let inward = 0, degenerate = 0;
    for (let t = 0; t < geo.triangleCount; t++) {
      const i0 = geo.indices[t * 3], i1 = geo.indices[t * 3 + 1], i2 = geo.indices[t * 3 + 2];
      const p = (k) => [geo.positions[k * 3], geo.positions[k * 3 + 1], geo.positions[k * 3 + 2]];
      const [ax, ay, az] = p(i0), [bx, by, bz] = p(i1), [cx, cy, cz] = p(i2);
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) { degenerate++; continue; }
      const nodeIdx = geo.faceToNode[t];
      const ctr = geo.ranges[nodeIdx].center;
      const mx = (ax + bx + cx) / 3 - ctr[0];
      const my = (ay + by + cy) / 3 - ctr[1];
      const mz = (az + bz + cz) / 3 - ctr[2];
      if (nx * mx + ny * my + nz * mz <= 0) inward++;
    }
    eq(inward, 0, '所有三角形绕序朝外（CCW 正面，深度写在近侧）');
    eq(degenerate, 0, '无退化三角形（面积为零的索引已剔除）');
  }

  // recolorNode 只影响目标节点
  const before = geo.colors.slice();
  const changed = recolorNode(geo.colors, geo.normals, geo.ranges, 2, { color: [1, 0, 0], brightness: 1 });
  ok(changed, 'recolorNode 返回成功');
  const rg2 = geo.ranges[2];
  let otherChanged = 0;
  for (let v = 0; v < geo.vertexCount; v++) {
    if (v >= rg2.vStart && v < rg2.vStart + rg2.vCount) continue;
    const o = v * 3;
    if (geo.colors[o] !== before[o] || geo.colors[o + 1] !== before[o + 1]) otherChanged++;
  }
  eq(otherChanged, 0, 'recolorNode 不影响其它节点颜色');
  eq(recolorNode(geo.colors, geo.normals, geo.ranges, 99, { color: [1, 1, 1] }), false, '越界索引返回 false');
}

{
  // 亮度语义：brightness 越大，同色顶点越亮（用于当前节点高亮）
  const nodes = [{ pos: { x: 0, y: 0, z: 0 } }];
  const dim = buildNodeSpheres(nodes, { colorOf: () => [0.5, 0.5, 0.5], brightnessOf: () => 0.4, segments: 6, rings: 4 });
  const lit = buildNodeSpheres(nodes, { colorOf: () => [0.5, 0.5, 0.5], brightnessOf: () => 1.0, segments: 6, rings: 4 });
  let allBrighter = true;
  for (let v = 0; v < dim.vertexCount; v++) {
    if (lit.colors[v * 3] < dim.colors[v * 3]) allBrighter = false;
  }
  ok(allBrighter, 'brightness 提升后每个顶点都不暗于原色（高亮语义正确）');
}

// ═══════════════════ E. 舒适性快转 & 海报 ═══════════════════

section('E. 快转 & 海报');

{
  const step = (30 * Math.PI) / 180;
  // 死区边界：0.74 不触发、0.75 触发
  eq(snapTurn({ x: 0.74 }).rot, 0, '摇杆 0.74 未过死区 → 不转');
  eq(snapTurn({ x: 0.75 }).rot, -step, '摇杆推到 0.75（右）→ 右转 30°');
  eq(snapTurn({ x: -0.9 }).rot, step, '摇杆向左 → 左转 30°');
  // 触发后必须回中
  eq(snapTurn({ x: 0.9, armed: false }).rot, 0, '未回中时同方向继续推 → 不再转（防转圈）');
  eq(snapTurn({ x: 0.5, armed: false }).rot, 0, '仍在死区内 → 不重新武装');
  eq(snapTurn({ x: 0.2, armed: false }), { rot: 0, armed: true }, '回到中位 → 重新武装');
  eq(snapTurn({ x: NaN }).rot, 0, 'NaN 输入不崩溃');
  eq(snapTurn({ x: Infinity }).rot, 0, 'Infinity 视为无效输入 → 不转（脏数据不乱转）');
  // Yaw 归一化
  eq(normalizeYaw(0), 0, 'yaw 0 保持');
  ok(Math.abs(normalizeYaw(Math.PI * 3) - Math.PI) < 1e-9, 'yaw 3π → π');
  ok(Math.abs(normalizeYaw(-Math.PI * 3) - Math.PI) < 1e-9, 'yaw -3π → π');
  ok(Math.abs(normalizeYaw(-Math.PI * 4)) < 1e-9, 'yaw -4π → 0');
}

{
  const base = {
    win: true, poem: '光 · 熵 · 梦', words: ['光', '熵', '梦'], wordCount: 3,
    quote: { flavor: '极客', text: '人生没有 undo' }, score: 190,
    achievements: [{ icon: '🏁', name: '抵达 1024' }], steps: 7,
  };
  const pc = posterContent(base, { round: 3 });
  eq(pc.title, '拾径', '海报标题');
  eq(pc.outcome, '抵达 1024', '胜利海报结果文案');
  eq(pc.poemLines, ['光 · 熵 · 梦'], '海报路径诗单行');
  eq(pc.quote, '「人生没有 undo」', '海报一言加引号');
  eq(pc.flavor, '—— 极客 一言', '海报口味标签');
  ok(pc.stats.includes('7 步') && pc.stats.includes('3 词') && pc.stats.includes('190 分'), '海报数据行', pc.stats);
  eq(pc.achievements, ['🏁 抵达 1024'], '海报成就');
  eq(pc.footer, '第 3 局 · Pico Neo3 VR', '海报页脚含局数');

  // 失败文案
  eq(posterContent({ ...base, win: false }).outcome, '路，未走完', '失败海报结果文案');
  // 超长路径分行：13 个词 → 每行 6 个 → 3 行
  const many = Array.from({ length: 13 }, (_, i) => `w${i}`);
  const pcm = posterContent({ ...base, words: many, wordCount: 13 });
  eq(pcm.poemLines.length, 3, '13 个词分 3 行');
  ok(pcm.poemLines[0].split(' · ').length === 6, '每行最多 6 个词');
  // 超过 4 行要截断并加省略号
  const tons = Array.from({ length: 40 }, (_, i) => `w${i}`);
  const pct = posterContent({ ...base, words: tons, wordCount: 40 });
  eq(pct.poemLines.length, 4, '最多 4 行');
  ok(pct.poemLines[3].endsWith('…'), '截断行带省略号');
  // 空路径
  eq(posterContent({ ...base, words: [], wordCount: 0 }).poemLines, ['（一条无言的路）'], '空路径兜底');
}

{
  // mock 2D context：断言「画出来的文字」包含全部关键内容
  const texts = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
    fillText(s) { texts.push(String(s)); },
    measureText(s) { return { width: String(s).length * 14 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    arcTo() {}, closePath() {}, fill() {},
  };
  const result = {
    win: true, words: ['银河', '熵', '梦'], wordCount: 3, steps: 6, score: 210,
    poem: '银河 · 熵 · 梦',
    quote: { flavor: '哲思', text: '每一步都是对无限可能的一次删减' },
    achievements: [{ icon: '🏁', name: '抵达 1024' }, { icon: '📿', name: '字字珠玑' }],
  };
  const { drawn, data } = drawPoster(ctx, result, { round: 1 });
  eq(POSTER_SIZE.width, 1080, '海报宽度 1080');
  eq(POSTER_SIZE.height, 1620, '海报高度 1620');
  ok(drawn.length > 8, `海报绘制文字条数 ${drawn.length} > 8`);
  ok(texts.includes('拾径'), '画出了标题');
  ok(texts.includes('抵达 1024'), '画出了结果');
  ok(texts.some((s) => s.includes('银河')), '画出了路径词');
  ok(texts.some((s) => s.includes('每一步都是对无限可能')), '画出了一言');
  ok(texts.some((s) => s.includes('6 步')), '画出了数据行');
  ok(texts.some((s) => s.includes('🏁 抵达 1024')), '画出了成就');
  eq(data.outcome, '抵达 1024', 'drawPoster 返回的数据与内容一致');
}

// ═══════════════════ F. VR 菜单布局与命中 ═══════════════════

section('F. VR 菜单');

{
  const { buttons, rowTitles, width, height } = buildMenuLayout();
  eq(width, MENU_W, '菜单宽度常量一致');
  eq(height, MENU_H, '菜单高度常量一致');
  eq(rowTitles.length, 4, '菜单 4 行（难度/皮肤/音色/移动）');
  eq(buttons.length, 12, '菜单按钮总数 = 3×3 + 移动×2 + 1 开始');

  // id 唯一
  eq(new Set(buttons.map((b) => b.id)).size, buttons.length, '按钮 id 唯一');

  // 全部在面板内
  const outOfBounds = buttons.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > MENU_W || b.y + b.h > MENU_H);
  eq(outOfBounds.length, 0, '所有按钮完整落在面板内', outOfBounds.map((b) => b.id).join(','));

  // 两两不重叠
  let overlaps = 0;
  for (let i = 0; i < buttons.length; i++) {
    for (let j = i + 1; j < buttons.length; j++) {
      const a = buttons[i], b = buttons[j];
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (ix > 0 && iy > 0) overlaps++;
    }
  }
  eq(overlaps, 0, '按钮之间无重叠（射线不会点错）');

  // 每个按钮中心点必中自己
  const misHit = [];
  for (const b of buttons) {
    const u = (b.x + b.w / 2) / MENU_W;
    const v = (b.y + b.h / 2) / MENU_H;
    const hit = hitTestMenu(buttons, u, v);
    if (hit !== b.id) misHit.push(`${b.id}→${hit}`);
  }
  eq(misHit.length, 0, '每个按钮中心命中自身', misHit.join(','));

  // 边角与越界
  eq(hitTestMenu(buttons, 0.005, 0.02), null, '标题区不命中任何按钮');
  eq(hitTestMenu(buttons, -0.1, 0.5), null, 'u 越界返回 null');
  eq(hitTestMenu(buttons, 0.5, 1.2), null, 'v 越界返回 null');
  eq(hitTestMenu(buttons, NaN, 0.5), null, 'NaN 返回 null');

  // 选中态
  ok(isSelected('diff:easy', { difficulty: 'easy' }), '难度选中态正确');
  ok(!isSelected('diff:hard', { difficulty: 'easy' }), '未选中的难度不高亮');
  ok(isSelected('skin:cinnabar', { skin: 'cinnabar' }), '皮肤选中态正确');
  ok(isSelected('timbre:chime', { timbre: 'chime' }), '音色选中态正确');
  ok(!isSelected('start', { difficulty: 'easy' }), '开始按钮不参与选中高亮');
}

{
  // drawMenu 用 mock context 断言所有标签都画出来
  const texts = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
    fillText(s) { texts.push(String(s)); },
    measureText(s) { return { width: String(s).length * 12 }; },
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, arcTo() {},
    closePath() {}, fill() {}, stroke() {},
  };
  const layout = drawMenu(ctx, { pendingDifficulty: 'hard', skin: 'celadon', timbre: 'chime' });
  ok(texts.includes('拾径 · 设置'), '菜单画出标题');
  for (const label of ['悠然', '标准', '紧绷', '墨', '朱砂', '青瓷', '木鱼', '电子', '风铃', '滑翔', '瞬移', '开始游走']) {
    ok(texts.includes(label), `菜单画出按钮「${label}」`);
  }
  eq(layout.buttons.length, 12, 'drawMenu 返回布局完整');
}

// ═══════════════════ G. 本地战绩统计 ═══════════════════

section('G. 本地战绩');

{
  // 记录生成：脏输入要能兜住
  const r = makeRecord({ win: 1, score: 120, steps: 8, words: 4, diff: 'hard', ts: 111 });
  eq(r.win, true, 'win 归一化为布尔');
  eq(r.score, 120, 'score 透传');
  eq(r.diff, 'hard', 'diff 透传');
  const bad = makeRecord({ win: null, score: NaN, steps: undefined, words: 'x', diff: 42 });
  ok(bad.win === false && bad.score === 0 && bad.steps === 0 && bad.words === 0, '脏输入全部归零', JSON.stringify(bad));
  eq(bad.diff, 'normal', '非法 diff 回落到 normal');
  ok(Number.isFinite(bad.ts), '缺失时间戳自动补');
}

{
  // 追加 + 裁剪：新的在前，超出上限丢最老
  let h = [];
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = appendRecord(h, { win: i % 2 === 0, score: i, steps: 1, words: 1 });
  eq(h.length, HISTORY_LIMIT, `历史上限 ${HISTORY_LIMIT} 条`);
  eq(h[0].score, HISTORY_LIMIT + 4, '最新记录在最前');
  eq(h[h.length - 1].score, 5, '最老的被裁掉');

  // 非数组输入容错
  eq(appendRecord(null, { win: true, score: 1, steps: 1, words: 1 }).length, 1, 'history 为 null 时按空处理');
  eq(appendRecord('bad', { win: true, score: 1, steps: 1, words: 1 }).length, 1, 'history 为字符串时按空处理');
  // 自定义上限
  eq(appendRecord([], { win: true, score: 1, steps: 1, words: 1 }, 1).length, 1, '支持自定义上限');
}

{
  // 汇总统计
  const h = [
    { win: true, score: 300, steps: 10, words: 8, diff: 'normal' },
    { win: false, score: 120, steps: 12, words: 5, diff: 'hard' },
    { win: true, score: 200, steps: 8, words: 11, diff: 'hard' },
    { win: false, score: 90, steps: 9, words: 3, diff: 'easy' },
  ];
  const s = summarize(h);
  eq(s.rounds, 4, '局数');
  eq(s.wins, 2, '胜局数');
  eq(s.winRate, 0.5, '胜率');
  eq(s.bestScore, 300, '最佳分');
  eq(s.bestWords, 11, '单局最多收录');
  eq(s.totalSteps, 39, '总步数');
  eq(s.avgSteps, 9.8, '平均步数');
  eq(s.lastWin, 0, '最近一次胜利的下标');
  eq(s.byDiff.hard.rounds, 2, 'hard 局数');
  eq(s.byDiff.hard.wins, 1, 'hard 胜局');
  eq(s.byDiff.hard.best, 200, 'hard 最佳分');
  eq(s.byDiff.easy.best, 90, 'easy 最佳分');

  const empty = summarize([]);
  eq(empty.rounds, 0, '空历史局数 0');
  eq(empty.winRate, 0, '空历史胜率 0（不产生 NaN）');
  eq(empty.lastWin, -1, '空历史 lastWin = -1');
  eq(summarize(null).rounds, 0, 'summarize(null) 安全');
  // 脏记录被过滤
  eq(summarize([{ win: true }, null, 'x', h[0]]).rounds, 1, '脏记录不参与统计');
}

{
  // 序列化 / 解析容错
  const good = [{ win: true, score: 10, steps: 5, words: 2, diff: 'easy' }];
  const round = parseHistory(serializeHistory(good));
  eq(round.length, 1, '序列化往返');
  eq(round[0].score, 10, '往返后字段一致');

  eq(parseHistory('').length, 0, '空字符串 → 空历史');
  eq(parseHistory('not json').length, 0, '坏 JSON → 空历史');
  eq(parseHistory('{"a":1}').length, 0, '非数组 JSON → 空历史');
  eq(parseHistory('[{"win":true}]').length, 0, '元素缺字段被过滤');
  ok(isValidRecord({ win: false, score: 0, steps: 0, words: 0 }), '合法记录判定');
  ok(!isValidRecord({ win: 'yes', score: 0, steps: 0, words: 0 }), '非法 win 类型被拒');

  // 摘要文案
  eq(summaryLine({ rounds: 0 }), '', '无战绩时摘要为空串');
  eq(summaryLine(summarize(good)), '历史 1 局 · 胜率 100% · 最佳 10', '摘要文案格式');
}

// ═══════════════════ H. 词集收藏 ═══════════════════

section('H. 词集收藏');

{
  // 解析容错
  eq(parseCollection('').length, 0, '空串 → 空词集');
  eq(parseCollection('oops').length, 0, '坏 JSON → 空词集');
  eq(parseCollection('{"a":1}').length, 0, '非数组 → 空词集');
  eq(parseCollection('["光","光","熵",null,3,""]').join(','), '光,熵', '去重并过滤非字符串/空串');
  eq(parseCollection(serializeCollection(['梦', '光', '梦'])).join(','), '梦,光', '序列化往返并去重');
  eq(serializeCollection(null), '[]', '序列化 null 安全');
}

{
  // 新增收录
  const r1 = addToCollection(['光'], ['熵', '光', '梦']);
  eq(r1.added.join(','), '熵,梦', '只有新词进入 added');
  eq(r1.collection.sort().join(','), '光,熵,梦'.split(',').sort().join(','), '词集合并正确');
  const r2 = addToCollection(null, ['光']);
  eq(r2.collection.length, 1, 'collection 为 null 时按空处理');
  eq(addToCollection(['光'], []).added.length, 0, '空输入不新增');
  eq(addToCollection(['光'], ['光']).added.length, 0, '重复词不重复计数');
  // 脏元素
  eq(addToCollection([], ['', null, '光', 3]).added.length, 1, '脏元素被忽略');
}

{
  // 进度
  eq(collectionProgress([], 60), { collected: 0, total: 60, ratio: 0 }, '空词集进度 0');
  eq(collectionProgress(['光', '熵'], 60).ratio, 0.033, '部分进度比例');
  eq(collectionProgress(['光', '熵'], 60).collected, 2, '已收集数');
  eq(collectionProgress(new Array(80).fill('光'), 60).collected, 1, '重复词只算一次');
  const over = collectionProgress(Array.from({ length: 80 }, (_, i) => `w${i}`), 60);
  eq(over.collected, 60, '超过词库上限时封顶，不出现 >100%');
  eq(over.ratio, 1, '集满时比例恰为 1');
  eq(collectionProgress([], 0).total, 1, '非法 total 兜底为 1（避免除零）');
  eq(collectionProgress(null, 60).collected, 0, 'null 词集安全');
}

// ═══════════════════ I. 空间音效 / 路径回放 / 跨难度成就 ═══════════════════

section('I. 空间音效');

{
  const sr = 48000;
  const pcm = renderTonePCM({ freq: 440, duration: 0.1, sampleRate: sr, gain: 0.8 });
  eq(pcm.length, Math.round(0.1 * sr), '采样点数 = 时长 × 采样率');
  eq(pcm[0], 0, '首样本归零（防爆音）');
  eq(pcm[pcm.length - 1], 0, '末样本归零');
  const peak = Math.max(...pcm.map(Math.abs));
  ok(peak > 0.05, '波形非静音', `peak=${peak.toFixed(3)}`);
  ok(peak <= 1, '幅度不超过 1（不削波）', `peak=${peak.toFixed(3)}`);

  // 包络：起始段（起音后）应比尾段响
  const early = Math.max(...pcm.slice(Math.round(0.01 * sr), Math.round(0.03 * sr)).map(Math.abs));
  const late = Math.max(...pcm.slice(Math.round(0.08 * sr), Math.round(0.095 * sr)).map(Math.abs));
  ok(early > late, '指数衰减包络成立（前段响于尾段）', `${early.toFixed(3)} vs ${late.toFixed(3)}`);

  // 波形差异
  const sine = renderTonePCM({ freq: 440, duration: 0.05, type: 'sine' });
  const square = renderTonePCM({ freq: 440, duration: 0.05, type: 'square' });
  const diff = sine.reduce((s, v, i) => s + Math.abs(v - square[i]), 0);
  ok(diff > 1, '不同波形产生不同 PCM', `diff=${diff.toFixed(2)}`);

  // 参数兜底
  const bad = renderTonePCM({ freq: 0, duration: 0, sampleRate: 100, gain: 5 });
  ok(bad.length > 0 && Math.max(...bad.map(Math.abs)) <= 1, '非法参数被兜底且不越界');
  const silent = renderTonePCM({ freq: 440, duration: 0.02, gain: 0 });
  ok(silent.every((v) => v === 0), 'gain=0 → 全零');

  // 缓存键
  eq(toneKey({ freq: 880, duration: 0.12 }), toneKey({ freq: 880, duration: 0.12 }), '相同参数缓存键一致');
  ok(toneKey({ freq: 880 }) !== toneKey({ freq: 660 }), '不同频率缓存键不同');

  // 五声音阶
  eq(stepFreq(0), NOTE_PENTA[0], 'stepFreq(0) = 宫');
  eq(stepFreq(NOTE_PENTA.length), NOTE_PENTA[0], 'stepFreq 越界回绕');
  eq(stepFreq(-1), NOTE_PENTA[1], '负索引取绝对模');
  eq(stepFreq(NaN), NOTE_PENTA[0], 'NaN 兜底到宫');

  // 方位角
  const fwd = bearing({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -2 });
  ok(Math.abs(fwd.azimuth) < 1e-9 && Math.abs(fwd.distance - 2) < 1e-9, '正前方方位角 0、距离 2');
  const right = bearing({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
  ok(Math.abs(right.azimuth - Math.PI / 2) < 1e-9, '右侧方位角 +90°');
  eq(bearing(null, null), { azimuth: 0, distance: 0 }, '空输入安全');
}

section('I. 路径回放');

{
  const nodes = [
    { pos: { x: 0, y: 0.5, z: -1 } },
    { pos: { x: 1, y: 0.9, z: -2 } },
    { pos: { x: -1, y: 1.2, z: -3 } },
  ];
  const path = buildReplayPath([0, 1, 2], nodes, { height: 0 });
  eq(path.length, 3, '路径点数 = 访问点数');
  ok(path.every((p) => p.y === 0), '回放高度统一（镜头平稳）');
  eq(path[1].x, 1, '坐标透传');
  eq(path[1].z, -2, '深度透传');
  eq(buildReplayPath([0, 9], nodes).length, 1, '非法索引被跳过');
  eq(buildReplayPath(null, nodes).length, 0, '空序列安全');

  eq(replayDuration(path, { segmentMs: 500 }), 1000, '总时长 = 段数 × 段时长');
  eq(replayDuration([1], {}), 0, '单点无时长');
  eq(replayDuration([], {}), 0, '空路径无时长');

  const a0 = replayAt(path, 0, { segmentMs: 500 });
  ok(a0.pos.x === 0 && a0.pos.z === -1 && a0.done === false, '起点取样正确', JSON.stringify(a0.pos));
  const aMid = replayAt(path, 250, { segmentMs: 500 });
  ok(aMid.index === 0 && aMid.t > 0.4 && aMid.t < 0.6, '半段时仍在前一段中点附近');
  ok(aMid.pos.y > 0.01, '中段有轻微起伏（lift）', String(aMid.pos.y.toFixed(3)));
  const a1 = replayAt(path, 500, { segmentMs: 500 });
  ok(a1.index === 1 && a1.t < 0.01 && a1.pos.x === 1, '到点后进入下一段起点', JSON.stringify(a1.pos));
  const aEnd = replayAt(path, 5000, { segmentMs: 500 });
  ok(aEnd.done === true && aEnd.pos.x === -1 && aEnd.pos.z === -3, '超时后停在终点并标记完成');
  eq(replayAt([], 100).done, true, '空路径直接完成');
  eq(replayAt([{ x: 1, y: 0, z: 0 }], 100).done, true, '单点路径直接完成');
  const neg = replayAt(path, -50, { segmentMs: 500 });
  ok(neg.pos.x === 0 && neg.done === false, '负数时间按 0 处理');
  eq(replayAt(path, NaN).pos.x, 0, 'NaN 时间按 0 处理');
}

section('I. 跨难度与词集成就');

{
  const names = (list) => list.map((a) => a.name);
  const base = { win: true, stepsLeft: 3, wordCount: 2, unlimited: false };

  eq(names(achievementsFor({ ...base, collectionSize: 30 })), ['抵达 1024', '词集三十'], '词集 30 → 词集三十');
  eq(names(achievementsFor({ ...base, collectionSize: 29 })), ['抵达 1024'], '词集 29 → 未达成（边界）');
  eq(names(achievementsFor({ ...base, diffsWon: ['easy', 'normal', 'hard'] })), ['抵达 1024', '三途皆涉'], '三难度全胜 → 三途皆涉');
  eq(names(achievementsFor({ ...base, diffsWon: ['easy', 'hard'] })), ['抵达 1024'], '缺一难度 → 未达成');
  eq(names(achievementsFor({ ...base, collectionSize: 60, lexiconTotal: 60 })), ['抵达 1024', '词集三十', '词汇全图'], '集满 → 词汇全图');
  eq(names(achievementsFor({ ...base, collectionSize: 60, lexiconTotal: 0 })), ['抵达 1024', '词集三十'], '词库总量未知时不判定集满');
  // 组合：元进度与单局成就并存
  eq(names(achievementsFor({ win: false, stepsLeft: 0, wordCount: 10, collectionSize: 45, diffsWon: ['easy', 'normal', 'hard'] })),
    ['字字珠玑', '信步由缰', '词集三十', '三途皆涉'], '多成就可叠加且顺序稳定');
}

{
  // diffsWon：从战绩里提取已获胜难度
  eq(diffsWon([]).length, 0, '空战绩无难度');
  eq(diffsWon(null).length, 0, 'null 战绩安全');
  eq(diffsWon('x').length, 0, '非数组安全');
  const h = [
    { win: true, diff: 'hard' }, { win: false, diff: 'easy' },
    { win: true, diff: 'easy' }, { win: true, diff: 'hard' }, { win: true },
  ];
  eq(diffsWon(h).join(','), 'hard,easy,normal', '按胜局顺序去重，缺 diff 视为 normal');
}

{
  // buildResult 会把元进度参数传给成就系统
  const r = buildResult({
    win: true, visitedWords: ['光'], collected: ['光'], steps: 1, stepsLeft: 1,
    collectionSize: 31, diffsWon: ['easy', 'normal', 'hard'], lexiconTotal: 60,
    quote: { flavor: '极客', text: 't' },
  });
  ok(r.achievements.some((a) => a.name === '词集三十'), 'buildResult 传递词集数');
  ok(r.achievements.some((a) => a.name === '三途皆涉'), 'buildResult 传递已胜难度');
}

// ═══════════════════ J. 单文件打包的静态检查 ═══════════════════
//
// 离线版把这几个模块拼进同一个 <script> 作用域。只要出现重名的顶层
// const/let（历史上踩过 PENTA），整段脚本就会 SyntaxError、游戏直接白屏。
// 这里做静态检查，把这类问题挡在提交之前。

section('J. 单文件打包静态检查');

{
  const BUNDLED = [
    'data.mjs', 'i18n.mjs', 'rules.mjs', 'geometry.mjs', 'poster.mjs',
    'menu.mjs', 'stats.mjs', 'spatial.mjs', 'replay.mjs',
    'daily.mjs', 'save.mjs', 'tutorial.mjs', 'comfort.mjs', 'chart.mjs', 'graph.mjs', 'audio.mjs',
  ];
  const decls = new Map();   // 名字 → 出现的文件
  const dupes = [];
  for (const name of BUNDLED) {
    const src = fs.readFileSync(new URL(`../public/rw/js/${name}`, import.meta.url), 'utf8');
    // 只取顶层声明（行首无缩进），避免把函数内部变量算进来
    const re = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(src))) {
      const id = m[1];
      if (decls.has(id)) dupes.push(`${id} (${decls.get(id)} & ${name})`);
      else decls.set(id, name);
    }
  }
  eq(dupes.length, 0, '打包模块间无重名顶层 const/let', dupes.join(', '));
  ok(decls.size >= 25, `共扫描到 ${decls.size} 个顶层声明（确认扫描本身有效）`);

  // main.mjs 单独检查：它不会被其它模块重复声明，但要确认打包清单覆盖它依赖的模块
  const mainSrc = fs.readFileSync(new URL('../public/rw/js/main.mjs', import.meta.url), 'utf8');
  const imported = [...mainSrc.matchAll(/from\s+'\.\/([\w.-]+\.mjs)'/g)].map((x) => x[1]);
  const missing = imported.filter((f) => f !== 'main.mjs' && !BUNDLED.includes(f));
  eq(missing.length, 0, 'make-offline 打包清单覆盖 main.mjs 的全部依赖', missing.join(', '));
}

// ═══════════════════ K. 每日挑战 / 存档 / 可访问性 ═══════════════════

section('K. 每日挑战');

{
  eq(dailyKey(new Date(2026, 10, 9)), '2026-11-09', '日期键补零格式');
  eq(dailyKey(new Date(2026, 0, 1)), '2026-01-01', '年初日期键');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(dailyKey('坏日期')), '非法日期回落到今天且格式正确');

  const a = dailySeed('2026-11-09');
  const b = dailySeed('2026-11-09');
  const c = dailySeed('2026-11-10');
  ok(Number.isInteger(a) && a >= 0 && a <= 0xffffffff, '种子为 32 位无符号整数');
  eq(a, b, '同一天种子相同（全球同图）');
  ok(a !== c, '不同天种子不同', `${a} vs ${c}`);
  eq(dailySeed(''), dailySeed(''), '空键不崩');

  // 难度三天一轮
  const d1 = dailyDifficulty('2026-11-09');
  const d2 = dailyDifficulty('2026-11-10');
  const d3 = dailyDifficulty('2026-11-11');
  const d4 = dailyDifficulty('2026-11-12');
  ok([d1, d2, d3].every((x) => ['easy', 'normal', 'hard'].includes(x)), '难度取值合法');
  ok(new Set([d1, d2, d3]).size === 3, '连续三天难度各不相同', `${d1},${d2},${d3}`);
  eq(d4, d1, '第四天回到第一天难度（三天一轮）');
  eq(dailyDifficulty('坏日期'), 'normal', '非法日期回落 normal');
}

{
  eq(parseDaily(''), null, '空字符串 → null');
  eq(parseDaily('坏 json'), null, '坏 JSON → null');
  eq(parseDaily('{"key":"2026-11-09"}'), null, '缺分数 → null');
  eq(parseDaily('{"key":"11-09","score":10}'), null, '日期键格式不对 → null');
  const okDaily = parseDaily('{"key":"2026-11-09","score":88,"win":true}');
  ok(okDaily && okDaily.score === 88 && okDaily.win === true, '合法记录解析');

  eq(dailyStatus(null, '2026-11-09'), { played: false, score: 0, win: false }, '无记录 → 未完成');
  eq(dailyStatus(okDaily, '2026-11-10'), { played: false, score: 0, win: false }, '跨天后旧记录失效');
  eq(dailyStatus(okDaily, '2026-11-09'), { played: true, score: 88, win: true }, '当天记录 → 已完成');

  const rec = dailyRecord({ key: '2026-11-09', score: 120, win: false, ts: 1 });
  eq(rec, { key: '2026-11-09', score: 120, win: false, ts: 1 }, '成绩记录结构');
  eq(dailyRecord({ key: 'x', score: NaN }).score, 0, '非法分数归零');
}

section('K. 存档导入导出');

{
  const text = exportSave({
    best: 321, history: [{ win: true, score: 10, steps: 3, words: 2 }],
    collection: ['光', '熵', '光'], diff: 'hard', skin: 'celadon', timbre: 'chime',
  });
  const d = JSON.parse(text);
  eq(d.app, SAVE_APP, '存档标记');
  eq(d.version, SAVE_VERSION, '存档版本');
  eq(typeof d.exportedAt, 'string', '导出时间');
  eq(d.best, 321, '最佳分导出');
  eq(d.settings.diff, 'hard', '设置导出');
  // 去重与截断
  const big = exportSave({ history: new Array(100).fill({ win: true, score: 1, steps: 1, words: 1 }), collection: ['a', 'a', 'b'] });
  const bd = JSON.parse(big);
  eq(bd.history.length, 60, '历史最多导出 60 条');
  eq(bd.collection.length, 2, '词集导出前去重');
}

{
  const src = exportSave({ best: 99, history: [{ win: false, score: 5, steps: 4, words: 1 }], collection: ['梦'], diff: 'easy', skin: 'ink', timbre: 'wood' });
  const r = importSave(src);
  ok(r.ok, '合法存档导入成功');
  eq(r.data.best, 99, '导入最佳分');
  eq(r.data.collection, ['梦'], '导入词集');
  eq(r.data.settings.diff, 'easy', '导入难度');

  eq(importSave('').ok, false, '空内容拒绝');
  eq(importSave('not json').ok, false, '坏 JSON 拒绝');
  eq(importSave('[]').ok, false, '数组拒绝');
  eq(importSave(JSON.stringify({ app: 'other', version: 1 })).ok, false, '其它应用存档拒绝');
  eq(importSave(JSON.stringify({ app: SAVE_APP })).ok, false, '缺版本号拒绝');
  const future = importSave(JSON.stringify({ app: SAVE_APP, version: SAVE_VERSION + 1 }));
  ok(!future.ok && future.error.includes('版本'), '未来版本拒绝', future.error);

  // 脏字段被清洗
  const dirty = importSave(JSON.stringify({
    app: SAVE_APP, version: 1, best: -5,
    history: [{ win: 'yes' }, { win: true, score: 1, steps: 1, words: 1 }],
    collection: ['ok', '', null, 'ok', 'x'.repeat(50)],
    settings: { diff: 'insane', skin: 'nope', timbre: 'nope' },
  }));
  ok(dirty.ok, '脏字段存档仍可导入');
  eq(dirty.data.best, 0, '负分归零');
  eq(dirty.data.history.length, 1, '非法战绩被过滤');
  eq(dirty.data.collection, ['ok'], '非法词集项被过滤');
  eq(dirty.data.settings.diff, 'normal', '非法难度回落');

  const rv = resetValues();
  ok(rv['rw-best'] === '0' && rv['rw-history'] === '[]' && rv['rw-collection'] === '[]', '重置默认值正确');
}

section('K. 可访问性对比度');

{
  eq(hexToRgb(0xffffff), [1, 1, 1], '白色解析');
  eq(hexToRgb(0x000000), [0, 0, 0], '黑色解析');
  eq(hexToRgb('#ff0000'), [1, 0, 0], '带 # 的十六进制');
  eq(relativeLuminance(0xffffff), 1, '白色相对亮度 1');
  eq(relativeLuminance(0x000000), 0, '黑色相对亮度 0');
  eq(Math.round(contrastRatio(0xffffff, 0x000000)), 21, '黑白对比度 21:1');
  eq(Math.round(contrastRatio(0x000000, 0xffffff)), 21, '对比度对称');

  // 全部皮肤必须通过 AA 阈值（以后换配色若看不清会直接测试失败）
  const failures = auditAllSkins(SKINS);
  eq(failures.length, 0, '所有皮肤通过 WCAG 对比度阈值',
    failures.map((f) => `${f.skin}:${f.pair}=${f.ratio}`).join('; '));

  // 反向验证：故意给一套低对比度皮肤，审计必须报错
  const badSkin = {
    bg: 0x888888, word: 0x8a8a8a, goal: 0x8b8b8b, start: 0x8c8c8c,
    line: 0x878787, halo: 0x8d8d8d,
  };
  const bad = auditSkin(badSkin);
  ok(bad.some((r) => !r.pass), '低对比度皮肤会被审计拦下', JSON.stringify(bad.map((r) => r.pass)));
}

// ═══════════════════ L. 新手引导 / 移动模式 / 界面语言 ═══════════════════

section('L. 新手引导 / 移动模式 / i18n');

{
  eq(TUTORIAL_STEPS.length, 3, '引导共 3 步');
  ok(TUTORIAL_STEPS.every((s) => s.icon && s.key), '每步都有图标与文案 key');
  eq(parseTutorialDone('1'), true, '标记 1 = 已完成');
  eq(parseTutorialDone('0'), false, '标记 0 = 未完成');
  eq(parseTutorialDone(''), false, '空标记 = 未完成');
  eq(parseTutorialDone(null), false, 'null = 未完成');
  eq(shouldShowTutorial(false), true, '未完成 → 展示引导');
  eq(shouldShowTutorial(true), false, '已完成 → 不再展示');
  eq(tutorialDoneValue(), '1', '完成值固定为 1');
}

{
  eq(MOVE_MODES.join(','), 'glide,teleport', '两种移动模式');
  eq(normalizeMoveMode('teleport'), 'teleport', '合法值保留');
  eq(normalizeMoveMode('weird'), 'glide', '非法值回落滑翔');
  eq(normalizeMoveMode(undefined), 'glide', 'undefined 回落滑翔');
  eq(nextMoveMode('glide'), 'teleport', '滑翔 → 瞬移');
  eq(nextMoveMode('teleport'), 'glide', '瞬移 → 滑翔（循环）');
  eq(nextMoveMode('bad'), 'teleport', '非法值按滑翔处理后再切换');
}

{
  // i18n：默认中文原样；英文查表；缺词回落中文
  eq(normalizeLang('en'), 'en', '合法语言 en');
  eq(normalizeLang('fr'), 'zh', '非法语言回落中文');
  eq(tr('开始游走 ▸', 'zh'), '开始游走 ▸', '中文原样返回');
  eq(tr('开始游走 ▸', 'en'), 'Start ▸', '英文查表');
  eq(tr('不存在的词条', 'en'), '不存在的词条', '缺词回落中文（不会空白）');
  // 词典完整性：所有 key 的英文有定义（'局' 有意映射为空串，用于「第 N 局」的英文语序）
  const empties = Object.entries(EN).filter(([k, v]) => typeof v !== 'string' || (v.length === 0 && k !== '局'));
  eq(empties.length, 0, '英文词典无意外空值', empties.map(([k]) => k).join(','));
  ok(Object.keys(EN).length >= 80, `词典条目 ${Object.keys(EN).length} ≥ 80`);
}

// ═══════════════════ M. 主题词包 / 7 日榜 / 舒适性 ═══════════════════

section('M. 主题词包');

{
  eq(PACK_KEYS.join(','), 'classic,poetry,geek,nature', '四个主题词包');
  for (const k of PACK_KEYS) {
    const p = WORD_PACKS[k];
    ok(p.name && p.words.length >= 39, `词包 ${k} 至少 39 词（${p.words.length}）`);
    eq(new Set(p.words).size, p.words.length, `词包 ${k} 内部无重复`);
    ok(p.words.every((w) => typeof w === 'string' && w.length >= 1 && w.length <= 4), `词包 ${k} 词长合规`);
  }
  eq(WORD_PACKS.classic.words.length, WORDS.length, '经典词包 = 原词库');
  ok(TOTAL_WORDS > WORDS.length, `总词数 ${TOTAL_WORDS} > 单包（跨包并集）`);
  eq(normalizePack('poetry'), 'poetry', '合法词包保留');
  eq(normalizePack('nope'), 'classic', '非法词包回落经典');
  eq(normalizePack(undefined), 'classic', 'undefined 回落经典');
}

section('M. 每日 7 日榜');

{
  eq(parseDailyHistory('').length, 0, '空历史');
  eq(parseDailyHistory('bad json').length, 0, '坏 JSON');
  eq(parseDailyHistory('{"a":1}').length, 0, '非数组');
  const raw = JSON.stringify([
    { key: '2026-11-07', score: 30, win: false },
    { key: '2026-11-09', score: 50, win: true },
    { key: '2026-11-09', score: 60, win: true },
    { key: 'bad', score: 1 },
    null,
  ]);
  const hist = parseDailyHistory(raw);
  eq(hist.length, 2, '去重与过滤脏记录');
  eq(hist[0].key, '2026-11-09', '按日期倒序');
  ok(hist[0].score === 50 || hist[0].score === 60, '同日保留其一');

  const appended = appendDailyHistory(hist, { key: '2026-11-09', score: 88, win: true, ts: 1 });
  eq(appended[0].score, 88, '同日成绩覆盖');
  eq(appended.length, 2, '覆盖不新增条目');
  eq(appendDailyHistory([], { key: '2026-11-09', score: 1 }).length, 1, '空历史追加');

  const board = dailyBoard([{ key: '2026-11-09', score: 50, win: true }, { key: '2026-11-08', score: 20 }], '2026-11-09', 7);
  eq(board.length, 7, '榜单固定 7 天');
  eq(board[0].key, '2026-11-09', '第一格是今天');
  eq(board[0].played, true, '今天已挑战');
  eq(board[0].score, 50, '今天分数');
  eq(board[0].win, true, '今天胜利标记');
  eq(board[1].short, '11-08', '日期短格式');
  eq(board[2].played, false, '未挑战的日期为空');
  eq(board[2].score, 0, '未挑战分数为 0');
  // 跨月
  const mb = dailyBoard([], '2026-03-02', 7);
  eq(mb[1].key, '2026-03-01', '跨月回退正确');
  eq(mb[2].key, '2026-02-28', '跨月天数正确（2026 非闰年）');
}

section('M. 舒适性 & 音量');

{
  eq(vignetteOpacity(0.5, true), 0.55, '中点遮罩最暗');
  eq(vignetteOpacity(0, true), 0, '起点无遮罩');
  eq(vignetteOpacity(1, true), 0, '终点无遮罩');
  eq(vignetteOpacity(0.5, false), 0, '关闭时无遮罩');
  ok(vignetteOpacity(0.25, true) > 0 && vignetteOpacity(0.25, true) < 0.55, '中途渐入');
  eq(vignetteOpacity('x', true), 0, '非法进度按 0');

  eq(clampVolume(0.5), 0.5, '音量透传');
  eq(clampVolume(1.5), 1, '上限钳制');
  eq(clampVolume(-1), 0, '下限钳制');
  eq(clampVolume(NaN), 0.8, '非法音量回落 0.8');
  eq(volumeToPercent(0.8), 80, '百分比换算');

  eq(seatedOffset(1.6), 0, '站立眼高无需偏移');
  eq(seatedOffset(1.2), 0.4, '坐姿 1.2m → 抬高 0.4m');
  eq(seatedOffset(0.5), 0.6, '过低眼高钳制 +0.6');
  eq(seatedOffset(2.5), -0.6, '过高眼高钳制 -0.6');
  eq(seatedOffset(0), 0, '零值安全');
  eq(seatedOffset('x'), 0, '非法输入安全');
}

// ═══════════════════ N. 每日榜图表 / 词包成就 ═══════════════════

section('N. 每日榜图表 & 词包成就');

{
  eq(barLayout([]).length, 0, '空数据无柱子');
  const zeros = barLayout([0, 0, 0, 0, 0, 0, 0], { width: 280, height: 48, gap: 6, minBar: 2 });
  eq(zeros.length, 7, '7 天 7 根柱');
  ok(zeros.every((b) => b.h === 2), '全 0 时仅保留最小高度');
  ok(zeros.every((b) => b.ratio === 0), '全 0 比例为 0');

  const bars = barLayout([10, 0, 20], { width: 300, height: 50, gap: 10 });
  eq(bars.length, 3, '三根柱');
  eq(bars[2].ratio, 1, '最高分比例 1');
  eq(bars[2].h, 50, '最高分占满高度');
  eq(bars[0].h, 25, '一半分数一半高度');
  ok(bars[0].x < bars[1].x && bars[1].x < bars[2].x, '柱子从左到右排列');
  ok(bars.every((b) => b.h >= 2 && b.w >= 1), '每根柱都有可见尺寸');
  ok(bars.every((b) => b.y + b.h === 50), 'y + h = 图高（底部对齐）');

  const dirty = barLayout([NaN, -5, 'x', 8]);
  eq(dirty[0].ratio, 0, 'NaN 归零');
  eq(dirty[1].ratio, 0, '负值归零');
  eq(dirty[3].ratio, 1, '最大值仍为 1');

  eq(chartSummary([0, 10, 20]), { max: 20, total: 30, activeDays: 2 }, '图表摘要');
  eq(chartSummary([]), { max: 0, total: 0, activeDays: 0 }, '空摘要');
  eq(chartSummary([NaN, 5]), { max: 5, total: 5, activeDays: 1 }, '脏值过滤');
}

{
  const names = (list) => list.map((a) => a.name);
  const base = { win: false, stepsLeft: 0, wordCount: 2, unlimited: false };
  eq(names(achievementsFor({ ...base, packsCompleted: ['poetry'] })), ['诗词全集'], '诗词词包集满 → 诗词全集');
  eq(names(achievementsFor({ ...base, packsCompleted: ['classic', 'geek'] })), ['经典全集', '极客全集'], '多词包按固定顺序');
  eq(names(achievementsFor({ ...base, packsCompleted: [] })).length, 0, '未集满无词包成就');
  eq(names(achievementsFor({ ...base, packsCompleted: ['nature'] })).length, 1, '自然全集');
  // 与其它成就叠加
  const combo = names(achievementsFor({ win: true, stepsLeft: 6, wordCount: 3, collectionSize: 60, lexiconTotal: 120, packsCompleted: ['classic'] }));
  ok(combo.includes('抵达 1024') && combo.includes('词集三十') && combo.includes('经典全集'), '词包成就可与单局/元进度叠加', combo.join(','));

  const r = buildResult({
    win: false, visitedWords: ['光'], collected: ['光'], steps: 1, stepsLeft: 0,
    packsCompleted: ['geek'], quote: { flavor: '极客', text: 't' },
  });
  ok(r.achievements.some((a) => a.name === '极客全集'), 'buildResult 传递词包完成列表');
}

// ═══════════════════ 汇总 ═══════════════════

console.log('\n========================================');
if (failures.length) {
  console.log(`✗ ${pass} 项通过，${failures.length} 项失败：`);
  for (const f of failures) console.log('  · ' + f);
  process.exit(1);
}
console.log(`✓ 全部 ${pass} 项断言通过`);
