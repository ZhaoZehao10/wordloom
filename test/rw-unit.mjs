// 随机游走 VR — 纯逻辑单元测试（不启动浏览器，毫秒级）
// 用法: node test/rw-unit.mjs
//
// 覆盖四层：
//   A. 图生成不变量（多随机种子 × 多难度）
//   B. 规则层边界（计分/成就/路径诗/一言/结算汇总）
//   C. 数据完整性（词库/一言/皮肤/音色/难度/成就）
//   D. 合批几何正确性（边缓冲 / 词球烘焙 / 顶点色回写）
import { generateGraph } from '../public/rw/js/graph.mjs';
import { WORDS, FLAVORS, QUOTES, SKINS, TIMBRES, DIFFICULTIES, ACHIEVEMENTS, SCORE } from '../public/rw/js/data.mjs';
import {
  scoreForWalk, finalScore, achievementsFor, pathPoem, pickQuote, buildResult,
  snapTurn, normalizeYaw,
} from '../public/rw/js/rules.mjs';
import {
  buildEdgeGeometry, paintEdges, buildNodeSpheres, recolorNode,
} from '../public/rw/js/geometry.mjs';
import { posterContent, drawPoster, POSTER_SIZE } from '../public/rw/js/poster.mjs';
import { buildMenuLayout, hitTestMenu, isSelected, drawMenu, MENU_W, MENU_H } from '../public/rw/js/menu.mjs';
import {
  makeRecord, appendRecord, summarize, isValidRecord, parseHistory, serializeHistory,
  summaryLine, HISTORY_LIMIT,
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
  eq(pc.title, '随机游走', '海报标题');
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
  ok(texts.includes('随机游走'), '画出了标题');
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
  eq(rowTitles.length, 3, '菜单 3 行（难度/皮肤/音色）');
  eq(buttons.length, 10, '菜单按钮总数 = 3×3 选项 + 1 开始');

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
  ok(texts.includes('随机游走 · 设置'), '菜单画出标题');
  for (const label of ['悠然', '标准', '紧绷', '墨', '朱砂', '青瓷', '木鱼', '电子', '风铃', '开始游走']) {
    ok(texts.includes(label), `菜单画出按钮「${label}」`);
  }
  eq(layout.buttons.length, 10, 'drawMenu 返回布局完整');
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

// ═══════════════════ 汇总 ═══════════════════

console.log('\n========================================');
if (failures.length) {
  console.log(`✗ ${pass} 项通过，${failures.length} 项失败：`);
  for (const f of failures) console.log('  · ' + f);
  process.exit(1);
}
console.log(`✓ 全部 ${pass} 项断言通过`);
