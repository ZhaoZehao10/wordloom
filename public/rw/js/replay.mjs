// 拾径 · Wordloom — 路径回放的纯计算层
//
// 结算后可以「重放路径」：镜头沿本局走过的节点依次巡览，像回看自己留下的足迹。
// 这里只做数学：把访问序列变成路径点，再按时间取样。渲染层只负责把相机放到 pos。
// 纯函数便于测试边界（0/1 个点、超时、非法时间）。

/**
 * 把访问过的节点索引序列转成回放路径点。
 * 高度统一取 height（玩家站立视点的行走高度），保证镜头平稳。
 */
export function buildReplayPath(visited, nodes, { height = 0 } = {}) {
  const out = [];
  for (const idx of Array.isArray(visited) ? visited : []) {
    const nd = nodes?.[idx];
    const p = nd?.pos;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    out.push({ x: p.x, y: height, z: p.z });
  }
  return out;
}

const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/**
 * 按已播放时长取样。
 * @returns {{index:number, t:number, pos:{x,y,z}, done:boolean}}
 *   index 为当前所在段起的点序号；t 为该段内进度 0..1；done 表示整条路径播完。
 */
export function replayAt(path, elapsedMs, { segmentMs = 420, lift = 0.16 } = {}) {
  const n = Array.isArray(path) ? path.length : 0;
  if (n === 0) return { index: 0, t: 0, pos: { x: 0, y: 0, z: 0 }, done: true };
  if (n === 1) return { index: 0, t: 0, pos: { ...path[0] }, done: true };

  const seg = Math.max(60, segmentMs);
  const total = (n - 1) * seg;
  const e = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (e >= total) {
    const last = path[n - 1];
    return { index: n - 2, t: 1, pos: { ...last }, done: true };
  }

  const index = Math.min(n - 2, Math.floor(e / seg));
  const t = (e - index * seg) / seg;
  const a = path[index];
  const b = path[index + 1];
  const k = easeInOut(t);
  return {
    index,
    t,
    pos: {
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k + Math.sin(Math.PI * t) * lift,  // 轻微起伏，像滑翔
      z: a.z + (b.z - a.z) * k,
    },
    done: false,
  };
}

/** 整条回放的总时长（毫秒），用于 HUD 进度与测试。 */
export function replayDuration(path, { segmentMs = 420 } = {}) {
  const n = Array.isArray(path) ? path.length : 0;
  return n <= 1 ? 0 : (n - 1) * Math.max(60, segmentMs);
}
