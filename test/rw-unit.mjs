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
} from '../public/rw/js/rules.mjs';
import {
  buildEdgeGeometry, paintEdges, buildNodeSpheres, recolorNode,
} from '../public/rw/js/geometry.mjs';

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

// ═══════════════════ 汇总 ═══════════════════

console.log('\n========================================');
if (failures.length) {
  console.log(`✗ ${pass} 项通过，${failures.length} 项失败：`);
  for (const f of failures) console.log('  · ' + f);
  process.exit(1);
}
console.log(`✓ 全部 ${pass} 项断言通过`);
