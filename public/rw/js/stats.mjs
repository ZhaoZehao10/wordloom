// 随机游走 VR — 本地战绩（纯函数 + 可注入存储，便于单元测试）
//
// 只做「最近若干局」的滚动记录与汇总，不涉及任何网络。
// 数据格式刻意保持简单（数组 + 标量），便于未来迁移或导出。

export const HISTORY_LIMIT = 30;

/** 单局记录（字段固定，便于统计与迁移）。 */
export function makeRecord({ win, score, steps, words, diff = 'normal', unlimited = false, ts = Date.now() }) {
  return {
    win: !!win,
    score: Number.isFinite(score) ? score : 0,
    steps: Number.isFinite(steps) ? steps : 0,
    words: Number.isFinite(words) ? words : 0,
    diff: typeof diff === 'string' ? diff : 'normal',
    unlimited: !!unlimited,
    ts: Number.isFinite(ts) ? ts : Date.now(),
  };
}

/**
 * 追加一条记录并裁剪到最近 limit 条（新的在前）。
 * 对脏输入容错：history 不是数组时按空处理。
 */
export function appendRecord(history, record, limit = HISTORY_LIMIT) {
  const list = Array.isArray(history) ? history.slice() : [];
  list.unshift(makeRecord(record));
  return list.slice(0, Math.max(1, limit));
}

/**
 * 汇总统计。
 * - rounds：有效局数
 * - wins：胜局数
 * - winRate：胜率（0~1，保留 3 位小数；0 局时为 0）
 * - bestScore / bestWords：历史最佳分 / 单局最多收录词数
 * - totalSteps / avgSteps：累计与平均步数
 * - byDiff：{easy:{rounds,wins,best}, ...}
 * - lastWin：最近一次胜利的下标（无则 -1）
 */
export function summarize(history) {
  const list = Array.isArray(history) ? history.filter(isValidRecord) : [];
  const byDiff = {};
  let wins = 0, bestScore = 0, bestWords = 0, totalSteps = 0, lastWin = -1;

  list.forEach((r, i) => {
    if (r.win) { wins++; if (lastWin < 0) lastWin = i; }
    bestScore = Math.max(bestScore, r.score);
    bestWords = Math.max(bestWords, r.words);
    totalSteps += r.steps;
    const key = r.diff || 'normal';
    const d = byDiff[key] || (byDiff[key] = { rounds: 0, wins: 0, best: 0 });
    d.rounds++;
    if (r.win) d.wins++;
    d.best = Math.max(d.best, r.score);
  });

  const rounds = list.length;
  return {
    rounds,
    wins,
    winRate: rounds ? Math.round((wins / rounds) * 1000) / 1000 : 0,
    bestScore,
    bestWords,
    totalSteps,
    avgSteps: rounds ? Math.round((totalSteps / rounds) * 10) / 10 : 0,
    byDiff,
    lastWin,
  };
}

/** 记录是否可用（脏数据/旧版本残留一律丢弃，避免统计被污染）。 */
export function isValidRecord(r) {
  return !!r
    && typeof r === 'object'
    && typeof r.win === 'boolean'
    && Number.isFinite(r.score)
    && Number.isFinite(r.steps)
    && Number.isFinite(r.words);
}

/** 解析 localStorage 里的原始字符串：坏 JSON / 非数组 / 脏元素都要能扛住。 */
export function parseHistory(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter(isValidRecord).slice(0, HISTORY_LIMIT);
}

export function serializeHistory(history) {
  const list = Array.isArray(history) ? history.filter(isValidRecord).slice(0, HISTORY_LIMIT) : [];
  return JSON.stringify(list);
}

/** 结算页要显示的一行摘要文案（无记录时给空串，由调用方决定是否显示）。 */
export function summaryLine(summary) {
  if (!summary || !summary.rounds) return '';
  const pct = Math.round(summary.winRate * 100);
  return `历史 ${summary.rounds} 局 · 胜率 ${pct}% · 最佳 ${summary.bestScore}`;
}

// ---------------- 词集收藏（跨局元进度） ----------------
// 玩家在任意一局收录过的词永久进入「词集」，用来给出长期目标：
// 词库总量有限，迟早能集满，集满本身就是一个成就式目标。

/** 解析词集（localStorage 原文）。坏数据一律当空集，避免污染。 */
export function parseCollection(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return [...new Set(data.filter((w) => typeof w === 'string' && w.length > 0))];
  } catch {
    return [];
  }
}

export function serializeCollection(collection) {
  const list = Array.isArray(collection) ? [...new Set(collection.filter((w) => typeof w === 'string' && w.length))] : [];
  return JSON.stringify(list);
}

/** 新增收录：返回 { collection, added }（added 为本局真正新收集的词）。 */
export function addToCollection(collection, words) {
  const set = new Set(Array.isArray(collection) ? collection : []);
  const added = [];
  for (const w of Array.isArray(words) ? words : []) {
    if (typeof w !== 'string' || !w.length || set.has(w)) continue;
    set.add(w);
    added.push(w);
  }
  return { collection: [...set], added };
}

/** 词集进度：{ collected, total, ratio }。total 取词库规模，避免超过 100%。 */
export function collectionProgress(collection, totalWords) {
  const total = Math.max(1, Number.isFinite(totalWords) ? totalWords : 1);
  const n = Math.min(new Set(Array.isArray(collection) ? collection : []).size, total);
  return { collected: n, total, ratio: Math.round((n / total) * 1000) / 1000 };
}

