// 随机游走 VR — 词图生成
// 每局随机生成一张「由词与线织成的荒原」：
//   · 起点在玩家脚前，终点「1024」在远处，词节点散布中间；
//   · 边 = 相对邻居图（近似原版"织乱的线"：少交叉、局部连接）；
//   · 植入一条保证可通的主干路径，难度越高路径越长、节点越密。
import * as THREE from '../../vendor/three.module.min.js';

// 距离用平方比较，避免开方
const MIN_NODE_GAP = 1.35;   // 旁支词节点最小间距（米），防止词牌叠字

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 生成一张图：words 为词表（可重复抽样），difficulty 给出步数预算
// 布局：以玩家为原点，目标在 -Z 远处。节点按环带分布（0=起点，1=终点）。
export function generateGraph({ words, steps, seed = Date.now(), wordCount = 22 }) {
  const rand = rng(seed);
  const nodes = [];
  const edges = [];

  // —— 主干：保证 start→goal 可达，路径长度 ≈ steps 的一半到三分之二 ——
  const trunkLen = Math.max(4, Math.min(steps - 2, Math.round(steps * 0.62)));
  const goalZ = -(2.2 + trunkLen * 0.78);           // 目标深度
  const trunk = [];
  for (let i = 0; i <= trunkLen; i++) {
    const t = i / trunkLen;
    const sway = (rand() - 0.5) * 1.5 * Math.sin(Math.PI * t); // 中段横向摆动
    const z = t * goalZ;
    const x = sway;
    const y = 0.92 + Math.sin(t * Math.PI) * 0.5 + (rand() - 0.5) * 0.34;
    trunk.push(new THREE.Vector3(x, y, z));
  }
  trunk[0].set(0, 0.5, -0.85);                      // 起点在脚前低处（基座感，不挡视线）
  trunk[trunkLen].set(0, 1.5, goalZ);                // 终点居中悬高

  const startIdx = 0;
  const goalIdx = 1;
  nodes.push({ word: '出发', pos: trunk[0].clone(), kind: 'start' });
  nodes.push({ word: '1024', pos: trunk[trunkLen].clone(), kind: 'goal' });
  for (let i = 1; i < trunkLen; i++) {
    nodes.push({ word: words[(i * 7 + Math.floor(rand() * 7)) % words.length], pos: trunk[i].clone(), kind: 'word' });
  }
  // 主干边：start(0) → w1(2) → w2(3) → … → wN(trunkLen) → goal(1)
  // trunk[i] 的词节点 idx = i + 1（0 是 start，1 是 goal）
  edges.push([startIdx, 2]);
  for (let i = 2; i < trunkLen; i++) edges.push([i, i + 1]);
  edges.push([trunkLen, goalIdx]);

  // —— 旁支词节点：随机散布在主干两侧环带内（避开已占位置） ——
  const extra = wordCount;
  const placed = nodes.map((n) => n.pos);
  let attempts = 0;
  for (let k = 0; k < extra && attempts < extra * 40; ) {
    attempts++;
    const t = 0.06 + rand() * 0.94;                  // 沿路径深度
    const z = t * goalZ * (0.96 + rand() * 0.1);
    const lateral = (1.6 + rand() * 2.3) * (rand() < 0.5 ? -1 : 1); // 离主干足够远
    const x = trunk[Math.min(trunk.length - 1, Math.floor(t * trunkLen))].x * (0.3 + rand() * 0.4) + lateral;
    const y = 0.75 + rand() * 1.5;
    const p = new THREE.Vector3(x, y, z);
    // 旁支词节点彼此/与主干的最小间距：1.35m（词牌宽约 0.5m，低于此会叠字）
    if (placed.some((q) => q.distanceToSquared(p) < MIN_NODE_GAP * MIN_NODE_GAP)) continue;
    placed.push(p);
    nodes.push({ word: words[Math.floor(rand() * words.length)], pos: p, kind: 'word' });
    k++;
  }

  // —— 旁支边：相对邻居图（RNG）：u–v 有边当且仅当月牙区内无第三点 ——
  // 注意：adj / edgeSet 必须先由「已存在的主干边」播种。
  // 早期版本漏了这一步，导致 degree 失真、孤立节点误判、连通性自检恒为假阳性。
  const n = nodes.length;
  const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const adj = Array.from({ length: n }, () => []);
  const edgeSet = new Set();
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
    edgeSet.add(key(a, b));
  }
  const addEdge = (a, b) => {
    const k = key(a, b);
    if (edgeSet.has(k) || a === b) return;
    edgeSet.add(k);
    edges.push([a, b]);
    adj[a].push(b);
    adj[b].push(a);
  };
  for (let u = 0; u < n; u++) {
    for (let v = u + 1; v < n; v++) {
      const duv = nodes[u].pos.distanceToSquared(nodes[v].pos);
      let ok = true;
      for (let w = 0; w < n && ok; w++) {
        if (w === u || w === v) continue;
        const dwu = nodes[w].pos.distanceToSquared(nodes[u].pos);
        const dwv = nodes[w].pos.distanceToSquared(nodes[v].pos);
        if (dwu < duv && dwv < duv) ok = false;      // w 落在 u–v 月牙区
      }
      if (ok) addEdge(u, v);
    }
  }

  // 起点至少 2 条出路、孤岛节点连到最近节点（保证整图连通美观）
  for (let u = 0; u < n; u++) {
    if (u === startIdx || u === goalIdx) continue;
    if (adj[u].length === 0) {
      let best = -1, bd = Infinity;
      for (let v = 0; v < n; v++) {
        if (v === u) continue;
        const d = nodes[u].pos.distanceToSquared(nodes[v].pos);
        if (d < bd) { bd = d; best = v; }
      }
      addEdge(u, best);
    }
  }

  // —— 连通性校验：BFS start→goal ——
  const seen = new Set([startIdx]);
  const queue = [startIdx];
  while (queue.length) {
    const u = queue.pop();
    for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); queue.push(v); }
  }
  if (!seen.has(goalIdx)) {
    // 理论上主干已保证；防御性重试
    return generateGraph({ words, steps, seed: seed + 1, wordCount });
  }

  // 节点度数（脉冲光环大小用）
  nodes.forEach((nd, i) => { nd.degree = adj[i].length; });
  return { nodes, edges, startIdx, goalIdx, trunkLen, seed };
}
