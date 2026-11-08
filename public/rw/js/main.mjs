// 随机游走 VR — 主程序
// Three.js r160 + WebXR，适配 Pico Neo3。
// 原版网页玩法 → 3D 化：
//   · 词节点悬浮成星座，墨线连边；从朱砂「出发」走到赤金「1024」；
//   · 手柄射线瞄准带脉冲光环的相邻节点，扣扳机即「走一步」（水平滑翔过去）；
//   · 每步耗一步数，路过收录词；步数耗尽未达 1024 = 失败（海报依然生成）；
//   · 彩蛋：连点标题七次解除步数限制；键盘敲出 1024 触发音效与成就。
import * as THREE from '../../vendor/three.module.min.js';
import { VRButton } from '../../vendor/VRButton.js';
import { WORDS, QUOTES, FLAVORS, SKINS, TIMBRES, ACHIEVEMENTS, DIFFICULTIES, SCORE } from './data.mjs';
import { generateGraph } from './graph.mjs';
import { sfx, audio } from './audio.mjs';

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
  round: 0,
  skin: localStorage.getItem('rw-skin') || 'ink',
  glide: null,                  // {from, to, t} 滑翔动画
  queuedWalk: null,             // 滑翔中的预输入（到达后自动走）
  pendingEnd: null,             // 'win' | 'fail'：滑翔到达后再结算（面板不能在滑翔中出现）
  flavor: null,                 // 结算选中的一言
  eggTyped: '',                 // 1024 键盘彩蛋
  titleTaps: 0,                 // 标题连点计数
};

let renderer, scene, camera, rig, controllers = {};
let nodeGroup, lineGroup, beacon, starfield;
const lineObjs = new Map();     // 边 key → Line 对象（走过的边高亮用）
let pickables = [];             // 可射线节点 mesh
let hudGroup = null;            // VR 内 HUD 面板
let endGroup = null;            // VR 结算面板
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();

const $ = (id) => document.getElementById(id);

// ---------------- 启动 ----------------

initScene();
wire2D();
renderer.setAnimationLoop(animate);
window.__rw = { state, startRound, endRound, tryWalk, audio, sfx, rendererInfo: () => renderer.info.render }; // 测试钩子


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
    rig.add(c);                                 // 跟随玩家滑翔
    controllers[handed] = c;
  }
}

// 射线当前瞄准的节点 idx（null = 没瞄准）
function aimedNode(hand) {
  const c = controllers[hand];
  if (!c) return null;
  raycaster.set(c.getWorldPosition(new THREE.Vector3()), c.getWorldDirection(new THREE.Vector3()));
  raycaster.far = RAY_LEN;
  const hits = raycaster.intersectObjects(pickables, false);
  return hits.length ? hits[0].object.userData.nodeIdx : null;
}

function onSelect(hand) {
  audio.unlock();
  if (state.mode !== 'playing') {
    // VR 内没有 DOM：引导态扣扳机 = 直接开局（结算面板由 endPanelClick 处理）
    if (state.mode === 'intro' && renderer.xr.isPresenting) { sfx.ui(); startRound('normal'); return; }
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
    state.score += SCORE.word;
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
  state.mode = win ? 'ended' : 'ended-fail';
  if (win) {
    state.score += SCORE.win + Math.max(0, state.stepsLeft) * SCORE.stepLeft;
    sfx.win();
  } else {
    sfx.fail();
  }
  if (state.collected.length >= 10) state.score += 50;
  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem('rw-best', String(state.best));
  }
  refreshAdjacencyVisuals();                    // 关掉所有光环
  fillEnd();
  $('end').classList.remove('hidden');
  showEndPanel(win);
  updateHud();
}

// 结算数据（2D 海报与 VR 面板共用）
function resultData(win) {
  const pathWords = state.visited
    .map((i) => state.graph.nodes[i])
    .filter((n) => n.kind === 'word')
    .map((n) => n.word);
  const uniq = [...new Set(pathWords)];
  const poem = uniq.length
    ? uniq.slice(0, 8).join(' · ') + (uniq.length > 8 ? ' …' : '')
    : '（一条无言的路）';
  const achievements = [];
  if (win) achievements.push(ACHIEVEMENTS.reach);
  if (win && state.stepsLeft >= 5) achievements.push(ACHIEVEMENTS.calm);
  if (state.collected.length >= 10) achievements.push(ACHIEVEMENTS.pearls);
  if (!win && state.collected.length >= 6) achievements.push(ACHIEVEMENTS.stroll);
  if (state.unlimited) achievements.push(ACHIEVEMENTS.egg);
  return {
    win, poem,
    quote: state.flavor || pickQuote(),
    score: state.score, best: state.best,
    words: uniq,
    steps: state.visited.length - 1,
    achievements,
  };
}

function pickQuote() {
  const f = FLAVORS[Math.floor(Math.random() * FLAVORS.length)];
  const list = QUOTES[f];
  return { flavor: f, text: list[Math.floor(Math.random() * list.length)] };
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
  $('again-btn').onclick = () => { sfx.ui(); startRound('normal'); };
  $('requote-btn').onclick = () => {
    state.flavor = pickQuote();
    fillEnd();
    sfx.ui();
  };
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
  $('end-stats').textContent = `${r.steps} 步 · 收录 ${r.words.length} 词 · ${r.score} 分 · 最佳 ${r.best}`;
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
  lineObjs.clear();

  const skin = SKINS[state.skin];
  const { nodes, edges } = state.graph;

  // 边线：每条边独立材质（走过的边要单独染色，共享材质会全图变色）
  for (const [a, b] of edges) {
    const geo = new THREE.BufferGeometry().setFromPoints([nodes[a].pos, nodes[b].pos]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: skin.line, transparent: true, opacity: 0.75 }));
    lineGroup.add(line);
    lineObjs.set(ekey(a, b), line);
  }

  // 节点
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    const g = new THREE.Group();
    g.position.copy(nd.pos);

    const color = nd.kind === 'start' ? skin.start : nd.kind === 'goal' ? skin.goal : skin.word;
    const r = nd.kind === 'goal' ? NODE_SCALE * 1.9 : nd.kind === 'start' ? NODE_SCALE * 1.4 : NODE_SCALE;
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(r, 20, 14),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        metalness: 0.0,
        // 词球弱发光防过曝；起点/终点保持亮
        emissive: color,
        emissiveIntensity: nd.kind === 'word' ? 0.05 : 0.3,
      })
    );
    ball.userData.nodeIdx = i;
    g.add(ball);

    // 词标签：canvas 按字数裁宽，避免大片透明空边导致显小
    const label = makeTextSprite(nd.word, {
      size: nd.kind === 'goal' ? 84 : 64,
      color: '#f2f6ff',
      glow: nd.kind !== 'word',
    });
    label.position.y = r + 0.17;
    // 精灵贴图已按字数裁宽：scale 保持贴图纵横比（高 0.19m）
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

    g.userData = { nodeIdx: i, ball, halo, label, baseLabelColor: '#f2f6ff' };
    nodeGroup.add(g);
    nd._obj = g;
    pickables.push(ball);
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
  if (!state.graph) return;
  const skin = SKINS[state.skin];
  const adj = adjacentOf(state.at);
  const canWalk = state.mode === 'playing' && (state.unlimited || state.stepsLeft > 0);
  for (let i = 0; i < state.graph.nodes.length; i++) {
    const nd = state.graph.nodes[i];
    if (!nd._obj) continue;
    const isAdj = adj.includes(i);
    const isHere = i === state.at;
    nd._obj.userData.halo.visible = isAdj && canWalk;
    const ball = nd._obj.userData.ball;
    if (isHere) {
      ball.material.emissiveIntensity = 1.0;
      ball.scale.setScalar(1.25);
    } else if (isAdj) {
      ball.material.emissiveIntensity = 0.7;
      ball.scale.setScalar(1.08);
    } else {
      ball.material.emissiveIntensity = nd.kind === 'word' ? 0.18 : 0.5;
      ball.scale.setScalar(nd.collected ? 0.82 : 1.0);
    }
    nd._obj.userData.label.material.opacity = nd.collected && nd.kind === 'word' ? 0.45 : 1;
    if (nd.kind === 'word' && nd.collected) {
      ball.material.color.setHex(skin.wordVisited);
      ball.material.emissive.setHex(skin.wordVisited);
    }
  }
  // 边：全部恢复墨色，走过的边染上轨迹色
  for (const line of lineObjs.values()) line.material.color.setHex(skin.line);
  for (let i = 0; i + 1 < state.visited.length; i++) {
    const line = lineObjs.get(ekey(state.visited[i], state.visited[i + 1]));
    if (line) line.material.color.setHex(skin.trail);
  }
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

// ---------------- VR 结算面板（射线点「再来一局」） ----------------

function showEndPanel(win) {
  if (!renderer.xr.isPresenting) return;
  closeEndPanel();
  endGroup = new THREE.Group();
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: endPanelTexture(win), transparent: true, depthTest: false }));
  spr.scale.set(1.0, 1.0, 1);
  spr.renderOrder = 30;
  endGroup.add(spr);
  const hit = new THREE.Mesh(
    new THREE.PlaneGeometry(0.66, 0.1),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hit.position.set(0, -0.215, 0.001);
  endGroup.add(hit);
  endGroup.userData.hit = hit;
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
  c.fillText(win ? '抵达 1024' : '路未走完', 256, 84);
  c.fillStyle = '#8b96b8';
  c.font = '30px sans-serif';
  c.fillText(`${r.steps} 步 · ${r.words.length} 词 · ${r.score} 分`, 256, 132);
  c.fillStyle = '#e8eeff';
  c.font = '34px "PingFang SC", "Microsoft YaHei", sans-serif';
  wrapText(c, r.poem, 256, 188, 440, 46, 3);
  c.fillStyle = '#b18cff';
  c.font = 'italic 30px "PingFang SC", serif';
  wrapText(c, `「${r.quote.text}」`, 256, 320, 440, 40, 2);
  c.fillStyle = '#8b96b8';
  c.font = '28px sans-serif';
  c.fillText(`— ${r.quote.flavor} —`, 256, 402);
  c.fillStyle = win ? '#6dffa8' : '#ff8866';
  c.font = 'bold 40px sans-serif';
  c.fillText('▸ 再来一局', 256, 466);
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
  if (!endGroup) return;
  const c = controllers[hand];
  if (!c) return;
  raycaster.set(c.getWorldPosition(new THREE.Vector3()), c.getWorldDirection(new THREE.Vector3()));
  if (raycaster.intersectObject(endGroup.userData.hit).length) {
    sfx.ui();
    startRound('normal');
  }
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

  updateVrHud();
  renderer.render(scene, camera);
}
