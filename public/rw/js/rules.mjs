// 拾径 Wordloom — 纯规则层（不依赖 three.js / DOM，可在 Node 中单元测试）
//
// 把「计分、成就判定、结算文案」从渲染逻辑里剥出来，好处有三：
//   1. 规则可以脱离浏览器做穷举/边界测试；
//   2. 2D 结算页与 VR 结算面板共用同一份计算，避免两处算法漂移；
//   3. 调整数值时只需改这里和 data.mjs，不用动 800 行的渲染主程序。

import { SCORE, ACHIEVEMENTS, FLAVORS, QUOTES } from './data.mjs';

/** 一步的得分：只有首次收录该词才给分（重复经过同一词不刷分）。 */
export function scoreForWalk({ firstCollect }) {
  return firstCollect ? SCORE.word : 0;
}

/** 回合结束的结算分：胜利奖励 + 剩余步数奖励 + 收录量奖励。 */
export function finalScore({ win, stepsLeft, wordCount, unlimited = false }) {
  let s = 0;
  if (win) {
    s += SCORE.win;
    // 无限步（彩蛋）下剩余步数没有意义，不给步数奖励，避免刷分
    if (!unlimited) s += Math.max(0, stepsLeft) * SCORE.stepLeft;
  }
  if (wordCount >= 10) s += 50;
  return s;
}

/** 成就判定：输入全部为标量，输出成就定义数组（顺序固定，便于快照测试）。 */
export function achievementsFor({ win, stepsLeft, wordCount, unlimited = false }) {
  const out = [];
  if (win) out.push(ACHIEVEMENTS.reach);
  if (win && !unlimited && stepsLeft >= 5) out.push(ACHIEVEMENTS.calm);
  if (wordCount >= 10) out.push(ACHIEVEMENTS.pearls);
  if (!win && wordCount >= 6) out.push(ACHIEVEMENTS.stroll);
  if (unlimited) out.push(ACHIEVEMENTS.egg);
  return out;
}

/** 路径诗：把走到的词按首次出现顺序去重，前 8 个用 · 连接。 */
export function pathPoem(words, maxWords = 8) {
  const uniq = [];
  for (const w of words) if (w && !uniq.includes(w)) uniq.push(w);
  if (!uniq.length) return { poem: '（一条无言的路）', words: [] };
  const head = uniq.slice(0, maxWords).join(' · ');
  return {
    poem: uniq.length > maxWords ? `${head} …` : head,
    words: uniq,
  };
}

/**
 * 快转（snap turn）判定：把摇杆横向输入变成一次固定角度的转身。
 *
 * VR 舒适性要求：连续平滑转身会让人晕，业界通用做法是「推一下转固定角度」。
 * 触发后必须把摇杆回中（≤ rearm）才能再次触发，否则会连续转圈。
 *
 * 约定：右手坐标系、Y 轴向上，yaw 正方向为左转；因此摇杆推右（x>0）返回负角。
 *
 * @returns {{rot:number, armed:boolean}} rot 为本次应施加的 yaw 弧度（0 = 不转）
 */
export function snapTurn({ x, armed = true, deadzone = 0.75, rearm = 0.35, stepDeg = 30 }) {
  const step = (stepDeg * Math.PI) / 180;
  const v = Number.isFinite(x) ? x : 0;
  if (armed && Math.abs(v) >= deadzone) {
    return { rot: v > 0 ? -step : step, armed: false };
  }
  if (!armed && Math.abs(v) <= rearm) return { rot: 0, armed: true };
  return { rot: 0, armed };
}

/** 把 rig 的 yaw 归一化到 (-π, π]，避免长时间游玩后数值无限增长。 */
export function normalizeYaw(yaw) {
  const twoPi = Math.PI * 2;
  let y = yaw % twoPi;
  if (y <= -Math.PI) y += twoPi;
  else if (y > Math.PI) y -= twoPi;
  return y;
}

/**
 * 选一句「一言」。rand 注入便于测试；返回 { flavor, text }。
 * 用取模兜底，防止 rand() 恰好返回 1 时数组越界。
 */
export function pickQuote(rand = Math.random) {
  const flavor = FLAVORS[Math.floor(rand() * FLAVORS.length) % FLAVORS.length];
  const list = QUOTES[flavor];
  const text = list[Math.floor(rand() * list.length) % list.length];
  return { flavor, text };
}

/**
 * 结算数据汇总（2D 海报 / VR 面板 / 复制文案共用）。
 * 纯函数：不读全局状态，全部通过参数传入。
 */
export function buildResult({
  win,
  visitedWords = [],      // 按访问顺序的词（含重复）
  collected = [],         // 已收录词（去重由本函数再做一层保险）
  steps = 0,
  stepsLeft = 0,
  unlimited = false,
  quote = null,
  rand = Math.random,
}) {
  const { poem, words } = pathPoem(visitedWords);
  const wordCount = new Set(collected).size;
  return {
    win: !!win,
    poem,
    words,
    wordCount,
    steps,
    quote: quote || pickQuote(rand),
    achievements: achievementsFor({ win, stepsLeft, wordCount, unlimited }),
    bonus: finalScore({ win, stepsLeft, wordCount, unlimited }),
  };
}
