// 拾径 Wordloom — 纯几何构建（不依赖 three.js / DOM，可在 Node 中单元测试）
//
// 为什么要有这一层：
//   每局要画 ~35 个词球和 ~45 条边。若一个球/一条边各自一个 Mesh，就是 80+ 次
//   drawcall；Pico Neo3（骁龙 XR2，CPU 约为桌面 1/6）的瓶颈正是 drawcall 提交。
//   这里把全部词球合批成一个带顶点色的几何、全部边合批成一个 LineSegments，
//   状态变化（走过/当前/收录）只改顶点色属性，不碰对象数量。
//
// 设计约束：只做数组数学，不 new 任何 three 对象；颜色烘焙在构建期算好
// （漫反射项按顶点法线预乘进顶点色），运行时用 MeshBasicMaterial 即可，
// 省掉逐像素光照。

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** 全部边合批成一个 LineSegments 的顶点缓冲。 */
export function buildEdgeGeometry(nodes, edges) {
  const edgeCount = edges.length;
  const positions = new Float32Array(edgeCount * 6);
  const colors = new Float32Array(edgeCount * 6);
  for (let k = 0; k < edgeCount; k++) {
    const [a, b] = edges[k];
    const pa = nodes[a].pos, pb = nodes[b].pos;
    if (!pa || !pb) throw new Error(`边 ${k} 引用了不存在的节点: ${a}->${b}`);
    positions[k * 6] = pa.x; positions[k * 6 + 1] = pa.y; positions[k * 6 + 2] = pa.z;
    positions[k * 6 + 3] = pb.x; positions[k * 6 + 4] = pb.y; positions[k * 6 + 5] = pb.z;
  }
  return { positions, colors, edgeCount };
}

/**
 * 按边索引写颜色。colorOf(k) 返回 [r,g,b]（0..1）。
 * 颜色写入是覆盖式的，便于「先铺墨色，再把走过的边染成轨迹色」。
 */
export function paintEdges(colors, edgeCount, colorOf) {
  for (let k = 0; k < edgeCount; k++) {
    const c = colorOf(k);
    const o = k * 6;
    colors[o] = c[0]; colors[o + 1] = c[1]; colors[o + 2] = c[2];
    colors[o + 3] = c[0]; colors[o + 4] = c[1]; colors[o + 5] = c[2];
  }
}

/**
 * 全部词球合批成一个几何：位置 + 法线 + 顶点色 + 三角形→节点索引映射。
 *
 * 顶点色 = 基础色 × (环境项 + 漫反射项 × max(0, n·L)) × 节点亮度
 * —— 光照在构建期烘焙，运行时零光照成本，且每个节点仍能单独调亮/调暗。
 *
 * @param nodes  [{pos:{x,y,z}}]
 * @param opts.radiusOf(i)      节点半径
 * @param opts.colorOf(i)       基础色 [r,g,b]（0..1）
 * @param opts.brightnessOf(i)  亮度系数（默认 1）
 * @param opts.segments/rings   球面细分（经向/纬向段数）
 * @param opts.light            光照方向（世界空间，会自动归一化）
 * @param opts.ambient/diffuse  烘焙光照权重
 */
export function buildNodeSpheres(nodes, opts = {}) {
  const {
    radiusOf = () => 1,
    colorOf = () => [1, 1, 1],
    brightnessOf = () => 1,
    segments = 14,
    rings = 10,
    light = [0.45, 0.75, 0.5],
    ambient = 0.58,
    diffuse = 0.42,
  } = opts;

  if (segments < 3 || rings < 2) throw new Error('球面细分过小: segments>=3, rings>=2');

  const perNodeVerts = (rings + 1) * (segments + 1);
  const perNodeTris = rings * segments * 2 - segments * 2; // 两极各有一圈退化三角形被剔除
  const nodeCount = nodes.length;

  const positions = new Float32Array(nodeCount * perNodeVerts * 3);
  const normals = new Float32Array(nodeCount * perNodeVerts * 3);
  const colors = new Float32Array(nodeCount * perNodeVerts * 3);
  const indices = new Uint32Array(nodeCount * perNodeTris * 3);
  const faceToNode = new Uint32Array(nodeCount * perNodeTris);
  const ranges = new Array(nodeCount);

  const L = norm3(light[0], light[1], light[2]);

  let vCursor = 0;   // 顶点写指针（顶点数）
  let iCursor = 0;   // 索引写指针（元素数）
  let fCursor = 0;   // 三角形写指针

  for (let i = 0; i < nodeCount; i++) {
    const p = nodes[i].pos;
    const r = radiusOf(i);
    const base = colorOf(i);
    const bright = brightnessOf(i);
    const vStart = vCursor;
    const iStart = iCursor;

    // 顶点：经纬网格（含两极重复行，保证 UV/法线连续）
    for (let iy = 0; iy <= rings; iy++) {
      const phi = (Math.PI * iy) / rings;
      const sy = Math.cos(phi);
      const srxz = Math.sin(phi);
      for (let ix = 0; ix <= segments; ix++) {
        const theta = (2 * Math.PI * ix) / segments;
        const nx = srxz * Math.cos(theta);
        const ny = sy;
        const nz = srxz * Math.sin(theta);
        const v = vCursor * 3;
        positions[v] = p.x + nx * r;
        positions[v + 1] = p.y + ny * r;
        positions[v + 2] = p.z + nz * r;
        normals[v] = nx; normals[v + 1] = ny; normals[v + 2] = nz;
        const lambert = ambient + diffuse * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        colors[v] = clamp01(base[0] * lambert * bright);
        colors[v + 1] = clamp01(base[1] * lambert * bright);
        colors[v + 2] = clamp01(base[2] * lambert * bright);
        vCursor++;
      }
    }

    // 索引：跳过两极的退化三角形
    // 绕序必须逆时针（three.js 默认 FrontSide = CCW）：先 (a,b,c)、(b,d,c)。
    // 早期写成 (a,c,b)/(b,c,d) 会让法线朝内、球面渲染成背面，
    // 结果是深度写在球体远侧，穿过球内部的边线会错误地画在球前面。
    for (let iy = 0; iy < rings; iy++) {
      const row = iy * (segments + 1);
      const next = (iy + 1) * (segments + 1);
      for (let ix = 0; ix < segments; ix++) {
        const a = vStart + row + ix;
        const b = vStart + row + ix + 1;
        const c = vStart + next + ix;
        const d = vStart + next + ix + 1;
        if (iy !== 0) {                       // 顶部极点退化
          indices[iCursor++] = a; indices[iCursor++] = b; indices[iCursor++] = c;
          faceToNode[fCursor++] = i;
        }
        if (iy !== rings - 1) {               // 底部极点退化
          indices[iCursor++] = b; indices[iCursor++] = d; indices[iCursor++] = c;
          faceToNode[fCursor++] = i;
        }
      }
    }

    ranges[i] = {
      vStart,
      vCount: vCursor - vStart,
      iStart,
      iCount: iCursor - iStart,
      center: [p.x, p.y, p.z],
      radius: r,
      base: [base[0], base[1], base[2]],
      brightness: bright,
    };
  }

  return {
    positions, normals, colors, indices, faceToNode, ranges,
    vertexCount: vCursor,
    triangleCount: fCursor,
    perNodeVerts,
    perNodeTris,
  };
}

/**
 * 重写某个节点的顶点色（收录变暗 / 当前与相邻变亮）。
 * 法线从传入的 normals 数组读，避免额外存一份副本；
 * 返回是否真的写了（索引非法时 false，避免静默越界）。
 */
export function recolorNode(colors, normals, ranges, nodeIndex, {
  color, brightness = 1, ambient = 0.58, diffuse = 0.42, light = [0.45, 0.75, 0.5],
}) {
  const rg = ranges[nodeIndex];
  if (!rg) return false;
  const L = norm3(light[0], light[1], light[2]);
  for (let v = rg.vStart; v < rg.vStart + rg.vCount; v++) {
    const o = v * 3;
    const lambert = ambient + diffuse * Math.max(0, normals[o] * L[0] + normals[o + 1] * L[1] + normals[o + 2] * L[2]);
    colors[o] = clamp01(color[0] * lambert * brightness);
    colors[o + 1] = clamp01(color[1] * lambert * brightness);
    colors[o + 2] = clamp01(color[2] * lambert * brightness);
  }
  return true;
}
