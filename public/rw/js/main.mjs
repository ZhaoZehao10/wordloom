// 随机游走 VR — 主程序
// Three.js r160 + WebXR，适配 Pico Neo3。
// 原版网页玩法 → 3D 化：
//   · 词节点悬浮成星座，墨线连边；从朱砂「出发」走到赤金「1024」；
//   · 手柄射线瞄准带脉冲光环的相邻节点，扣扳机即「走一步」（水平滑翔过去）；
//   · 每步耗一步数，路过收录词；步数耗尽未达 1024 = 失败（海报依然生成）；
//   · 彩蛋：连点标题七次解除步数限制；键盘敲出 1024 触发音效与成就。
import * as THREE from '../../vendor/three.module.min.js';
import { VRButton } from '../../vendor/VRButton.js';
import { WORDS, SKINS, TIMBRES, DIFFICULTIES } from './data.mjs';
import { generateGraph } from './graph.mjs';
import { sfx, audio } from './audio.mjs';
import { buildEdgeGeometry, paintEdges, buildNodeSpheres, recolorNode } from './geometry.mjs';
import { scoreForWalk, finalScore, buildResult, pickQuote, snapTurn, normalizeYaw } from './rules.mjs';
import { drawPoster, POSTER_SIZE } from './poster.mjs';
import { drawMenu, hitTestMenu, MENU_W, MENU_H } from './menu.mjs';
import {
  appendRecord, summarize, parseHistory, serializeHistory, summaryLine, HISTORY_LIMIT,
} from './stats.mjs';

// ---------------- 常量 ----------------

const GLIDE_SPEED = 4.2;        // 滑翔速度 m/s（只水平移动，垂直靠视线自然看向节点）
const NODE_SCALE = 0.16;        // 词球基础半径
const PULSE_R0 = 0.20;          // 可走节点光环内径
const RAY_LEN = 30;

// ---------------- 全局状态 ----------------

const state = {
  mode: 'intro',                // intro | playing | ended | ended-fail
  graph: null,
  at: 0,                        // 当前节点 idx
  stepsLeft: 12,
  stepsMax: 12,
  unlimited: false,             // 连点标题七次彩蛋
  visited: [0],                 // 节点 idx 序列
  collected: [],                // 收录的词（去重）
  score: 0,
  best: parseInt(localStorage.getItem('rw-best') || '0', 10) || 0,
  history: parseHistory(localStorage.getItem('rw-history') || ''),  // 最近若干局战绩
  diff: 'normal',               // 本局难度 key
  round: 0,
  skin: localStorage.getItem('rw-skin') || 'ink',
  glide: null,                  // {from, to, t} 滑翔动画
  queuedWalk: null,             // 滑翔中的预输入（到达后自动走）
  pendingEnd: null,             // 'win' | 'fail'：滑翔到达后再结算（面板不能在滑翔中出现）
  flavor: null,                 // 结算选中的一言
  eggTyped: '',                 // 1024 键盘彩蛋
  titleTaps: 0,                 // 标题连点计数
  turn: {},                     // 每只手柄的快转状态 { armed }
  // VR 菜单里选择、下一局生效的难度（记住上次选择）
  pendingDiff: (() => {
    const saved = localStorage.getItem('rw-diff');
    return DIFFICULTIES.some((d) => d.key === saved) ? saved : 'normal';
  })(),
};

let renderer, scene, camera, rig, controllers = {};
let nodeGroup, lineGroup, beacon, starfield;

// —— 合批渲染：全部词球一个 Mesh、全部边一个 LineSegments ——
// 目的：把 drawcall 从 ~113 压到 ~40（Pico Neo3 的 XR2 CPU 是桌面 1/6，
// drawcall 提交是主要瓶颈）。状态变化只改顶点色属性，不改对象数量。
let ballsMesh = null;        // 合批词球（顶点色烘焙光照）
let ballsGeo = null;         // 其几何（改色时置 needsUpdate）
let ballNormals = null;      // 法线副本（回写顶点色时算光照）
let ballRanges = null;       // 每节点的顶点区间/中心/基础色
let ballFaceToNode = null;   // 三角形 → 节点索引（射线拾取用）
let edgeLines = null;        // 合批边
let edgeGeo = null;
let edgeColors = null;       // 边顶点色缓冲
const edgeIndexByKey = new Map(); // 边 key → 边序号（走过的边染色用）
let edgeKeys = [];           // 边序号 → key

let pickables = [];             // 可射线对象（合批后只有 1 个）
let hudGroup = null;            // VR 内 HUD 面板
let endGroup = null;            // VR 结算面板
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();

const $ = (id) => document.getElementById(id);

// ---------------- 启动 ----------------

initScene();
wire2D();
renderer.setAnimationLoop(animate);
window.__rw = {
  state, startRound, endRound, tryWalk, audio, sfx,
  rendererInfo: () => renderer.info.render,
  // 合批几何自检（测试/诊断用，不参与游戏逻辑）
  ballsGeoInfo: () => (ballsGeo ? {
    indexCount: ballsGeo.index?.count ?? null,
    indexType: ballsGeo.index?.array?.constructor?.name ?? null,
    vertexCount: ballsGeo.attributes.position.count,
    colorCount: ballsGeo.attributes.color.count,
    normalCount: ballsGeo.attributes.normal.count,
    firstIndices: ballsGeo.index ? Array.from(ballsGeo.index.array.slice(0, 12)) : null,
    nodeCount: ballRanges?.length ?? 0,
    faceMapLen: ballFaceToNode?.length ?? 0,
  } : null),
  // 分层显隐（诊断用）：'balls' | 'edges' | 'labels'
  debugToggle: (what, on) => {
    if (what === 'balls' && ballsMesh) ballsMesh.visible = on;
    if (what === 'edges' && edgeLines) edgeLines.visible = on;
    if (what === 'labels' && state.graph) for (const nd of state.graph.nodes) if (nd._obj) nd._obj.userData.label.visible = on;
    return true;
  },
  // 诊断用：暴露内部对象做深度/遮挡验证
  debugRefs: () => ({ THREE, camera, ballsMesh, edgeLines, raycaster, scene, rig }),
  // 海报导出（测试用：直接拿 dataURL 校验非空/尺寸）
  buildPosterDataURL: () => buildPosterCanvas().toDataURL('image/png'),
  posterContentFor: () => {
    // 与海报同源的内容（测试断言文案是否齐全）
    const r = resultData(state.mode === 'ended');
    return { poem: r.poem, words: r.words.length, quote: r.quote, score: r.score, achievements: r.achievements.length };
  },
  // 快转（测试用：等价于摇杆输入）
  debugSnap: (x, hand = 'right') => applySnap(hand, x),
  // VR 菜单（测试用：等价于握键开关 / 射线点选）
  debugMenuToggle: (on) => setMenuOpen(on === undefined ? !menuOpen : !!on),
  debugMenuOpen: () => menuOpen,
  debugMenuSelect: (id) => applyMenuAction(id),
  debugMenuButtons: () => (menuLayout ? menuLayout.buttons.map((b) => b.id) : []),
  debugMenuHit: (u, v) => (menuLayout ? hitTestMenu(menuLayout.buttons, u, v) : null),
  // 战绩统计
  historyInfo: () => ({
    count: state.history.length,
    summary: summarize(state.history),
    persisted: parseHistory(localStorage.getItem('rw-history') || '').length,
  }),
  // 结算面板（桌面模式也能构造，便于断言按钮与动作）
  debugShowEndPanel: (win) => {
    forceEndPanel = true;
    showEndPanel(!!win);
    forceEndPanel = false;
    return endGroup ? endGroup.userData.hits.map((h) => h.userData.action) : [];
  },
  debugEndAction: (action) => handleEndPanelAction(action),
  debugRerollQuote: () => { rerollQuote(); return state.flavor; },
  debugQuote: () => state.flavor,
}; // 测试钩子


function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas: $('c3d'), antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(VRButton.createButton(renderer));

  scene = new THREE.Scene();
  scene.background = new THREE.Color(SKINS[state.skin].bg);
  scene.fog = new THREE.Fog(SKINS[state.skin].fog, 10, 32);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 120);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.1, -2);

  // 玩家 rig：相机挂进去；VR 时设备位姿在 rig 内生效，滑翔 = 平移 rig
  rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);

  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x201a2e, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(2, 5, 1);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0x88aaff, 0.4);
  dir2.position.set(-3, 2, -3);
  scene.add(dir2);

  buildStarfield();
  buildFloor();
  buildControllers();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ---------------- 星空 / 地面 ----------------

function buildStarfield() {
  const N = 700;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const r = 14 + Math.random() * 40;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.7 + 0.3;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    c.setHSL(0.55 + Math.random() * 0.2, 0.5, 0.55 + Math.random() * 0.3);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  starfield = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.85, sizeAttenuation: true }));
  scene.add(starfield);
}

function buildFloor() {
  const skin = SKINS[state.skin];
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(28, 64),
    new THREE.MeshStandardMaterial({ color: skin.floor, roughness: 0.96, transparent: true, opacity: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.name = 'floor';
  scene.add(floor);
  const grid = new THREE.PolarGridHelper(26, 16, 10, 64, skin.grid1, skin.grid2);
  grid.position.y = 0.002;
  grid.name = 'grid';
  scene.add(grid);
}

// ---------------- 手柄 ----------------

function buildControllers() {
  for (const handed of ['left', 'right']) {
    const c = renderer.xr.getController(handed === 'left' ? 0 : 1);
    c.userData.hand = handed;
    const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const ray = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0x6cd0ff, transparent: true, opacity: 0.45 }));
    ray.scale.z = RAY_LEN;
    c.add(ray);
    c.userData.ray = ray;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), new THREE.MeshBasicMaterial({ color: 0xb18cff }));
    tip.position.z = -0.02;
    c.add(tip);
    c.userData.tip = tip;
    c.addEventListener('selectstart', () => onSelect(handed));
    // 握键（squeeze）= 开关 VR 设置菜单
    c.addEventListener('squeezestart', () => {
      audio.unlock();
      setMenuOpen(!menuOpen);
    });
    rig.add(c);                                 // 跟随玩家滑翔
    controllers[handed] = c;
  }
}

// 射线当前瞄准的节点 idx（null = 没瞄准）
// 合批后只剩一个 Mesh：命中三角形的 faceIndex 经 faceToNode 反查节点。
function aimedNode(hand) {
  const c = controllers[hand];
  if (!c || !ballsMesh) return null;
  raycaster.set(c.getWorldPosition(new THREE.Vector3()), c.getWorldDirection(new THREE.Vector3()));
  raycaster.far = RAY_LEN;
  const hits = raycaster.intersectObject(ballsMesh, false);
  if (!hits.length) return null;
  const fi = hits[0].faceIndex;
  const node = ballFaceToNode?.[fi];
  return node === undefined ? null : node;
}

function onSelect(hand) {
  audio.unlock();
  // 菜单打开时，扳机优先用于点选菜单
  if (menuOpen) { menuClick(hand); return; }
  if (state.mode !== 'playing') {
    // VR 内没有 DOM：引导态扣扳机 = 直接开局（结算面板由 endPanelClick 处理）
    if (state.mode === 'intro' && renderer.xr.isPresenting) { sfx.ui(); startRound(state.pendingDiff); return; }
    endPanelClick(hand);
    return;
  }
  const target = aimedNode(hand);
  if (target == null) return;
  tryWalk(target);
}

// ---------------- 走子 ----------------

function adjacentOf(idx) {
  const out = [];
  for (const [a, b] of state.graph.edges) {
    if (a === idx) out.push(b);
    else if (b === idx) out.push(a);
  }
  return out;
}

function tryWalk(idx) {
  if (state.mode !== 'playing') return;
  // 滑翔中：允许预输入——目标必须是目的地（state.at）的相邻节点，到达后自动走
  if (state.glide) {
    if (idx !== state.at && adjacentOf(state.at).includes(idx) && (state.unlimited || state.stepsLeft > 0)) {
      state.queuedWalk = idx;
    }
    return;
  }
  if (idx === state.at) return;
  if (!adjacentOf(state.at).includes(idx)) return;
  if (!state.unlimited && state.stepsLeft <= 0) return;

  state.queuedWalk = null;
  if (!state.unlimited) state.stepsLeft--;
  state.at = idx;
  state.visited.push(idx);

  const node = state.graph.nodes[idx];
  if (node.kind === 'word' && !node.collected) {
    node.collected = true;
    state.collected.push(node.word);
    state.score += scoreForWalk({ firstCollect: true });
    sfx.collect(node.word.length);
  } else {
    sfx.step(state.visited.length);
  }

  beginGlide(idx);
  refreshAdjacencyVisuals();
  updateHud();

  // 结算推迟到滑翔抵达后（结算面板不能在半路弹出）
  if (node.kind === 'goal') state.pendingEnd = 'win';
  else if (!state.unlimited && state.stepsLeft <= 0) state.pendingEnd = 'fail';
}

function beginGlide(idx) {
  const from = rig.position.clone();
  const p = state.graph.nodes[idx].pos;
  const to = new THREE.Vector3(p.x, rig.position.y, p.z); // 只水平走，高度交给视线
  state.glide = { from, to, t: 0 };
}

// ---------------- 回合流程 ----------------

function startRound(diffKey) {
  const diff = DIFFICULTIES.find((d) => d.key === diffKey) || DIFFICULTIES[1];
  state.diff = diff.key;
  state.pendingDiff = diff.key;                 // 记住难度，跨局/跨会话生效
  localStorage.setItem('rw-diff', diff.key);
  state.stepsMax = diff.steps;
  state.stepsLeft = diff.steps;
  state.unlimited = false;
  state.titleTaps = 0;
  state.eggTyped = '';
  state.at = 0;
  state.visited = [0];
  state.collected = [];
  state.score = 0;
  state.flavor = pickQuote();                    // 回合内固定，结算页可手动换
  state.glide = null;
  state.mode = 'playing';
  state.round++;

  state.graph = generateGraph({
    words: WORDS, steps: diff.steps, seed: (Date.now() ^ (state.round * 7919)) >>> 0,
    wordCount: 14 + diff.steps,
  });

  rebuildGraphScene();
  rig.position.set(0, 0, 0);                    // 回到起点
  updateHud();
  sfx.start();
  $('intro').classList.add('hidden');
  $('end').classList.add('hidden');
  $('hud').classList.remove('hidden');
  closeEndPanel();
}

function endRound(win) {
  // 防重复结算（滑翔抵达 / 调试调用都可能触发）
  if (state.mode === 'ended' || state.mode === 'ended-fail') return;
  state.mode = win ? 'ended' : 'ended-fail';
  // 计分统一由 rules.mjs 计算（与单元测试、2D/VR 结算面板共用同一份规则）
  const wordCount = new Set(state.collected).size;
  state.score += finalScore({
    win,
    stepsLeft: state.stepsLeft,
    wordCount,
    unlimited: state.unlimited,
  });
  if (win) sfx.win(); else sfx.fail();
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem('rw-best', String(state.best));
  }
  // 战绩记录（最近 N 局，含难度与彩蛋标记）
  state.history = appendRecord(state.history, {
    win,
    score: state.score,
    steps: state.visited.length - 1,
    words: wordCount,
    diff: state.diff,
    unlimited: state.unlimited,
  }, HISTORY_LIMIT);
  localStorage.setItem('rw-history', serializeHistory(state.history));
  refreshAdjacencyVisuals();                    // 关掉所有光环
  fillEnd();
  $('end').classList.remove('hidden');
  showEndPanel(win);
  updateHud();
}

// 结算数据（2D 海报与 VR 面板共用；纯计算委托给 rules.buildResult）
function resultData(win) {
  const visitedWords = state.visited
    .map((i) => state.graph.nodes[i])
    .filter((n) => n.kind === 'word')
    .map((n) => n.word);
  const r = buildResult({
    win,
    visitedWords,
    collected: state.collected,
    steps: state.visited.length - 1,
    stepsLeft: state.stepsLeft,
    unlimited: state.unlimited,
    quote: state.flavor,
  });
  return {
    win,
    poem: r.poem,
    quote: r.quote,
    score: state.score,
    best: state.best,
    words: r.words,
    steps: r.steps,
    achievements: r.achievements,
    diffName: (DIFFICULTIES.find((d) => d.key === state.diff) || DIFFICULTIES[1]).name,
    historyLine: summaryLine(summarize(state.history)),
  };
}

// ---------------- 海报导出（对齐原版「下载海报 PNG」） ----------------

function buildPosterCanvas() {
  const cv = document.createElement('canvas');
  cv.width = POSTER_SIZE.width;
  cv.height = POSTER_SIZE.height;
  const ctx = cv.getContext('2d');
  drawPoster(ctx, resultData(state.mode === 'ended'), { round: state.round });
  return cv;
}

function downloadPoster() {
  try {
    const cv = buildPosterCanvas();
    cv.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `随机游走-思想路径-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  } catch { /* 无下载能力时静默（如部分头显浏览器） */ }
}

// ---------------- 舒适性：快转（snap turn） ----------------
// 摇杆推过死区 → 转固定 30°；回中后才能再次触发，避免连续转圈致晕。
// Pico 手柄的摇杆一般在 axes[2]/axes[3]；兼容只有 axes[0]/[1] 的机型。

function applySnap(key, x) {
  const st = state.turn[key] || (state.turn[key] = { armed: true });
  const r = snapTurn({ x, armed: st.armed });
  st.armed = r.armed;
  if (r.rot) {
    rig.rotation.y = normalizeYaw(rig.rotation.y + r.rot);
    sfx.ui();
  }
  return rig.rotation.y;
}

function pollSnapTurn() {
  if (!renderer.xr.isPresenting) return;
  const session = renderer.xr.getSession?.();
  if (!session) return;
  for (const src of session.inputSources) {
    if (!src.gamepad || !src.gamepad.axes) continue;
    const axes = src.gamepad.axes;
    const x = axes.length >= 4 ? axes[2] : axes[0];
    applySnap(src.handedness || 'none', x);
  }
}

// ---------------- VR 内菜单（握键开关 · 射线点选） ----------------
// 头显里没有 DOM，难度/皮肤/音色只能进 VR 前在电脑上选 —— 这里补一个 3D 菜单：
// 一张 canvas 贴图贴在视线前方 1.1m，射线命中后用 UV 换算按钮。

let menuGroup = null, menuMesh = null, menuCanvas = null, menuCtx = null, menuTex = null, menuLayout = null;
let menuOpen = false;

function ensureMenu() {
  if (menuGroup) return;
  menuCanvas = document.createElement('canvas');
  menuCanvas.width = MENU_W;
  menuCanvas.height = MENU_H;
  menuCtx = menuCanvas.getContext('2d');
  menuTex = new THREE.CanvasTexture(menuCanvas);
  menuTex.colorSpace = THREE.SRGBColorSpace;
  menuMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, (1.1 * MENU_H) / MENU_W),
    new THREE.MeshBasicMaterial({ map: menuTex, transparent: true, depthTest: false })
  );
  menuMesh.renderOrder = 40;
  menuGroup = new THREE.Group();
  menuGroup.add(menuMesh);
  menuGroup.visible = false;
  scene.add(menuGroup);
}

function redrawMenu() {
  ensureMenu();
  menuLayout = drawMenu(menuCtx, {
    pendingDifficulty: state.pendingDiff,
    skin: state.skin,
    timbre: audio.timbre,
  });
  menuTex.needsUpdate = true;
}

function updateMenuPose() {
  if (!menuGroup) return;
  const cp = camera.getWorldPosition(new THREE.Vector3());
  const q = camera.getWorldQuaternion(new THREE.Quaternion());
  menuGroup.position.copy(new THREE.Vector3(0, -0.06, -1.1).applyQuaternion(q).add(cp));
  menuGroup.quaternion.copy(q);
}

function setMenuOpen(on) {
  ensureMenu();
  menuOpen = on;
  if (on) { redrawMenu(); updateMenuPose(); }
  menuGroup.visible = on;
  return menuOpen;
}

function applyMenuAction(id) {
  sfx.ui();
  const [kind, value] = id.split(':');
  if (kind === 'diff') {
    state.pendingDiff = value;          // 难度下一局生效（避免中途改规则）
    localStorage.setItem('rw-diff', value);
    redrawMenu();
  } else if (kind === 'skin') {
    state.skin = value;
    localStorage.setItem('rw-skin', value);
    applySkinLook();
    redrawMenu();
  } else if (kind === 'timbre') {
    audio.setTimbre(value);
    localStorage.setItem('rw-timbre', value);
    redrawMenu();
  } else if (kind === 'start') {
    startRound(state.pendingDiff);
    setMenuOpen(false);
  }
  return true;
}

// 返回 true 表示这次扳机被菜单消费掉了
function menuClick(hand) {
  if (!menuOpen || !menuMesh || !menuLayout) return false;
  const c = controllers[hand];
  if (!c) return false;
  raycaster.set(c.getWorldPosition(new THREE.Vector3()), c.getWorldDirection(new THREE.Vector3()));
  const hits = raycaster.intersectObject(menuMesh, false);
  if (!hits.length || !hits[0].uv) return false;
  // three 的 UV 原点在左下，菜单布局原点在左上
  const id = hitTestMenu(menuLayout.buttons, hits[0].uv.x, 1 - hits[0].uv.y);
  if (!id) return false;
  return applyMenuAction(id);
}

// ---------------- 2D DOM ----------------

function wire2D() {
  $('start-btn').onclick = () => { audio.unlock(); sfx.ui(); startRound('normal'); };
  document.querySelectorAll('.diff-pick').forEach((b) => {
    b.onclick = () => { audio.unlock(); sfx.ui(); startRound(b.dataset.diff); };
  });
  $('skin-btn').onclick = () => {
    const keys = Object.keys(SKINS);
    const next = keys[(keys.indexOf(state.skin) + 1) % keys.length];
    state.skin = next;
    localStorage.setItem('rw-skin', next);
    applySkinLook();
    $('skin-btn').textContent = `◍ 皮肤：${SKINS[next].name}`;
    sfx.ui();
  };
  $('timbre-btn').onclick = () => {
    const keys = Object.keys(TIMBRES);
    const next = keys[(keys.indexOf(audio.timbre) + 1) % keys.length];
    audio.setTimbre(next);
    localStorage.setItem('rw-timbre', next);
    $('timbre-btn').textContent = `♫ 音色：${TIMBRES[next].name}`;
    sfx.ui();
  };
  const savedTimbre = localStorage.getItem('rw-timbre');
  if (savedTimbre && TIMBRES[savedTimbre]) { audio.setTimbre(savedTimbre); $('timbre-btn').textContent = `♫ 音色：${TIMBRES[savedTimbre].name}`; }
  $('mute-btn').onclick = () => {
    audio.setMuted(!audio.muted);
    $('mute-btn').textContent = audio.muted ? '🔇 静音' : '🔊 音效';
    if (!audio.muted) sfx.ui();
  };
  $('poster-btn').onclick = () => { sfx.ui(); downloadPoster(); };
  $('again-btn').onclick = () => { sfx.ui(); startRound(state.pendingDiff); };
  $('requote-btn').onclick = () => rerollQuote();
  $('copy-btn').onclick = () => {
    const r = resultData(state.mode === 'ended');
    const text = `【随机游走 · 思想路径】\n${r.poem}\n「${r.quote.text}」—— ${r.quote.flavor}\n${r.steps} 步 · 收录 ${r.words.length} 词 · ${r.score} 分（最佳 ${r.best}）`;
    navigator.clipboard?.writeText(text)
      .then(() => { $('copy-btn').textContent = '已复制 ✓'; setTimeout(() => ($('copy-btn').textContent = '复制路径文案'), 1500); })
      .catch(() => {});
  };
  $('title-h').onclick = () => {
    state.titleTaps++;
    if (state.titleTaps >= 7 && !state.unlimited) {
      state.unlimited = true;
      $('title-h').textContent = '∞ 随机游走';
      sfx.egg();
      updateHud();
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') { startRound('normal'); return; }
    if (e.key === 'm' || e.key === 'M') { $('mute-btn').click(); return; }
    state.eggTyped = (state.eggTyped + e.key).slice(-4);
    if (state.eggTyped === '1024') {
      sfx.egg();
      state.score += 24;
      if (!state.unlimited) { state.unlimited = true; updateHud(); }
      $('egg-flash').classList.remove('hidden');
      setTimeout(() => $('egg-flash').classList.add('hidden'), 1600);
    }
  });
}

function applySkinLook() {
  const skin = SKINS[state.skin];
  scene.background = new THREE.Color(skin.bg);
  scene.fog = new THREE.Fog(skin.fog, 10, 32);
  const floor = scene.getObjectByName('floor');
  if (floor) floor.material.color.setHex(skin.floor);
  const grid = scene.getObjectByName('grid');
  if (grid) {
    scene.remove(grid);
    grid.geometry?.dispose?.();
    grid.material?.dispose?.();
    const g2 = new THREE.PolarGridHelper(26, 16, 10, 64, skin.grid1, skin.grid2);
    g2.position.y = 0.002;
    g2.name = 'grid';
    scene.add(g2);
  }
  if (state.graph) rebuildGraphScene();          // 重刷线/节点/信标配色
}

function updateHud() {
  // 双份 HUD id：intro 卡片里一套（round/words/score/best），游戏 HUD 一套
  $('hud-round').textContent = String(state.round + 1);
  $('hud-words').textContent = String(state.collected.length);
  $('hud-score').textContent = String(state.score);
  $('hud-best').textContent = String(state.best);
  $('hud-steps').textContent = state.unlimited ? '∞' : String(state.stepsLeft);
  $('hud-words2').textContent = String(state.collected.length);
  $('hud-score2').textContent = String(state.score);
  $('hud-best2').textContent = String(state.best);
}

function fillEnd() {
  if (!state.graph) return;
  const r = resultData(state.mode === 'ended');
  $('end-icon').textContent = r.win ? '🏁' : '🌾';
  $('end-title').textContent = r.win ? '抵达 1024' : '路，未走完';
  $('end-poem').textContent = r.poem;
  $('end-quote').textContent = `「${r.quote.text}」`;
  $('end-quote-flavor').textContent = `—— ${r.quote.flavor} 一言`;
  $('end-stats').textContent = `${r.diffName} · ${r.steps} 步 · 收录 ${r.words.length} 词 · ${r.score} 分 · 最佳 ${r.best}`;
  $('end-history').textContent = r.historyLine || '';
  $('end-history').style.display = r.historyLine ? '' : 'none';
  $('end-ach').innerHTML = r.achievements.length
    ? r.achievements.map((a) => `<span class="ach">${a.icon} ${a.name}</span>`).join('')
    : '<span class="ach" style="opacity:.45">— 本次无成就 —</span>';
  $('end-words').textContent = r.words.length ? r.words.join('、') : '（无）';
}

// ---------------- 图场景 ----------------

function clearGroup(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.geometry?.dispose?.();
    if (c.material) { (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose?.()); }
  }
}

let graphRoot = null;

const ekey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

// 节点半径 / 配色 / 颜色换算（合批几何用纯数值，不再依赖 three 的 Color 对象）
function nodeRadius(nd) {
  if (nd.kind === 'goal') return NODE_SCALE * 1.9;
  if (nd.kind === 'start') return NODE_SCALE * 1.4;
  return NODE_SCALE;
}
function nodeColor(nd, skin) {
  if (nd.kind === 'start') return skin.start;
  if (nd.kind === 'goal') return skin.goal;
  return skin.word;
}
function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function rebuildGraphScene() {
  if (!graphRoot) {
    graphRoot = new THREE.Group();
    scene.add(graphRoot);
  }
  clearGroup(graphRoot);
  nodeGroup = new THREE.Group();
  lineGroup = new THREE.Group();
  graphRoot.add(nodeGroup, lineGroup);
  pickables = [];

  const skin = SKINS[state.skin];
  const { nodes, edges } = state.graph;

  // ── 边：全部合批成 1 个 LineSegments（顶点色区分墨线/轨迹） ──
  const eg = buildEdgeGeometry(nodes, edges);
  edgeColors = eg.colors;
  edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(eg.positions, 3));
  edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3));
  edgeLines = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 })
  );
  lineGroup.add(edgeLines);

  edgeIndexByKey.clear();
  edgeKeys = edges.map(([a, b], k) => {
    const key = ekey(a, b);
    edgeIndexByKey.set(key, k);
    return key;
  });

  // ── 词球：全部合批成 1 个 Mesh（光照烘焙进顶点色，运行时零光照成本） ──
  const bg = buildNodeSpheres(nodes, {
    segments: 14,
    rings: 10,
    radiusOf: (i) => nodeRadius(nodes[i]),
    colorOf: (i) => hexToRgb(nodeColor(nodes[i], skin)),
  });
  ballNormals = bg.normals;
  ballRanges = bg.ranges;
  ballFaceToNode = bg.faceToNode;
  ballsGeo = new THREE.BufferGeometry();
  ballsGeo.setAttribute('position', new THREE.BufferAttribute(bg.positions, 3));
  ballsGeo.setAttribute('normal', new THREE.BufferAttribute(bg.normals, 3));
  ballsGeo.setAttribute('color', new THREE.BufferAttribute(bg.colors, 3));
  ballsGeo.setIndex(new THREE.BufferAttribute(bg.indices, 1));
  ballsMesh = new THREE.Mesh(ballsGeo, new THREE.MeshBasicMaterial({ vertexColors: true }));
  nodeGroup.add(ballsMesh);
  pickables = [ballsMesh];

  // ── 每节点仍保留一个 Group，只装词标签与脉冲光环（球体已合批） ──
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    const g = new THREE.Group();
    g.position.copy(nd.pos);

    const r = nodeRadius(nd);
    // 词标签：canvas 按字数裁宽，避免大片透明空边导致显小
    const label = makeTextSprite(nd.word, {
      size: nd.kind === 'goal' ? 84 : 64,
      color: '#f2f6ff',
      glow: nd.kind !== 'word',
    });
    label.position.y = r + 0.17;
    label.scale.set(0.19 * (label.material.map.image.width / label.material.map.image.height), 0.19, 1);
    g.add(label);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(PULSE_R0, PULSE_R0 + 0.05, 32),
      new THREE.MeshBasicMaterial({ color: skin.halo, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.14;
    halo.visible = false;
    g.add(halo);

    g.userData = { nodeIdx: i, halo, label };
    nodeGroup.add(g);
    nd._obj = g;
  }

  // 终点光柱信标
  beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.2, 8, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: skin.goal, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false })
  );
  beacon.position.copy(nodes[state.graph.goalIdx].pos).add(new THREE.Vector3(0, 3.6, 0));
  graphRoot.add(beacon);
  refreshAdjacencyVisuals();
}

function refreshAdjacencyVisuals() {
  if (!state.graph || !ballsGeo) return;
  const skin = SKINS[state.skin];
  const adj = adjacentOf(state.at);
  const canWalk = state.mode === 'playing' && (state.unlimited || state.stepsLeft > 0);

  // 词球：只回写受影响的顶点色，不改对象数量
  const colors = ballsGeo.attributes.color.array;
  for (let i = 0; i < state.graph.nodes.length; i++) {
    const nd = state.graph.nodes[i];
    if (!nd._obj) continue;
    const isAdj = adj.includes(i);
    const isHere = i === state.at;
    nd._obj.userData.halo.visible = isAdj && canWalk;

    let color = nodeColor(nd, skin);
    let brightness = 1;
    if (nd.kind === 'word' && nd.collected && !isHere) {
      color = skin.wordVisited;      // 收录过的词转灰，给玩家"已采"的反馈
      brightness = 0.8;
    }
    if (isHere) brightness = 1.55;   // 当前节点最亮
    else if (isAdj) brightness = 1.22; // 可走节点次亮
    recolorNode(colors, ballNormals, ballRanges, i, { color: hexToRgb(color), brightness });

    nd._obj.userData.label.material.opacity = nd.collected && nd.kind === 'word' ? 0.45 : 1;
  }
  ballsGeo.attributes.color.needsUpdate = true;

  // 边：先铺墨色，再把走过的边染成轨迹色
  const trail = new Set();
  for (let i = 0; i + 1 < state.visited.length; i++) {
    const k = edgeIndexByKey.get(ekey(state.visited[i], state.visited[i + 1]));
    if (k !== undefined) trail.add(k);
  }
  const lineC = hexToRgb(skin.line);
  const trailC = hexToRgb(skin.trail);
  paintEdges(edgeColors, edgeKeys.length, (k) => (trail.has(k) ? trailC : lineC));
  edgeGeo.attributes.color.needsUpdate = true;
}

// ---------------- 文本精灵 ----------------

function makeTextSprite(text, { size = 48, color = '#ffffff', glow = false } = {}) {
  const pad = 36;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `${size}px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  const wText = Math.ceil(probe.measureText(text).width);
  const cv = document.createElement('canvas');
  cv.width = wText + pad * 2;
  cv.height = size + pad * 2;
  const c2d = cv.getContext('2d');
  c2d.font = `${size}px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  c2d.textAlign = 'center';
  c2d.textBaseline = 'middle';
  if (glow) { c2d.shadowColor = color; c2d.shadowBlur = 22; }
  c2d.fillStyle = color;
  c2d.fillText(text, cv.width / 2, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.renderOrder = 5;
  return sp;
}

// 兼容旧 Chromium（Pico 浏览器可能没有 roundRect）
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------------- VR 内 HUD（贴在视线前方的半透明面板） ----------------
// 文本变化才重建纹理（canvas 上传纹理每帧做会明显掉帧，Pico 72Hz 必须省）

let hudCache = { key: '', tex: null };

function panelTexture(lines) {
  const key = lines.join('|');
  if (hudCache.key === key) return hudCache.tex;
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 144;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(13,18,38,0.9)';
  rrect(c, 4, 4, 504, 136, 22);
  c.fill();
  c.strokeStyle = 'rgba(140,165,255,0.35)';
  c.lineWidth = 3;
  c.stroke();
  c.fillStyle = '#dfe7ff';
  c.font = '40px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  c.textAlign = 'center';
  lines.forEach((s, i) => c.fillText(s, 256, 58 + i * 50));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (hudCache.tex) hudCache.tex.dispose();
  hudCache = { key, tex };
  return tex;
}

let hudFrame = 0;
function updateVrHud() {
  const presenting = renderer.xr.isPresenting;
  if (!presenting) {
    if (hudGroup) hudGroup.visible = false;
    return;
  }
  // 位置随头动每帧更新；纹理只在文本变化时重建（panelTexture 内有缓存）。
  // 桌面无 VR 时不进这里，主循环成本只剩 render。
  if (!hudGroup) {
    hudGroup = new THREE.Group();
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
    spr.renderOrder = 20;
    hudGroup.add(spr);
    hudGroup.userData.spr = spr;
    scene.add(hudGroup);
  }
  hudGroup.visible = state.mode === 'playing' || state.mode === 'intro';
  if (!hudGroup.visible) return;
  const spr = hudGroup.userData.spr;
  if (state.mode === 'intro') {
    spr.material.map = panelTexture(['随机游走 · 步数内抵达 1024', '扣扳机 → 开始游走']);
  } else {
    const steps = state.unlimited ? '∞' : `${state.stepsLeft}`;
    spr.material.map = panelTexture([
      `步数 ${steps} · 词 ${state.collected.length} · ${state.score} 分`,
      '瞄准光环节点 · 扣扳机行走',
    ]);
  }
  spr.material.needsUpdate = true;
  spr.scale.set(0.7, 0.197, 1);
  const cp = new THREE.Vector3();
  camera.getWorldPosition(cp);
  const p = new THREE.Vector3(0, 0, -1.15).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())).add(cp);
  hudGroup.position.copy(p);
  hudGroup.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
}

// ---------------- VR 结算面板（射线点「换一句」/「再来一局」） ----------------

let forceEndPanel = false;   // 测试用：桌面模式下也构造成结算面板以便断言

function showEndPanel(win) {
  if (!renderer.xr.isPresenting && !forceEndPanel) return;
  closeEndPanel();
  endGroup = new THREE.Group();
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: endPanelTexture(win), transparent: true, depthTest: false }));
  spr.scale.set(1.0, 1.0, 1);
  spr.renderOrder = 30;
  endGroup.add(spr);
  // 两个按钮的命中区（不可见平面）：左「换一句」右「再来一局」
  const mkHit = (x, action) => {
    const h = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.10),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    h.position.set(x, -0.41, 0.001);
    h.userData.action = action;
    endGroup.add(h);
    return h;
  };
  const hits = [mkHit(-0.25, 'requote'), mkHit(0.25, 'again')];
  endGroup.userData.hits = hits;
  const cp = new THREE.Vector3();
  camera.getWorldPosition(cp);
  const q = camera.getWorldQuaternion(new THREE.Quaternion());
  // 结算面板随玩家视线前方 1.4m，略低（不挡星空）
  endGroup.position.copy(new THREE.Vector3(0, -0.08, -1.4).applyQuaternion(q).add(cp));
  endGroup.quaternion.copy(q);
  scene.add(endGroup);
}

function closeEndPanel() {
  if (endGroup) {
    scene.remove(endGroup);
    endGroup = null;
  }
}

function endPanelTexture(win) {
  const r = resultData(win);
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(11,16,32,0.96)';
  rrect(c, 6, 6, 500, 500, 28);
  c.fill();
  c.strokeStyle = win ? 'rgba(255,207,77,0.8)' : 'rgba(140,165,255,0.5)';
  c.lineWidth = 4;
  c.stroke();
  c.textAlign = 'center';
  c.fillStyle = win ? '#ffcf4d' : '#dfe7ff';
  c.font = 'bold 54px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  c.fillText(win ? '抵达 1024' : '路未走完', 256, 80);
  c.fillStyle = '#8b96b8';
  c.font = '28px sans-serif';
  c.fillText(`${r.diffName} · ${r.steps} 步 · ${r.words.length} 词 · ${r.score} 分`, 256, 126);
  if (r.historyLine) {
    c.fillStyle = '#6f7a99';
    c.font = '22px sans-serif';
    c.fillText(r.historyLine, 256, 160);
  }
  c.fillStyle = '#e8eeff';
  c.font = '34px "PingFang SC", "Microsoft YaHei", sans-serif';
  wrapText(c, r.poem, 256, 212, 440, 44, 3);
  c.fillStyle = '#b18cff';
  c.font = 'italic 29px "PingFang SC", serif';
  wrapText(c, `「${r.quote.text}」`, 256, 330, 440, 38, 2);
  c.fillStyle = '#8b96b8';
  c.font = '26px sans-serif';
  c.fillText(`— ${r.quote.flavor} —`, 256, 408);

  // 两个按钮：左「换一句」右「再来一局」
  const drawBtn = (label, cx, fill, stroke, color, bold) => {
    c.fillStyle = fill;
    c.strokeStyle = stroke;
    c.lineWidth = 3;
    rrect(c, cx - 100, 442, 200, 56, 16);
    c.fill(); c.stroke();
    c.fillStyle = color;
    c.font = `${bold ? 'bold ' : ''}30px "PingFang SC","Microsoft YaHei",sans-serif`;
    c.fillText(label, cx, 477);
  };
  drawBtn('↻ 换一句', 128, 'rgba(40,52,90,0.9)', 'rgba(140,165,255,0.5)', '#cfd8ff', false);
  drawBtn('▸ 再来一局', 384, win ? 'rgba(70,110,200,0.85)' : 'rgba(120,70,90,0.85)',
    win ? 'rgba(150,200,255,0.9)' : 'rgba(255,150,140,0.8)', '#ffffff', true);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function wrapText(c, text, x, y, maxW, lineH, maxLines) {
  let line = '', lines = 0;
  for (const ch of text) {
    if (c.measureText(line + ch).width > maxW) {
      c.fillText(line, x, y + lines * lineH);
      lines++; line = ch;
      if (lines >= maxLines - 1) break;
    } else line += ch;
  }
  if (line && lines < maxLines) c.fillText(line, x, y + lines * lineH);
}

function endPanelClick(hand) {
  if (!endGroup) return false;
  const c = controllers[hand];
  if (!c) return false;
  raycaster.set(c.getWorldPosition(new THREE.Vector3()), c.getWorldDirection(new THREE.Vector3()));
  const hits = raycaster.intersectObjects(endGroup.userData.hits, false);
  if (!hits.length) return false;
  return handleEndPanelAction(hits[0].object.userData.action);
}

// 结算面板按钮的动作分发（射线点击与测试钩子共用同一条路径）
function handleEndPanelAction(action) {
  if (action === 'again') {
    sfx.ui();
    startRound(state.pendingDiff);       // 保持玩家当前难度选择，而不是硬编码
    return true;
  }
  if (action === 'requote') {
    rerollQuote();
    return true;
  }
  return false;
}

// 结算面板上「换一句」：重选一言并重绘面板（VR 内也能换）
function rerollQuote() {
  state.flavor = pickQuote();
  fillEnd();
  showEndPanel(state.mode === 'ended');
  sfx.ui();
}

// ---------------- 主循环 ----------------

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = performance.now() / 1000;

  // 滑翔（水平缓动）
  if (state.glide) {
    const g = state.glide;
    const dist = Math.max(0.3, g.from.distanceTo(g.to));
    g.t += (dt * GLIDE_SPEED) / dist;
    const k = Math.min(1, g.t);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
    rig.position.lerpVectors(g.from, g.to, e);
    if (k >= 1) {
      state.glide = null;
      // 抵达后结算（win / fail 都要等玩家站定）
      if (state.pendingEnd) {
        const w = state.pendingEnd === 'win';
        state.pendingEnd = null;
        endRound(w);
      } else if (state.queuedWalk != null) {
        const q = state.queuedWalk;
        state.queuedWalk = null;
        tryWalk(q);               // 滑翔中的预输入：连走
      }
    }
  }

  if (nodeGroup && state.graph) {
    // 脉冲光环
    const s = 1 + Math.sin(t * 3.2) * 0.12;
    for (const nd of state.graph.nodes) {
      if (nd._obj?.userData.halo.visible) nd._obj.userData.halo.scale.setScalar(s);
      // 词标签轻微呼吸漂浮
      if (nd._obj && nd.kind === 'word') {
        nd._obj.position.y = nd.pos.y + Math.sin(t * 1.1 + nd.pos.x * 2.3) * 0.035;
      }
    }
    if (beacon) beacon.material.opacity = 0.12 + Math.sin(t * 1.8) * 0.05;
  }

  if (starfield) starfield.rotation.y = t * 0.004;

  pollSnapTurn();
  if (menuOpen) updateMenuPose();
  updateVrHud();
  renderer.render(scene, camera);
}
