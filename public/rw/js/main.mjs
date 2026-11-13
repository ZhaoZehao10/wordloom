// 拾径 Wordloom — 主程序
// Three.js r160 + WebXR，适配 Pico Neo3。
// 玩法概览：
//   · 词节点悬浮成星座，墨线连边；从朱砂「出发」走到赤金「1024」；
//   · 手柄射线瞄准带脉冲光环的相邻节点，扣扳机即「走一步」（水平滑翔过去）；
//   · 每步耗一步数，路过收录词；步数耗尽未达 1024 = 失败（海报依然生成）；
//   · 彩蛋：连点标题七次解除步数限制；键盘敲出 1024 触发音效与成就。
import * as THREE from '../../vendor/three.module.min.js';
import { VRButton } from '../../vendor/VRButton.js';
import { WORDS, WORD_PACKS, PACK_KEYS, ALL_WORDS, TOTAL_WORDS, normalizePack, packProgress, SKINS, TIMBRES, DIFFICULTIES } from './data.mjs';
import { generateGraph } from './graph.mjs';
import { sfx, audio } from './audio.mjs';
import { buildEdgeGeometry, paintEdges, buildNodeSpheres, recolorNode } from './geometry.mjs';
import { scoreForWalk, finalScore, buildResult, pickQuote, snapTurn, normalizeYaw } from './rules.mjs';
import { drawPoster, POSTER_SIZE } from './poster.mjs';
import { drawMenu, hitTestMenu, MENU_W, MENU_H } from './menu.mjs';
import { ACHIEVEMENTS } from './data.mjs';
// qrcode 由 vendor/qrcode.js（UMD）提供全局变量
const qrLib = window.qrcode;
import { shareStatsText, shareAchievementsText, shareWeeklyText, SITE_URL } from './share.mjs';
import {
  appendRecord, summarize, parseHistory, serializeHistory, summaryLine, HISTORY_LIMIT,
  parseCollection, serializeCollection, addToCollection, collectionProgress, diffsWon,
  parseAchievements, unlockAchievements, newAchievements, collectionHint, careerStats, ACHIEVEMENTS_KEY,
} from './stats.mjs';
import { renderTonePCM, toneKey, stepFreq } from './spatial.mjs';
import { buildReplayPath, replayAt, replayDuration } from './replay.mjs';
import { dailyKey, dailySeed, dailyDifficulty, parseDaily, dailyStatus, dailyRecord, parseDailyHistory, appendDailyHistory, dailyBoard, monthGrid, monthSummary, dailyStreak, streakBonus, dailyBest, weekKey, weekSeed, weekDifficulty, parseWeekly, weeklyStatus, weeklyRecord, weeklyBoard, parseWeeklyHistory, appendWeeklyHistory, WEEKLY_HISTORY_KEY, DAILY_HISTORY_KEY } from './daily.mjs';
import { exportSave, importSave, resetValues } from './save.mjs';
import { tr, normalizeLang, applyDomI18n, LANG_KEY } from './i18n.mjs';
import { parseTutorialDone, shouldShowTutorial, tutorialDoneValue, TUTORIAL_DONE_KEY, TUTORIAL_STEPS } from './tutorial.mjs';
import { normalizeMoveMode, nextMoveMode } from './rules.mjs';
import { vignetteOpacity, clampVolume, volumeToPercent, seatedOffset } from './comfort.mjs';
import { barLayout } from './chart.mjs';

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
  collection: parseCollection(localStorage.getItem('rw-collection') || ''), // 跨局词集
  roundNew: [],                 // 本局新收录（词集里原本没有的）
  diff: 'normal',               // 本局难度 key
  isDaily: false,               // 本局是否为每日挑战
  isWeekly: false,              // 本局是否为每周挑战
  weekly: parseWeekly(localStorage.getItem('rw-weekly') || ''), // 本周成绩
  weeklyHistory: parseWeeklyHistory(localStorage.getItem(WEEKLY_HISTORY_KEY) || ''), // 周榜
  dailyBonus: 0,                // 每日挑战的连续打卡奖励步数
  dailyKey: null,               // 每日挑战的日期键
  daily: parseDaily(localStorage.getItem('rw-daily') || ''),  // 今日挑战成绩
  unlocked: parseAchievements(localStorage.getItem(ACHIEVEMENTS_KEY) || ''), // 已解锁成就 key
  lang: normalizeLang(localStorage.getItem(LANG_KEY) || 'zh'), // 界面语言
  moveMode: normalizeMoveMode(localStorage.getItem('rw-move') || 'glide'), // 滑翔 / 瞬移
  tutorialDone: parseTutorialDone(localStorage.getItem(TUTORIAL_DONE_KEY) || ''),
  pack: normalizePack(localStorage.getItem('rw-pack') || 'classic'),
  volume: clampVolume(localStorage.getItem('rw-volume') ?? 0.8),
  vignette: localStorage.getItem('rw-vignette') !== '0',
  seated: Number(localStorage.getItem('rw-seated') || '0') || 0,
  dailyHistory: parseDailyHistory(localStorage.getItem(DAILY_HISTORY_KEY) || ''),
  frozen: false,                // 视觉回归用：冻结时间相关动画
  round: 0,
  skin: localStorage.getItem('rw-skin') || 'ink',
  glide: null,                  // {from, to, t} 滑翔动画
  queuedWalk: null,             // 滑翔中的预输入（到达后自动走）
  pendingEnd: null,             // 'win' | 'fail'：滑翔到达后再结算（面板不能在滑翔中出现）
  replay: null,                 // 路径回放 { path, t0, duration }
  replayPrevMode: null,         // 回放前的结算态，用于停止后恢复
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
let vignetteMesh = null;        // 防晕视野遮罩（挂在相机上）
let endGroup = null;            // VR 结算面板
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();

const $ = (id) => document.getElementById(id);
const L = (s) => tr(s, state.lang);

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
  // 路径回放
  debugStartReplay: () => startReplay(),
  debugStopReplay: () => stopReplay(),
  replayInfo: () => (state.replay ? {
    points: state.replay.path.length,
    duration: state.replay.duration,
    elapsed: Math.round(performance.now() - state.replay.t0),
    rig: { x: +rig.position.x.toFixed(3), y: +rig.position.y.toFixed(3), z: +rig.position.z.toFixed(3) },
  } : null),
  // 空间音效（桌面无 XR：playSpatial 会返回 false，用于验证回落逻辑）
  debugSpatial: (opts) => {
    const ok = playSpatial({ pos: opts?.pos || { x: 0, y: 1, z: -1 }, freq: opts?.freq || 880 });
    return { played: ok, poolSize: pannerPool.length, hasListener: !!audioListener };
  },
  debugRerollQuote: () => { rerollQuote(); return state.flavor; },
  debugQuote: () => state.flavor,
  // 新手引导 / 移动模式 / 语言（测试与诊断用）
  tutorialInfo: () => ({ open: tutorialOpen, done: state.tutorialDone }),
  debugShowTutorial: () => { showTutorial(); return true; },
  debugDismissTutorial: () => dismissTutorial(),
  debugResetTutorial: () => { state.tutorialDone = false; localStorage.removeItem(TUTORIAL_DONE_KEY); return true; },
  moveModeInfo: () => state.moveMode,
  debugRig: () => ({ x: rig.position.x, y: rig.position.y, z: rig.position.z }),
  debugStartSeeded: (seed) => { startRound('normal', { seed }); return true; },
  debugFreeze: (on) => { state.frozen = on !== false; return state.frozen; },
  // 词包 / 每日 7 日榜 / 舒适性
  packInfo: () => ({ pack: state.pack, packs: PACK_KEYS, words: WORD_PACKS[state.pack].words.length, total: TOTAL_WORDS }),
  packList: () => WORD_PACKS[state.pack].words.slice(),
  debugSetPack: (k) => { state.pack = normalizePack(k); localStorage.setItem('rw-pack', state.pack); applyPackTheme(state.pack); refreshPackUI(); return state.pack; },
  dailyHistoryInfo: () => ({ history: state.dailyHistory.slice(), board: dailyBoard(state.dailyHistory, dailyKey(), 7) }),
  debugSetDailyHistory: (rows) => { state.dailyHistory = parseDailyHistory(JSON.stringify(rows || [])); updateHud(); return state.dailyHistory.length; },
  debugRefreshHud: () => { updateHud(); return true; },
  chartInfo: () => {
    const cv = $('daily-chart');
    if (!cv) return { ok: false };
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
    return { ok: true, width: cv.width, height: cv.height, litPixels: lit };
  },
  volumeInfo: () => ({ volume: state.volume, muted: audio.muted, percent: volumeToPercent(state.volume) }),
  debugSetVolume: (v) => { state.volume = clampVolume(v); audio.setVolume(state.volume); localStorage.setItem('rw-volume', String(state.volume)); return state.volume; },
  vignetteInfo: () => ({ enabled: state.vignette, opacity: vignetteMesh ? +vignetteMesh.material.opacity.toFixed(3) : -1 }),
  debugToggleVignette: () => { state.vignette = !state.vignette; localStorage.setItem('rw-vignette', state.vignette ? '1' : '0'); return state.vignette; },
  debugCalibrateSeated: (headY) => {
    const off = seatedOffset(headY);
    state.seated = off;
    localStorage.setItem('rw-seated', String(off));
    rig.position.y = off;
    return off;
  },
  seatedInfo: () => ({ offset: state.seated, rigY: +rig.position.y.toFixed(3) }),
  debugSetMoveMode: (m) => {
    state.moveMode = normalizeMoveMode(m);
    localStorage.setItem('rw-move', state.moveMode);
    return state.moveMode;
  },
  langInfo: () => ({ lang: state.lang, html: document.documentElement.lang }),
  debugSetLang: (l) => {
    state.lang = normalizeLang(l);
    localStorage.setItem(LANG_KEY, state.lang);
    refreshLangUI();
    if (menuOpen) redrawMenu();
    return state.lang;
  },
  // 每日挑战
  dailyInfo: () => ({
    key: dailyKey(),
    seed: dailySeed(dailyKey()),
    difficulty: dailyDifficulty(dailyKey()),
    status: dailyStatus(state.daily, dailyKey()),
    isDaily: state.isDaily,
  }),
  debugStartDaily: () => startRound(null, { daily: dailyKey() }),
  weeklyInfo: () => ({ key: weekKey(), seed: weekSeed(weekKey()), difficulty: weekDifficulty(weekKey()), status: weeklyStatus(state.weekly, weekKey()), isWeekly: state.isWeekly }),
  debugStartWeekly: () => startRound(null, { weekly: weekKey() }),
  // 存档
  exportSaveText: () => exportSave(collectSave()),
  importSaveText: (text) => {
    const r = importSave(text);
    if (r.ok) applySave(r.data);
    return r.ok ? { ok: true, best: r.data.best, collection: r.data.collection.length } : r;
  },
  resetAll: () => resetAll(true),
  // 词集（跨局元进度）
  collectionInfo: () => ({
    count: state.collection.length,
    progress: collectionProgress(state.collection, TOTAL_WORDS),
    roundNew: state.roundNew.slice(),
    persisted: parseCollection(localStorage.getItem('rw-collection') || '').length,
  }),
  debugOpenCollection: () => openCollection(),
  debugOpenMonth: () => openMonth(),
  debugWeeklyPoster: () => buildWeeklyPosterDataURL(),
  debugWeeklyCsv: () => buildWeeklyCsv(),
  debugAchievementCard: () => buildAchievementCardDataURL(),
  debugOpenAchievements: () => openAchievements(),
  debugOpenStats: () => openStats(),
  debugStatsCard: () => buildStatsCardDataURL(),
  debugShareStats: () => buildShareStats(),
  debugShareAch: () => buildShareAch(),
  debugShareWeekly: () => buildShareWeekly(),
  debugQr: () => { const q = qrLib(0, 'M'); q.addData(SITE_URL); q.make(); return { modules: q.getModuleCount(), dark: q.isDark(0, 0) }; },
  debugCloseStats: () => { closeStats(); return stats.classList.contains('hidden'); },
  debugCloseAchievements: () => { closeAchievements(); return ach.classList.contains('hidden'); },
  achievementInfo: () => ({ unlocked: state.unlocked.slice(), total: Object.keys(ACHIEVEMENTS).length }),
  debugCloseMonth: () => { closeMonth(); return month.classList.contains('hidden'); },
  debugCloseCollection: () => { closeCollection(); return $('coll').classList.contains('hidden'); },
}; // 测试钩子


function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas: $('c3d'), antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(VRButton.createButton(renderer));
  // 桌面预览：点击画布也可关闭新手引导
  renderer.domElement.addEventListener('click', () => { if (tutorialOpen) dismissTutorial(); });

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

  buildVignette();
  audio.setVolume(state.volume);

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
  // 首次引导优先：任意扳机 = 我知道了
  if (tutorialOpen) { dismissTutorial(); return; }
  // 回放中：扳机 = 跳过回放
  if (state.mode === 'replaying') { stopReplay(); return; }
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
  tryWalk(target, hand);
}

// 手柄震动反馈（Pico 手柄支持 haptic pulse；不支持时静默跳过）
function pulse(hand, intensity = 0.4, ms = 40) {
  if (!hand) return;
  try {
    const session = renderer.xr.getSession?.();
    if (!session) return;
    for (const src of session.inputSources) {
      if ((src.handedness || 'none') !== hand) continue;
      const act = src.gamepad?.hapticActuators?.[0];
      if (act && typeof act.pulse === 'function') act.pulse(intensity, ms);
    }
  } catch { /* 机型不支持震动 */ }
}

// ---------------- 空间音效（词节点方位感） ----------------
// 2D 音效没有方位；这里用 PositionalAudio 把「收词」声定位到那个词节点上，
// 声音会随你转头而移到左/右耳。PCM 由 spatial.mjs 纯函数合成，无音频素材。

const SPATIAL_POOL = 6;
let audioListener = null;
let pannerPool = [];
const toneBuffers = new Map();   // toneKey → AudioBuffer

function ensureSpatial() {
  if (audioListener || !renderer) return !!audioListener;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    audioListener = new THREE.AudioListener();
    audioListener.context = ctx;
    camera.add(audioListener);          // 听者跟随头部
    for (let i = 0; i < SPATIAL_POOL; i++) {
      const panner = new THREE.PositionalAudio(audioListener);
      panner.setRefDistance(1.2);
      panner.setRolloffFactor(1.1);
      panner.setDistanceModel('inverse');
      panner.setMaxDistance(18);
      pannerPool.push(panner);
      scene.add(panner);                // 播放前再挪到节点位置
    }
    return true;
  } catch {
    audioListener = null;
    return false;
  }
}

function toneBuffer(opts) {
  const key = toneKey(opts);
  if (toneBuffers.has(key)) return toneBuffers.get(key);
  const ctx = audioListener?.context;
  if (!ctx) return null;
  const pcm = renderTonePCM({ sampleRate: ctx.sampleRate, ...opts });
  const buf = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
  buf.copyToChannel(pcm, 0);
  toneBuffers.set(key, buf);
  return buf;
}

/**
 * 在指定世界坐标播一声。返回是否真的走了空间音效（false 时调用方回落到 2D 音效）。
 * 只在 VR 里启用：桌面模式下听者与相机不随头动，空间化没有意义还多一份开销。
 */
function playSpatial({ pos, freq = 880, type = 'triangle', gain = 0.5, duration = 0.14 }) {
  if (!renderer.xr.isPresenting) return false;
  if (!pos || !ensureSpatial()) return false;
  try {
    const buf = toneBuffer({ freq, type, gain, duration });
    if (!buf) return false;
    const panner = pannerPool.find((p) => !p.isPlaying) || pannerPool[0];
    if (!panner) return false;
    panner.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
    if (panner.isPlaying) panner.stop();
    panner.setBuffer(buf);
    panner.play();
    return true;
  } catch {
    return false;
  }
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

function tryWalk(idx, hand = null) {
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
    // 词集（跨局）：新词才算「首次收集」
    const { collection, added } = addToCollection(state.collection, [node.word]);
    state.collection = collection;
    if (added.length) {
      state.roundNew.push(...added);
      localStorage.setItem('rw-collection', serializeCollection(collection));
    }
    // 收词：VR 里定位到该词节点（方位感），桌面/不支持时回落 2D 音效
    const spatial = playSpatial({
      pos: node.pos, freq: stepFreq(node.word.length + 2) * 2, type: 'triangle', gain: 0.55, duration: 0.16,
    });
    if (!spatial) sfx.collect(node.word.length);
    pulse(hand, 0.55, 55);
  } else {
    const spatial = playSpatial({
      pos: node.pos, freq: stepFreq(state.visited.length), type: 'sine', gain: 0.4, duration: 0.12,
    });
    if (!spatial) sfx.step(state.visited.length);
    pulse(hand, 0.22, 25);
  }
  const teleport = state.moveMode === 'teleport';
  if (teleport) {
    // 瞬移：直接到位（舒适模式），不经过中间过程
    const p = node.pos;
    rig.position.set(p.x, rig.position.y, p.z);
    state.glide = null;
  } else {
    beginGlide(idx);
  }
  refreshAdjacencyVisuals();
  updateHud();

  // 结算推迟到滑翔抵达后（结算面板不能在半路弹出）
  if (node.kind === 'goal') state.pendingEnd = 'win';
  else if (!state.unlimited && state.stepsLeft <= 0) state.pendingEnd = 'fail';

  if (teleport) {
    // 瞬移没有滑翔结束回调，这里自己处理结算与预输入
    if (state.pendingEnd) {
      const w = state.pendingEnd === 'win';
      state.pendingEnd = null;
      setTimeout(() => endRound(w), 180);
    } else if (state.queuedWalk != null) {
      const q = state.queuedWalk;
      state.queuedWalk = null;
      setTimeout(() => tryWalk(q, null), 60);
    }
  }
}

function beginGlide(idx) {
  const from = rig.position.clone();
  const p = state.graph.nodes[idx].pos;
  const to = new THREE.Vector3(p.x, rig.position.y, p.z); // 只水平走，高度交给视线
  state.glide = { from, to, t: 0 };
}

// ---------------- 回合流程 ----------------

function startRound(diffKey, opts = {}) {
  // 每日/每周挑战：难度与种子由日期/周次决定 → 同期所有人同一张图
  const daily = typeof opts.daily === 'string' ? opts.daily : null;
  const weekly = typeof opts.weekly === 'string' ? opts.weekly : null;
  const diff = daily
    ? (DIFFICULTIES.find((d) => d.key === dailyDifficulty(daily)) || DIFFICULTIES[1])
    : weekly
      ? (DIFFICULTIES.find((d) => d.key === weekDifficulty(weekly)) || DIFFICULTIES[1])
      : (DIFFICULTIES.find((d) => d.key === diffKey) || DIFFICULTIES[1]);

  state.diff = diff.key;
  state.isDaily = !!daily;
  state.isWeekly = !!weekly;
  state.dailyKey = daily;
  state.weeklyKey = weekly;
  if (!daily && !weekly) {
    state.pendingDiff = diff.key;               // 记住难度，跨局/跨会话生效
    localStorage.setItem('rw-diff', diff.key);
  }
  state.stepsMax = diff.steps;
  state.stepsLeft = diff.steps;
  // 连续打卡奖励：每日挑战按 streak 额外加步数
  state.dailyBonus = 0;
  if (daily) {
    const bonus = streakBonus(dailyStreak(state.dailyHistory, daily).current);
    state.dailyBonus = bonus;
    state.stepsMax += bonus;
    state.stepsLeft += bonus;
  }
  state.unlimited = false;
  state.titleTaps = 0;
  state.eggTyped = '';
  state.at = 0;
  state.visited = [0];
  state.collected = [];
  state.roundNew = [];
  state.score = 0;
  state.flavor = pickQuote();                    // 回合内固定，结算页可手动换
  state.glide = null;
  state.mode = 'playing';
  state.round++;

  state.graph = generateGraph({
    words: WORD_PACKS[state.pack].words,
    steps: diff.steps,
    seed: daily ? dailySeed(daily) : (weekly ? weekSeed(weekly) : (opts.seed ?? ((Date.now() ^ (state.round * 7919)) >>> 0))),
    wordCount: 14 + diff.steps,
  });

  rebuildGraphScene();
  rig.position.set(0, state.seated, 0);         // 回到起点（含座姿偏移）
  updateHud();
  sfx.start();
  $('intro').classList.add('hidden');
  $('end').classList.add('hidden');
  $('hud').classList.remove('hidden');
  closeEndPanel();
  // 首次进入：展示 3 步引导（完成一次后不再出现）
  if (shouldShowTutorial(state.tutorialDone)) showTutorial();
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
  // 每日/每周挑战成绩（每个周期只保留最新一次）
  if (state.isDaily && state.dailyKey) {
    state.daily = dailyRecord({ key: state.dailyKey, score: state.score, win });
    localStorage.setItem('rw-daily', JSON.stringify(state.daily));
    state.dailyHistory = appendDailyHistory(state.dailyHistory, state.daily);
    localStorage.setItem(DAILY_HISTORY_KEY, JSON.stringify(state.dailyHistory));
  }
  if (state.isWeekly && state.weeklyKey) {
    state.weekly = weeklyRecord({ key: state.weeklyKey, score: state.score, win });
    localStorage.setItem('rw-weekly', JSON.stringify(state.weekly));
    state.weeklyHistory = appendWeeklyHistory(state.weeklyHistory, state.weekly);
    localStorage.setItem(WEEKLY_HISTORY_KEY, JSON.stringify(state.weeklyHistory));
  }
  // 成就解锁持久化（跨局累计）并提示新解锁
  try {
    const earned = resultData(win).achievements;
    const newly = newAchievements(state.unlocked, earned);
    state.unlocked = unlockAchievements(state.unlocked, earned);
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(state.unlocked));
    if (newly.length) showAchievementToast(newly);
  } catch { /* 忽略 */ }
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
    collectionSize: state.collection.length,
    diffsWon: diffsWon(state.history),
    lexiconTotal: TOTAL_WORDS,
    packsCompleted: PACK_KEYS.filter((k) => WORD_PACKS[k].words.every((w) => state.collection.includes(w))),
    streakBest: dailyStreak(state.dailyHistory, dailyKey()).best,
    dailyWin: !!state.isDaily && win,
    weeklyWin: !!state.isWeekly && win,
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
    historyLine: historyLine(),
    career: { unlocked: state.unlocked.length, total: Object.keys(ACHIEVEMENTS).length },
  };
}

// ---------------- 路径回放（结算后沿足迹巡览） ----------------

function startReplay() {
  if (!state.graph) return false;
  if (state.mode !== 'ended' && state.mode !== 'ended-fail') return false;
  const path = buildReplayPath(state.visited, state.graph.nodes, { height: 0 });
  if (path.length < 2) return false;
  state.replayPrevMode = state.mode;
  state.replay = { path, t0: performance.now(), duration: replayDuration(path) };
  state.mode = 'replaying';
  state.glide = null;
  state.pendingEnd = null;
  closeEndPanel();
  $('end').classList.add('hidden');
  $('replay-tip').classList.remove('hidden');
  rig.position.set(path[0].x, path[0].y, path[0].z);
  sfx.ui();
  return true;
}

function stopReplay() {
  if (!state.replay) return false;
  const last = state.replay.path[state.replay.path.length - 1];
  state.replay = null;
  rig.position.set(last.x, last.y, last.z);
  state.mode = state.replayPrevMode || 'ended';
  state.replayPrevMode = null;
  $('replay-tip').classList.add('hidden');
  if (state.mode === 'ended' || state.mode === 'ended-fail') {
    $('end').classList.remove('hidden');
    showEndPanel(state.mode === 'ended');
  }
  sfx.ui();
  return true;
}

// ---------------- 结算海报导出 ----------------

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
      a.download = `拾径-思想路径-${Date.now()}.png`;
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

// ---------------- 新手引导（首次进入展示 3 步） ----------------

let tutorialGroup = null, tutorialOpen = false, tutorialTimer = null;

function tutorialTexture() {
  const cv = document.createElement('canvas');
  cv.width = 900; cv.height = 520;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(10,14,28,0.95)';
  rrect(c, 6, 6, 888, 508, 26); c.fill();
  c.strokeStyle = 'rgba(140,165,255,0.55)'; c.lineWidth = 4; c.stroke();

  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#eaf0ff'; c.font = 'bold 44px "PingFang SC","Microsoft YaHei",sans-serif';
  c.fillText(L('新手引导'), 450, 60);

  const steps = [
    { icon: '◎', title: '寻找光圈', body: '能走的相邻词会亮起脉冲光环' },
    { icon: '✋', title: '扣扳机前进', body: '手柄射线瞄准光圈，扣扳机走过去' },
    { icon: '1024', title: '抵达 1024', body: '步数耗尽前走到赤金色的 1024' },
  ];
  steps.forEach((s, i) => {
    const y = 150 + i * 100;
    c.textAlign = 'left';
    c.fillStyle = '#6cd0ff'; c.font = 'bold 40px "Segoe UI",sans-serif';
    c.fillText(s.icon, 70, y);
    c.fillStyle = '#dfe7ff'; c.font = 'bold 32px "PingFang SC","Microsoft YaHei",sans-serif';
    c.fillText(L(s.title), 160, y - 14);
    c.fillStyle = '#8b96b8'; c.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
    c.fillText(L(s.body), 160, y + 24);
  });

  c.textAlign = 'center';
  c.fillStyle = 'rgba(70,110,200,0.85)'; c.strokeStyle = 'rgba(150,200,255,0.9)'; c.lineWidth = 3;
  rrect(c, 300, 440, 300, 52, 14); c.fill(); c.stroke();
  c.fillStyle = '#fff'; c.font = 'bold 28px "PingFang SC",sans-serif';
  c.fillText(L('知道了，开始吧'), 450, 467);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ensureTutorial() {
  if (tutorialGroup) return;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tutorialTexture(), transparent: true, depthTest: false }));
  spr.scale.set(0.92, 0.53, 1);
  spr.renderOrder = 60;
  tutorialGroup = new THREE.Group();
  tutorialGroup.add(spr);
  tutorialGroup.visible = false;
  scene.add(tutorialGroup);
}

function updateTutorialPose() {
  if (!tutorialOpen || !tutorialGroup) return;
  const cp = camera.getWorldPosition(new THREE.Vector3());
  const q = camera.getWorldQuaternion(new THREE.Quaternion());
  tutorialGroup.position.copy(new THREE.Vector3(0, -0.02, -1.25).applyQuaternion(q).add(cp));
  tutorialGroup.quaternion.copy(q);
}

function showTutorial() {
  ensureTutorial();
  // 重新生成贴图，保证语言切换后文案正确
  tutorialGroup.children[0].material.map.dispose();
  tutorialGroup.children[0].material.map = tutorialTexture();
  tutorialGroup.children[0].material.needsUpdate = true;
  tutorialOpen = true;
  tutorialGroup.visible = true;
  updateTutorialPose();
  clearTimeout(tutorialTimer);
  tutorialTimer = setTimeout(() => dismissTutorial(), 15000);
}

function dismissTutorial() {
  tutorialOpen = false;
  if (tutorialGroup) tutorialGroup.visible = false;
  clearTimeout(tutorialTimer);
  if (!state.tutorialDone) {
    state.tutorialDone = true;
    localStorage.setItem(TUTORIAL_DONE_KEY, tutorialDoneValue());
  }
  sfx.ui();
  return true;
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
    moveMode: state.moveMode,
    lang: state.lang,
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
  } else if (kind === 'move') {
    state.moveMode = normalizeMoveMode(value);
    localStorage.setItem('rw-move', state.moveMode);
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

// ---------------- 防晕视野遮罩 ----------------

function buildVignette() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(256, 256, 110, 256, 256, 256);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.62, 'rgba(0,0,0,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0.92)');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  vignetteMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
  );
  vignetteMesh.position.set(0, 0, -0.6);
  vignetteMesh.renderOrder = 999;
  camera.add(vignetteMesh);
}

// ---------------- 词集一览（2D 面板） ----------------

function openCollection() {
  const grid = $('coll-grid');
  if (!grid) return { chips: 0, got: 0 };
  const got = new Set(state.collection);
  grid.innerHTML = '';
  for (const w of ALL_WORDS) {
    const chip = document.createElement('span');
    chip.className = got.has(w) ? 'coll-chip got' : 'coll-chip';
    chip.textContent = w;
    grid.appendChild(chip);
  }
  const prog = collectionProgress(state.collection, TOTAL_WORDS);
  $('coll-count').textContent = `${prog.collected}/${prog.total}`;
  // 词包收藏进度条
  const box = $('pack-progress');
  if (box) {
    box.innerHTML = packProgress(state.collection).map((r) =>
      `<div class="pack-row"><span class="pack-name">${L(r.name)}</span>` +
      `<span class="pack-bar"><i style="width:${r.pct}%"></i></span>` +
      `<span class="pack-num">${r.got}/${r.total}</span></div>`
    ).join('');
  }
  // 成就进度提示
  const hint = collectionHint(state.collection.length, TOTAL_WORDS);
  const he = $('coll-hint');
  if (he) {
    he.textContent = hint.type === 'done'
      ? `${L('词汇全图')} · ${L('全部点亮')}`
      : `${L('再收集')} ${hint.remaining} ${L('词')} ${L('解锁')}「${hint.type === 'collector' ? L('词集三十') : L('词汇全图')}」`;
  }
  $('coll').classList.remove('hidden');
  sfx.ui();
  return {
    chips: grid.querySelectorAll('.coll-chip').length,
    got: grid.querySelectorAll('.coll-chip.got').length,
  };
}

function closeCollection() { $('coll').classList.add('hidden'); }

/** 成就总览：展示全部成就及解锁状态。 */
function openAchievements() {
  const grid = $('ach-grid');
  if (!grid) return { total: 0, unlocked: 0 };
  const set = new Set(state.unlocked);
  const entries = Object.entries(ACHIEVEMENTS);
  grid.innerHTML = entries.map(([k, a]) =>
    `<div class="ach-item ${set.has(k) ? 'got' : 'locked'}"><b>${a.icon}</b><span>${L(a.name)}</span></div>`
  ).join('');
  const unlocked = entries.filter(([k]) => set.has(k)).length;
  $('ach-count').textContent = `${unlocked}/${entries.length}`;
  $('ach').classList.remove('hidden');
  sfx.ui();
  return { total: entries.length, unlocked };
}

function closeAchievements() { $('ach').classList.add('hidden'); }

/** 生涯统计面板。 */
function openStats() {
  const s = careerStats(state.history);
  const grid = $('stats-grid');
  if (!grid) return s;
  const rows = [
    [L('总局数'), s.total], [L('胜场'), s.wins], [L('胜率'), `${s.winRate}%`], [L('最佳'), s.best],
    [L('平均步数'), s.avgSteps], [L('累计收录'), s.totalWords],
    [L('悠然'), `${s.byDiff.easy.wins}/${s.byDiff.easy.played}`],
    [L('标准'), `${s.byDiff.normal.wins}/${s.byDiff.normal.played}`],
    [L('困难'), `${s.byDiff.hard.wins}/${s.byDiff.hard.played}`],
  ];
  grid.innerHTML = rows.map(([k, v]) => `<div class="stat-item"><span>${k}</span><b>${v}</b></div>`).join('');
  $('stats').classList.remove('hidden');
  sfx.ui();
  return s;
}

function closeStats() { $('stats').classList.add('hidden'); }

/** 在 canvas 上绘制二维码（白底黑块）。返回模块数（失败 0）。 */
function drawQr(c, text, x, y, size) {
  try {
    const qr = qrLib(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const cell = size / n;
    c.fillStyle = '#ffffff';
    c.fillRect(x - 8, y - 8, size + 16, size + 16);
    c.fillStyle = '#0b1020';
    for (let r = 0; r < n; r++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(r, col)) c.fillRect(x + col * cell, y + r * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    return n;
  } catch { return 0; }
}

/** 生涯成就卡（1080×1350 PNG）：全部成就的解锁一览。 */
function buildAchievementCardDataURL() {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#131c3e'); g.addColorStop(1, '#0b1020');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 100; i++) {
    c.fillStyle = `rgba(200,215,255,${Math.random() * 0.3 + 0.06})`;
    c.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  const entries = Object.entries(ACHIEVEMENTS);
  const set = new Set(state.unlocked);
  const got = entries.filter(([k]) => set.has(k)).length;
  c.textAlign = 'center';
  c.fillStyle = '#dfe7ff'; c.font = 'bold 58px "PingFang SC","Microsoft YaHei",sans-serif';
  c.fillText('拾径 · 生涯成就', W / 2, 120);
  c.fillStyle = '#8b96b8'; c.font = '30px "PingFang SC","Microsoft YaHei",sans-serif';
  c.fillText(`已解锁 ${got} / ${entries.length}`, W / 2, 180);
  // 进度条
  const barX = 140, barW = 800, barY = 216;
  c.fillStyle = 'rgba(140,165,255,0.18)'; c.fillRect(barX, barY, barW, 14);
  c.fillStyle = '#ffcf4d'; c.fillRect(barX, barY, Math.round((got / entries.length) * barW), 14);
  // 成就网格（3 列）
  const cols = 3, cellW = 300, cellH = 150, startX = 90, startY = 290;
  entries.forEach(([k, a], i) => {
    const x = startX + (i % cols) * (cellW + 20);
    const y = startY + Math.floor(i / cols) * cellH;
    const unlocked = set.has(k);
    c.fillStyle = unlocked ? 'rgba(255,207,77,0.10)' : 'rgba(20,27,51,0.5)';
    c.strokeStyle = unlocked ? 'rgba(255,207,77,0.55)' : 'rgba(140,165,255,0.16)';
    c.lineWidth = 2;
    c.beginPath(); c.roundRect(x, y, cellW, 118, 14); c.fill(); c.stroke();
    c.font = '40px "Segoe UI",sans-serif'; c.fillStyle = unlocked ? '#ffcf4d' : '#454f6b';
    c.fillText(unlocked ? a.icon : '🔒', x + cellW / 2, y + 52);
    c.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
    c.fillStyle = unlocked ? '#dfe7ff' : '#565f7a';
    c.fillText(L(a.name), x + cellW / 2, y + 94);
  });
  c.fillStyle = '#5f6a88'; c.font = '26px "Segoe UI",sans-serif';
  drawQr(c, SITE_URL, W - 210, H - 280, 150);
  c.fillStyle = '#5f6a88'; c.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
  c.fillText('扫码在线玩', W - 135, H - 100);
  c.fillText('拾径 Wordloom · 词与线织成的荒原', W / 2, 1260);
  return cv.toDataURL('image/png');
}

function downloadAchievementCard() {
  try {
    const a = document.createElement('a');
    a.href = buildAchievementCardDataURL();
    a.download = `拾径成就卡-${dailyKey()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    sfx.ui();
  } catch { /* 忽略 */ }
}

/** 生涯统计卡（1080×1350 PNG）：核心数据 + 二维码。 */
function buildStatsCardDataURL() {
  const W = 1080, H = 1350;
  const s = careerStats(state.history);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#131c3e'); g.addColorStop(1, '#0b1020');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    c.fillStyle = `rgba(200,215,255,${Math.random() * 0.3 + 0.06})`;
    c.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  c.textAlign = 'center';
  c.fillStyle = '#dfe7ff'; c.font = 'bold 58px "PingFang SC","Microsoft YaHei",sans-serif';
  c.fillText('拾径 · 生涯统计', W / 2, 130);
  const cells = [
    [L('总局数'), s.total], [L('胜场'), s.wins], [L('胜率'), `${s.winRate}%`],
    [L('最佳'), s.best], [L('平均步数'), s.avgSteps], [L('累计收录'), s.totalWords],
  ];
  cells.forEach(([k, v], i) => {
    const x = 90 + (i % 3) * 310, y = 230 + Math.floor(i / 3) * 190;
    c.fillStyle = 'rgba(20,27,51,0.55)'; c.strokeStyle = 'rgba(140,165,255,0.18)'; c.lineWidth = 2;
    c.beginPath(); c.roundRect(x, y, 280, 150, 16); c.fill(); c.stroke();
    c.fillStyle = '#8b96b8'; c.font = '26px "PingFang SC","Microsoft YaHei",sans-serif';
    c.fillText(k, x + 140, y + 48);
    c.fillStyle = '#dfe7ff'; c.font = 'bold 52px "Segoe UI",sans-serif';
    c.fillText(String(v), x + 140, y + 116);
  });
  c.textAlign = 'left'; c.font = '30px "PingFang SC","Microsoft YaHei",sans-serif';
  const diffs = [[L('悠然'), s.byDiff.easy], [L('标准'), s.byDiff.normal], [L('紧绷'), s.byDiff.hard]];
  diffs.forEach(([name, d], i) => {
    c.fillStyle = '#8b96b8';
    c.fillText(`${name}`, 150, 680 + i * 70);
    c.fillStyle = '#dfe7ff';
    c.fillText(`${d.wins} / ${d.played}`, 330, 680 + i * 70);
  });
  c.textAlign = 'center';
  drawQr(c, SITE_URL, W - 210, H - 300, 150);
  c.fillStyle = '#5f6a88'; c.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
  c.fillText('扫码在线玩', W - 135, H - 120);
  c.font = '26px "Segoe UI",sans-serif';
  c.fillText('拾径 Wordloom · 词与线织成的荒原', W / 2, 1240);
  return cv.toDataURL('image/png');
}

function downloadStatsCard() {
  try {
    const a = document.createElement('a');
    a.href = buildStatsCardDataURL();
    a.download = `拾径统计-${dailyKey()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    sfx.ui();
  } catch { /* 忽略 */ }
}

// ---------------- 分享文案 ----------------

function buildShareStats() {
  return shareStatsText(careerStats(state.history));
}

function buildShareAch() {
  const names = Object.entries(ACHIEVEMENTS).filter(([k]) => state.unlocked.includes(k)).map(([, a]) => L(a.name));
  return shareAchievementsText({ unlocked: state.unlocked.length, total: Object.keys(ACHIEVEMENTS).length, names });
}

function buildShareWeekly() {
  const board = weeklyBoard(state.weeklyHistory, weekKey(), 8);
  const played = board.filter((b) => b.played);
  return shareWeeklyText({
    weeksPlayed: played.length,
    best: played.length ? Math.max(...played.map((b) => b.score)) : 0,
    total: played.reduce((s, b) => s + b.score, 0),
    currentKey: weekKey(),
  });
}

function showToast(text, ms = 2600) {
  const el = $('ach-toast');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  el.classList.add('show');
  clearTimeout(achToastTimer);
  achToastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 320);
  }, ms);
}

async function copyShare(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    showToast(`📋 ${L('已复制分享文案')}`);
    return true;
  } catch {
    showToast(`📋 ${L('复制失败，请手动选择')}`);
    return false;
  }
}

// ---------------- 新成就提示（2D 飘字 + VR 内面板） ----------------

let achToastTimer = null, vrToast = null, vrToastTimer = null;

function showAchievementToast(list) {
  if (!Array.isArray(list) || list.length === 0) return false;
  const names = list.slice(0, 3).map((a) => `${a.icon} ${L(a.name)}`).join('  ');
  const el = $('ach-toast');
  if (el) {
    el.textContent = `🏆 ${L('新成就')}：${names}`;
    el.classList.remove('hidden');
    el.classList.add('show');
    clearTimeout(achToastTimer);
    achToastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.classList.add('hidden'), 320);
    }, 4000);
  }
  if (renderer.xr.isPresenting) showVrAchievementToast(names);
  return true;
}

function showVrAchievementToast(text) {
  try {
    const cv = document.createElement('canvas');
    cv.width = 768; cv.height = 160;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(30,24,10,0.92)';
    rrect(c, 4, 4, 760, 152, 30); c.fill();
    c.strokeStyle = 'rgba(255,207,77,0.7)'; c.lineWidth = 4; c.stroke();
    c.fillStyle = '#ffcf4d'; c.font = 'bold 40px "PingFang SC","Microsoft YaHei",sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(`🏆 ${L('新成就')}`, 384, 56);
    c.fillStyle = '#fff3d0'; c.font = '30px "PingFang SC","Microsoft YaHei",sans-serif';
    c.fillText(text, 384, 112);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(0.9, 0.19, 1);
    spr.renderOrder = 80;
    const cp = camera.getWorldPosition(new THREE.Vector3());
    const q = camera.getWorldQuaternion(new THREE.Quaternion());
    spr.position.copy(new THREE.Vector3(0, -0.12, -1.2).applyQuaternion(q).add(cp));
    spr.quaternion.copy(q);
    scene.add(spr);
    vrToast = spr;
    clearTimeout(vrToastTimer);
    vrToastTimer = setTimeout(() => {
      if (vrToast) { scene.remove(vrToast); vrToast.material.map?.dispose?.(); vrToast.material.dispose?.(); vrToast = null; }
    }, 4200);
  } catch { /* 忽略 */ }
}

// ---------------- 存档导出 / 导入 / 重置 ----------------

function collectSave() {
  return {
    best: state.best,
    history: state.history,
    collection: state.collection,
    diff: state.pendingDiff,
    skin: state.skin,
    timbre: audio.timbre,
    moveMode: state.moveMode,
    pack: state.pack,
    achievements: state.unlocked,
    daily: state.daily,
    dailyHistory: state.dailyHistory,
    weekly: state.weekly,
    weeklyHistory: state.weeklyHistory,
  };
}

function exportSaveFile() {
  try {
    const text = exportSave(collectSave());
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `拾径存档-${dailyKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch { /* 无下载能力时静默 */ }
}

/** 把校验过的存档写入运行时状态与 localStorage。 */
function applySave(data) {
  state.best = data.best;
  state.history = data.history;
  state.collection = data.collection;
  state.pack = normalizePack(data.settings.pack || 'classic');
  state.pendingDiff = data.settings.diff;
  state.skin = data.settings.skin;
  audio.setTimbre(data.settings.timbre);
  localStorage.setItem('rw-best', String(state.best));
  localStorage.setItem('rw-history', serializeHistory(state.history));
  localStorage.setItem('rw-collection', serializeCollection(state.collection));
  localStorage.setItem('rw-diff', state.pendingDiff);
  localStorage.setItem('rw-skin', state.skin);
  localStorage.setItem('rw-timbre', data.settings.timbre);
  localStorage.setItem('rw-move', state.moveMode);
  localStorage.setItem('rw-pack', state.pack);
  // v2 进度（旧存档无 progress 时保持现有数据不变）
  const prog = data.progress;
  if (prog) {
    state.unlocked = prog.achievements || [];
    state.daily = prog.daily || null;
    state.dailyHistory = prog.dailyHistory || [];
    state.weekly = prog.weekly || null;
    state.weeklyHistory = prog.weeklyHistory || [];
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(state.unlocked));
    localStorage.setItem('rw-daily', state.daily ? JSON.stringify(state.daily) : '');
    localStorage.setItem(DAILY_HISTORY_KEY, JSON.stringify(state.dailyHistory));
    localStorage.setItem('rw-weekly', state.weekly ? JSON.stringify(state.weekly) : '');
    localStorage.setItem(WEEKLY_HISTORY_KEY, JSON.stringify(state.weeklyHistory));
  }
  if (SKINS[state.skin]) applySkinLook();
  const skinBtn = $('skin-btn');
  if (skinBtn) skinBtn.textContent = `◍ 皮肤：${(SKINS[state.skin] || SKINS.ink).name}`;
  const timbreBtn = $('timbre-btn');
  if (timbreBtn) timbreBtn.textContent = `♫ 音色：${(TIMBRES[data.settings.timbre] || TIMBRES.wood).name}`;
  updateHud();
}

function importSaveFile(ev) {
  const f = ev?.target?.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const r = importSave(String(reader.result || ''));
    if (!r.ok) {
      alert(`导入失败：${r.error}`);
      return;
    }
    applySave(r.data);
    alert('存档已导入');
  };
  reader.readAsText(f);
  ev.target.value = '';
}

function resetAll(skipConfirm = false) {
  if (!skipConfirm && !confirm('确定清空本机所有进度（战绩 / 词集 / 每日挑战）吗？')) return false;
  for (const [k, v] of Object.entries(resetValues())) localStorage.setItem(k, v);
  state.best = 0;
  state.history = [];
  state.collection = [];
  state.daily = null;
  state.dailyHistory = [];
  state.weekly = null;
  state.weeklyHistory = [];
  state.unlocked = [];
  state.pendingDiff = 'normal';
  updateHud();
  return true;
}

function refreshLangUI() {
  applyDomI18n(document, state.lang);
  document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-CN';
  const langBtn = $('lang-btn');
  if (langBtn) langBtn.textContent = state.lang === 'en' ? '🌐 English' : '🌐 中文';
  const skinBtn = $('skin-btn');
  if (skinBtn) skinBtn.textContent = `◍ ${L('皮肤')}：${L((SKINS[state.skin] || SKINS.ink).name)}`;
  const timbreBtn = $('timbre-btn');
  if (timbreBtn) timbreBtn.textContent = `♫ ${L('音色')}：${L((TIMBRES[audio.timbre] || TIMBRES.wood).name)}`;
  const muteBtn = $('mute-btn');
  if (muteBtn) muteBtn.textContent = audio.muted ? L('🔇 静音') : `🔊 ${L('音效')}`;
  const vigBtn = $('vignette-btn');
  if (vigBtn) vigBtn.textContent = state.vignette ? `🕶 ${L('防晕遮罩')}：${L('开')}` : `🕶 ${L('防晕遮罩')}：${L('关')}`;
  const vol = $('volume');
  if (vol) vol.value = String(volumeToPercent(state.volume));
  refreshPackUI();
  updateHud();
}

/** 应用词包专属主题：切换词包时自动套用该包的皮肤与音色。 */
function applyPackTheme(key) {
  const pack = WORD_PACKS[normalizePack(key)];
  if (!pack) return;
  if (pack.skin && SKINS[pack.skin]) {
    state.skin = pack.skin;
    localStorage.setItem('rw-skin', pack.skin);
    applySkinLook();
  }
  if (pack.timbre && TIMBRES[pack.timbre]) {
    audio.setTimbre(pack.timbre);
    localStorage.setItem('rw-timbre', pack.timbre);
  }
  refreshLangUI();
}

/** 词包选中态。 */
function refreshPackUI() {
  document.querySelectorAll('.pack-pick').forEach((b) => {
    b.classList.toggle('active', b.dataset.pack === state.pack);
  });
}

/** 每日 7 日榜渲染（本地成绩）。 */
function renderDailyBoard() {
  const box = $('daily-board');
  if (!box) return;
  const rows = dailyBoard(state.dailyHistory, dailyKey(), 7);
  box.innerHTML = rows.map((r) => {
    const cls = `daily-chip${r.played ? ' played' : ''}${r.win ? ' win' : ''}`;
    return `<span class="${cls}"><small>${r.short}</small>${r.played ? r.score : '·'}</span>`;
  }).join('');
}

/** 每日挑战月视图（月历网格）。 */
function openMonth() {
  const g = monthGrid(state.dailyHistory, {});
  const sum = monthSummary(state.dailyHistory, {});
  $('month-title').textContent = `${L('每日挑战')} · ${g.year}-${String(g.month).padStart(2, '0')}`;
  const best = dailyBest(state.dailyHistory);
  $('month-summary').textContent = `${L('本月')} ${sum.played} ${L('天')} · ${L('胜')} ${sum.wins} · ${L('最佳')} ${sum.best}` + (best.score > 0 ? ` · ${L('历史最佳')} ${best.score}` : '');
  const grid = $('month-grid');
  grid.innerHTML = '';
  const zh = ['日', '一', '二', '三', '四', '五', '六'];
  const en = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  for (let i = 0; i < 7; i++) {
    const h = document.createElement('div');
    h.className = 'month-head';
    h.textContent = state.lang === 'en' ? en[i] : zh[i];
    grid.appendChild(h);
  }
  for (const week of g.weeks) {
    for (const cell of week) {
      const el = document.createElement('div');
      if (!cell) { el.className = 'month-cell empty'; }
      else {
        el.className = 'month-cell' + (cell.played ? ' played' : '') + (cell.win ? ' win' : '');
        el.innerHTML = '<span class="d">' + cell.day + '</span><span class="s">' + (cell.played ? cell.score : '·') + '</span>';
      }
      grid.appendChild(el);
    }
  }
  // 最近 8 周榜
  const wb = $('week-board');
  if (wb) {
    const rows = weeklyBoard(state.weeklyHistory, weekKey(), 8);
    wb.innerHTML = rows.map((r) =>
      `<span class="week-chip${r.played ? ' played' : ''}${r.win ? ' win' : ''}"><small>${r.short}</small>${r.played ? r.score : '·'}</span>`
    ).join('');
  }
  $('month').classList.remove('hidden');
  sfx.ui();
  return { weeks: g.weeks.length, cells: g.weeks.length * 7, days: g.days, weekRows: weeklyBoard(state.weeklyHistory, weekKey(), 8).length };
}

function closeMonth() { $('month').classList.add('hidden'); }

/** 每周榜分享海报（1080×1350 PNG）：最近 8 周柱状图 + 摘要。 */
function buildWeeklyPosterDataURL() {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#131c3e'); g.addColorStop(1, '#0b1020');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // 星点
  for (let i = 0; i < 120; i++) {
    c.fillStyle = `rgba(200,215,255,${Math.random() * 0.35 + 0.08})`;
    c.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  c.textAlign = 'center';
  c.fillStyle = '#dfe7ff'; c.font = 'bold 64px "PingFang SC","Microsoft YaHei",sans-serif';
  c.fillText('拾径 · 每周挑战', W / 2, 140);
  c.fillStyle = '#8b96b8'; c.font = '32px "PingFang SC","Microsoft YaHei",sans-serif';
  c.fillText('最近 8 周', W / 2, 200);

  const board = weeklyBoard(state.weeklyHistory, weekKey(), 8).slice().reverse(); // 左旧右新
  const max = Math.max(10, ...board.map((b) => b.score));
  const chartX = 100, chartY = 280, chartW = 880, chartH = 620;
  const gap = 22, bw = (chartW - gap * 7) / 8;
  board.forEach((b, i) => {
    const h = Math.max(6, Math.round((b.score / max) * chartH));
    const x = chartX + i * (bw + gap);
    c.fillStyle = b.win ? '#ffcf4d' : b.played ? '#6cd0ff' : 'rgba(140,165,255,0.18)';
    c.fillRect(x, chartY + chartH - h, bw, h);
    c.fillStyle = '#8b96b8'; c.font = '26px "Segoe UI",sans-serif';
    c.fillText(b.short, x + bw / 2, chartY + chartH + 44);
    c.fillStyle = b.played ? '#dfe7ff' : '#4a5470'; c.font = 'bold 28px "Segoe UI",sans-serif';
    c.fillText(b.played ? String(b.score) : '·', x + bw / 2, chartY + chartH - h - 18);
  });

  const played = board.filter((b) => b.played).length;
  const best = Math.max(0, ...board.map((b) => b.score));
  const total = board.reduce((s, b) => s + b.score, 0);
  c.fillStyle = '#dfe7ff'; c.font = '40px "PingFang SC","Microsoft YaHei",sans-serif';
  c.fillText(`已挑战 ${played} 周 · 最佳 ${best} · 总分 ${total}`, W / 2, 1080);
  c.fillStyle = '#5f6a88'; c.font = '30px "Segoe UI",sans-serif';
  drawQr(c, SITE_URL, W - 210, H - 320, 150);
  c.fillStyle = '#5f6a88'; c.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
  c.fillText('扫码在线玩', W - 135, H - 140);
  c.fillText('拾径 Wordloom · 词与线织成的荒原', W / 2, 1180);
  c.fillStyle = '#3d4663'; c.font = '24px "Segoe UI",sans-serif';
  c.fillText(new Date().toLocaleDateString('zh-CN'), W / 2, 1240);
  return cv.toDataURL('image/png');
}

function downloadWeeklyPoster() {
  try {
    const a = document.createElement('a');
    a.href = buildWeeklyPosterDataURL();
    a.download = `拾径周报-${weekKey()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    sfx.ui();
  } catch { /* 忽略 */ }
}

/** 周榜 CSV（最近 8 周）。 */
function buildWeeklyCsv() {
  const board = weeklyBoard(state.weeklyHistory, weekKey(), 8);
  const lines = ['week,score,win'];
  for (const b of board) lines.push(`${b.key},${b.played ? b.score : ''},${b.played ? (b.win ? 1 : 0) : ''}`);
  return lines.join('\n');
}

function downloadWeeklyCsv() {
  try {
    const blob = new Blob([buildWeeklyCsv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `拾径周榜-${weekKey()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    sfx.ui();
  } catch { /* 忽略 */ }
}

/** 每日 7 日榜柱状图（canvas 2D）。 */
function drawDailyChart() {
  const cv = $('daily-chart');
  if (!cv) return 0;
  const c = cv.getContext('2d');
  const rows = dailyBoard(state.dailyHistory, dailyKey(), 7).slice().reverse(); // 左旧右新
  const values = rows.map((r) => (r.played ? r.score : 0));
  const bars = barLayout(values, { width: cv.width - 8, height: cv.height - 14 });
  c.clearRect(0, 0, cv.width, cv.height);
  rows.forEach((r, i) => {
    const b = bars[i];
    c.fillStyle = r.win ? '#ffcf4d' : r.played ? '#6cd0ff' : 'rgba(140,165,255,0.22)';
    c.fillRect(4 + b.x, cv.height - 5 - b.h, b.w, b.h);
  });
  return bars.length;
}

/** 座姿标定：按当前眼高计算世界抬高量并应用。 */
function calibrateSeated() {
  const y = camera.getWorldPosition(new THREE.Vector3()).y;
  const off = seatedOffset(y);
  state.seated = off;
  localStorage.setItem('rw-seated', String(off));
  rig.position.y = off;
  sfx.ui();
  return off;
}

// ---------------- 2D DOM ----------------

function wire2D() {
  $('start-btn').onclick = () => { audio.unlock(); sfx.ui(); startRound(state.pendingDiff); };
  $('daily-btn').onclick = () => { audio.unlock(); sfx.ui(); startRound(null, { daily: dailyKey() }); };
  $('weekly-btn').onclick = () => { audio.unlock(); sfx.ui(); startRound(null, { weekly: weekKey() }); };
  $('save-export').onclick = () => { sfx.ui(); exportSaveFile(); };
  $('save-import').onclick = () => { sfx.ui(); $('save-file').click(); };
  $('save-file').onchange = (e) => importSaveFile(e);
  $('save-reset').onclick = () => resetAll();
  $('coll-open').onclick = () => { openCollection(); };
  $('coll-close').onclick = () => { sfx.ui(); closeCollection(); };
  $('ach-open').onclick = () => { openAchievements(); };
  $('stats-open').onclick = () => { openStats(); };
  $('stats-close').onclick = () => { sfx.ui(); closeStats(); };
  $('stats-export').onclick = () => downloadStatsCard();
  $('stats-share').onclick = () => copyShare(buildShareStats());
  $('ach-close').onclick = () => { sfx.ui(); closeAchievements(); };
  $('ach-export').onclick = () => downloadAchievementCard();
  $('ach-share').onclick = () => copyShare(buildShareAch());
  $('month-close').onclick = () => { sfx.ui(); closeMonth(); };
  $('week-poster').onclick = () => downloadWeeklyPoster();
  $('week-share').onclick = () => copyShare(buildShareWeekly());
  $('week-csv').onclick = () => downloadWeeklyCsv();
  const chartEl = $('daily-chart');
  if (chartEl) chartEl.onclick = () => openMonth();
  document.querySelectorAll('.diff-pick').forEach((b) => {
    b.onclick = () => { audio.unlock(); sfx.ui(); startRound(b.dataset.diff); };
  });
  $('skin-btn').onclick = () => {
    const keys = Object.keys(SKINS);
    const next = keys[(keys.indexOf(state.skin) + 1) % keys.length];
    state.skin = next;
    localStorage.setItem('rw-skin', next);
    applySkinLook();
    refreshLangUI();
    sfx.ui();
  };
  $('timbre-btn').onclick = () => {
    const keys = Object.keys(TIMBRES);
    const next = keys[(keys.indexOf(audio.timbre) + 1) % keys.length];
    audio.setTimbre(next);
    localStorage.setItem('rw-timbre', next);
    refreshLangUI();
    sfx.ui();
  };
  $('lang-btn').onclick = () => {
    state.lang = state.lang === 'en' ? 'zh' : 'en';
    localStorage.setItem(LANG_KEY, state.lang);
    refreshLangUI();
    if (menuOpen) redrawMenu();
    sfx.ui();
  };
  // 词包选择
  document.querySelectorAll('.pack-pick').forEach((b) => {
    b.onclick = () => {
      state.pack = normalizePack(b.dataset.pack);
      localStorage.setItem('rw-pack', state.pack);
      applyPackTheme(state.pack);
      refreshPackUI();
      sfx.ui();
    };
  });
  // 音量
  const vol = $('volume');
  if (vol) {
    vol.oninput = () => {
      state.volume = clampVolume(Number(vol.value) / 100);
      audio.setVolume(state.volume);
      localStorage.setItem('rw-volume', String(state.volume));
    };
  }
  // 防晕遮罩开关
  $('vignette-btn').onclick = () => {
    state.vignette = !state.vignette;
    localStorage.setItem('rw-vignette', state.vignette ? '1' : '0');
    refreshLangUI();
    sfx.ui();
  };
  // 座姿标定
  $('seated-btn').onclick = () => { calibrateSeated(); };
  const savedTimbre = localStorage.getItem('rw-timbre');
  if (savedTimbre && TIMBRES[savedTimbre]) audio.setTimbre(savedTimbre);
  $('mute-btn').onclick = () => {
    audio.setMuted(!audio.muted);
    refreshLangUI();
    if (!audio.muted) sfx.ui();
  };
  $('poster-btn').onclick = () => { sfx.ui(); downloadPoster(); };
  $('again-btn').onclick = () => { sfx.ui(); startRound(state.pendingDiff); };
  $('replay-btn').onclick = () => { startReplay(); };
  $('replay-tip').onclick = () => { stopReplay(); };
  $('requote-btn').onclick = () => rerollQuote();
  $('copy-btn').onclick = () => {
    const r = resultData(state.mode === 'ended');
    const text = `【拾径 · 思想路径】\n${r.poem}\n「${r.quote.text}」—— ${r.quote.flavor}\n${r.steps} 步 · 收录 ${r.words.length} 词 · ${r.score} 分（最佳 ${r.best}）`;
    navigator.clipboard?.writeText(text)
      .then(() => { $('copy-btn').textContent = L('已复制 ✓'); setTimeout(() => ($('copy-btn').textContent = L('复制路径文案')), 1500); })
      .catch(() => {});
  };
  $('title-h').onclick = () => {
    state.titleTaps++;
    if (state.titleTaps >= 7 && !state.unlimited) {
      state.unlimited = true;
      $('title-h').textContent = `∞ ${L('拾径')}`;
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

  // 初始化界面语言（含皮肤/音色按钮的动态文案）
  refreshLangUI();
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
  // 双份 HUD：intro 卡片一套（局数/词集/累计/最佳），游戏内 HUD 一套
  const prog = collectionProgress(state.collection, TOTAL_WORDS);
  $('hud-round').textContent = String(state.round + 1);
  $('hud-collection').textContent = String(prog.collected);
  $('hud-collection-total').textContent = String(prog.total);
  $('hud-score').textContent = String(state.score);
  $('hud-best').textContent = String(state.best);
  $('hud-steps').textContent = state.unlimited ? '∞' : String(state.stepsLeft);
  $('hud-words2').textContent = String(state.collected.length);
  $('hud-score2').textContent = String(state.score);
  $('hud-best2').textContent = String(state.best);
  // 每日挑战状态
  const dk = dailyKey();
  const ds = dailyStatus(state.daily, dk);
  const el = $('daily-status');
  if (el) {
    const diffName = L((DIFFICULTIES.find((d) => d.key === dailyDifficulty(dk)) || DIFFICULTIES[1]).name);
    const streak = dailyStreak(state.dailyHistory, dk);
    const streakText = streak.current > 0 ? ` · ${L('连续')} ${streak.current} ${L('天')}` : '';
    el.textContent = (ds.played
      ? `${L('今日已完成')} · ${ds.score} ${L('分')}${ds.win ? ` · ${L('抵达 1024')}` : ''}`
      : `${L('今日未完成')} · ${diffName} ${L('难度')}`) + streakText;
  }
  renderDailyBoard();
  // 每周挑战状态
  const wk = weekKey();
  const ws = weeklyStatus(state.weekly, wk);
  const wel = $('weekly-status');
  if (wel) {
    const wDiff = L((DIFFICULTIES.find((d) => d.key === weekDifficulty(wk)) || DIFFICULTIES[1]).name);
    wel.textContent = ws.played
      ? `${L('本周已完成')} · ${ws.score} ${L('分')}`
      : `${L('本周未完成')} · ${wDiff} ${L('难度')}`;
  }
  drawDailyChart();
}

/** 结算页历史摘要（按当前语言生成）。 */
function historyLine() {
  const s = summarize(state.history);
  if (!s.rounds) return '';
  if (state.lang === 'en') {
    return `History ${s.rounds} · win ${Math.round(s.winRate * 100)}% · best ${s.bestScore}`;
  }
  return summaryLine(s);
}

function fillEnd() {
  if (!state.graph) return;
  const r = resultData(state.mode === 'ended');
  $('end-icon').textContent = r.win ? '🏁' : '🌾';
  $('end-title').textContent = L(r.win ? '抵达 1024' : '路，未走完');
  $('end-poem').textContent = r.poem;
  $('end-quote').textContent = `「${r.quote.text}」`;
  $('end-quote-flavor').textContent = `—— ${L(r.quote.flavor)} ${L('一言')}`;
  $('end-stats').textContent = `${state.isDaily ? `${L('每日挑战')} ${state.dailyKey} · ` : state.isWeekly ? `${L('每周挑战')} ${state.weeklyKey} · ` : ''}${L(r.diffName)} · ${r.steps} ${L('步数')} · ${L('收录')} ${r.words.length} ${L('词')} · ${r.score} ${L('分')} · ${L('最佳')} ${r.best}${state.isDaily && state.dailyBonus > 0 ? ` · +${state.dailyBonus} ${L('步数奖励')}` : ''}`;
  const prog = collectionProgress(state.collection, TOTAL_WORDS);
  $('end-history').textContent = [
    historyLine(),
    `${L('词集')} ${prog.collected}/${prog.total}` + (state.roundNew.length ? `（${L('本局新词')} +${state.roundNew.length}）` : ''),
  ].filter(Boolean).join(' · ');
  $('end-history').style.display = $('end-history').textContent ? '' : 'none';
  $('end-ach').innerHTML = r.achievements.length
    ? r.achievements.map((a) => `<span class="ach">${a.icon} ${L(a.name)}</span>`).join('')
    : `<span class="ach" style="opacity:.45">— ${L('本次无成就')} —</span>`;
  $('end-words').textContent = r.words.length ? r.words.join('、') : '（无）';
}

// ---------------- 图场景 ----------------

// 释放一棵子树里的全部 GPU/CPU 资源（几何、材质、材质贴图）。
// 注意：标签是 Sprite，材质挂在 nodeGroup 的子对象上；只释放直接子对象会漏掉它们，
// soak 测试曾因此每局泄漏 ~0.25MB（30 局 +108% 堆）。
function disposeSubtree(root) {
  root.traverse?.((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      m.map?.dispose?.();
      m.dispose?.();
    }
  });
}

function clearGroup(g) {
  for (const c of [...g.children]) {
    disposeSubtree(c);
    g.remove(c);
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
    spr.material.map = panelTexture(['拾径 · 步数内抵达 1024', L('扣扳机 → 开始游走')]);
  } else {
    const steps = state.unlimited ? '∞' : `${state.stepsLeft}`;
    spr.material.map = panelTexture([
      `${L('步数')} ${steps} · ${L('词')} ${state.collected.length} · ${state.score} ${L('分')}`,
      L('瞄准光环节点 · 扣扳机行走'),
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
  // 三个按钮的命中区（不可见平面）：左「重放」中「换一句」右「再来一局」
  const mkHit = (x, action) => {
    const h = new THREE.Mesh(
      new THREE.PlaneGeometry(0.30, 0.10),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    h.position.set(x, -0.41, 0.001);
    h.userData.action = action;
    endGroup.add(h);
    return h;
  };
  const hits = [mkHit(-0.3125, 'replay'), mkHit(0, 'requote'), mkHit(0.3125, 'again')];
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
    disposeSubtree(endGroup);
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
  c.fillText(L(win ? '抵达 1024' : '路未走完'), 256, 80);
  c.fillStyle = '#8b96b8';
  c.font = '28px sans-serif';
  c.fillText(`${L(r.diffName)} · ${r.steps} ${L('步数')} · ${r.words.length} ${L('词')} · ${r.score} ${L('分')}`, 256, 126);
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
  c.fillText(`— ${L(r.quote.flavor)} —`, 256, 408);

  // 三个按钮：重放 / 换一句 / 再来一局
  const drawBtn = (label, cx, fill, stroke, color, bold, size = 26) => {
    c.fillStyle = fill;
    c.strokeStyle = stroke;
    c.lineWidth = 3;
    rrect(c, cx - 72, 442, 144, 56, 16);
    c.fill(); c.stroke();
    c.fillStyle = color;
    c.font = `${bold ? 'bold ' : ''}${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    c.fillText(label, cx, 477);
  };
  drawBtn(L('▶ 重放'), 96, 'rgba(40,60,80,0.9)', 'rgba(120,200,190,0.6)', '#bff0e6', false, 26);
  drawBtn(L('↻ 换一句'), 256, 'rgba(40,52,90,0.9)', 'rgba(140,165,255,0.5)', '#cfd8ff', false, 24);
  drawBtn(L('▸ 再来一局'), 416, win ? 'rgba(70,110,200,0.85)' : 'rgba(120,70,90,0.85)',
    win ? 'rgba(150,200,255,0.9)' : 'rgba(255,150,140,0.8)', '#ffffff', true, 23);

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
  if (action === 'replay') {
    return startReplay();
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
  const t = state.frozen ? 0 : performance.now() / 1000;

  // 路径回放：镜头沿足迹巡览
  if (state.replay) {
    const r = replayAt(state.replay.path, performance.now() - state.replay.t0);
    rig.position.set(r.pos.x, r.pos.y, r.pos.z);
    if (r.done) stopReplay();
  }

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

  // 防晕遮罩：滑翔过程中边缘渐暗
  if (vignetteMesh) {
    const p = state.glide ? Math.min(1, state.glide.t) : 0;
    vignetteMesh.material.opacity = vignetteOpacity(p, state.vignette);
  }

  pollSnapTurn();
  if (menuOpen) updateMenuPose();
  if (tutorialOpen) updateTutorialPose();
  updateVrHud();
  renderer.render(scene, camera);
}
