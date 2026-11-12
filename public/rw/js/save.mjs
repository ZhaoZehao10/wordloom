// 拾径 · Wordloom — 存档导出 / 导入 / 重置（纯函数）
//
// 目标：玩家的战绩、词集、偏好可以备份到文件、换设备/换浏览器后恢复。
// 导入要做严格校验：任何缺字段、类型不对、版本不兼容的输入都必须被拒绝，
// 并且绝不能把坏数据写进 localStorage。

export const SAVE_VERSION = 2;
export const SAVE_APP = 'wordloom-vr';

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const WEEK_RE = /^\d{4}-W\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** FNV-1a 32 位哈希（十六进制），用于存档完整性校验。 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

/** 规范化 JSON：对象键排序，保证校验和与键顺序无关。 */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

const isDailyLike = (d) => !!d && typeof d === 'object'
  && isStr(d.key) && DAY_RE.test(d.key) && isNum(d.score) && typeof d.win === 'boolean';
const isWeeklyLike = (d) => !!d && typeof d === 'object'
  && isStr(d.key) && WEEK_RE.test(d.key) && isNum(d.score) && typeof d.win === 'boolean';

/** 把当前存档整理成可导出的 JSON 字符串（不含任何个人信息）。 */
export function exportSave(save = {}) {
  const {
    best = 0, history = [], collection = [], diff = 'normal', skin = 'ink', timbre = 'wood', moveMode = 'glide', pack = 'classic',
    achievements = [], daily = null, dailyHistory = [], weekly = null, weeklyHistory = [],
  } = save;
  const payload = {
    app: SAVE_APP,
    version: SAVE_VERSION,
    exportedAt: new Date().toISOString(),
    best: isNum(best) ? best : 0,
    history: Array.isArray(history) ? history.slice(0, 60) : [],
    collection: Array.isArray(collection)
      ? [...new Set(collection.filter((w) => isStr(w) && w.length > 0 && w.length <= 12))].slice(0, 200)
      : [],
    settings: {
      diff: isStr(diff) ? diff : 'normal',
      skin: isStr(skin) ? skin : 'ink',
      timbre: isStr(timbre) ? timbre : 'wood',
      moveMode: ['glide', 'teleport'].includes(moveMode) ? moveMode : 'glide',
      pack: ['classic', 'poetry', 'geek', 'nature', 'mix'].includes(pack) ? pack : 'classic',
    },
    // v2：跨设备恢复也要带上成就与挑战进度
    progress: {
      achievements: Array.isArray(achievements)
        ? [...new Set(achievements.filter((k) => isStr(k) && k.length > 0 && k.length <= 40))].slice(0, 64)
        : [],
      daily: isDailyLike(daily) ? { key: daily.key, score: daily.score, win: daily.win, ts: isNum(daily.ts) ? daily.ts : 0 } : null,
      dailyHistory: Array.isArray(dailyHistory) ? dailyHistory.filter(isDailyLike).slice(0, 30) : [],
      weekly: isWeeklyLike(weekly) ? { key: weekly.key, score: weekly.score, win: weekly.win, ts: isNum(weekly.ts) ? weekly.ts : 0 } : null,
      weeklyHistory: Array.isArray(weeklyHistory) ? weeklyHistory.filter(isWeeklyLike).slice(0, 26) : [],
    },
  };
  payload.checksum = fnv1a(canonical(payload));
  return JSON.stringify(payload);
}

/**
 * 解析并校验导入内容。
 * @returns {{ok:true, data:{best,history,collection,settings}} | {ok:false, error:string}}
 */
export function importSave(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: '内容为空' };
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return { ok: false, error: '不是合法的 JSON' };
  }
  if (!d || typeof d !== 'object') return { ok: false, error: '格式不正确' };
  if (d.app !== SAVE_APP) return { ok: false, error: '不是本游戏的存档' };
  if (!isNum(d.version)) return { ok: false, error: '缺少版本号' };
  if (d.version > SAVE_VERSION) return { ok: false, error: `存档版本过新（${d.version} > ${SAVE_VERSION}）` };
  // 校验和（v2.1 起写入；旧存档没有该字段则跳过，保持兼容）
  if (d.checksum !== undefined) {
    if (!isStr(d.checksum)) return { ok: false, error: '校验和格式错误' };
    const clone = { ...d };
    delete clone.checksum;
    if (fnv1a(canonical(clone)) !== d.checksum) {
      return { ok: false, error: '存档校验失败（内容可能被修改或损坏）' };
    }
  }

  const best = isNum(d.best) && d.best >= 0 ? d.best : 0;
  const history = Array.isArray(d.history) ? d.history.filter(isValidHistory).slice(0, 60) : [];
  const collection = Array.isArray(d.collection)
    ? [...new Set(d.collection.filter((w) => isStr(w) && w.length > 0 && w.length <= 12))].slice(0, 200)
    : [];
  const settings = (d.settings && typeof d.settings === 'object') ? {
    diff: ['easy', 'normal', 'hard'].includes(d.settings.diff) ? d.settings.diff : 'normal',
    skin: isStr(d.settings.skin) ? d.settings.skin : 'ink',
    timbre: isStr(d.settings.timbre) ? d.settings.timbre : 'wood',
    moveMode: ['glide', 'teleport'].includes(d.settings.moveMode) ? d.settings.moveMode : 'glide',
    pack: ['classic', 'poetry', 'geek', 'nature', 'mix'].includes(d.settings.pack) ? d.settings.pack : 'classic',
  } : { diff: 'normal', skin: 'ink', timbre: 'wood', moveMode: 'glide', pack: 'classic' };

  // v2 进度：缺省或非法时降级为空（v1 存档可直接导入）
  const p = (d.progress && typeof d.progress === 'object') ? d.progress : {};
  const progress = {
    achievements: Array.isArray(p.achievements)
      ? [...new Set(p.achievements.filter((k) => isStr(k) && k.length > 0 && k.length <= 40))].slice(0, 64)
      : [],
    daily: isDailyLike(p.daily) ? { key: p.daily.key, score: p.daily.score, win: p.daily.win, ts: isNum(p.daily.ts) ? p.daily.ts : 0 } : null,
    dailyHistory: Array.isArray(p.dailyHistory) ? p.dailyHistory.filter(isDailyLike).slice(0, 30) : [],
    weekly: isWeeklyLike(p.weekly) ? { key: p.weekly.key, score: p.weekly.score, win: p.weekly.win, ts: isNum(p.weekly.ts) ? p.weekly.ts : 0 } : null,
    weeklyHistory: Array.isArray(p.weeklyHistory) ? p.weeklyHistory.filter(isWeeklyLike).slice(0, 26) : [],
  };

  return { ok: true, data: { best, history, collection, settings, progress } };
}

function isValidHistory(r) {
  return !!r && typeof r === 'object'
    && typeof r.win === 'boolean'
    && isNum(r.score) && isNum(r.steps) && isNum(r.words);
}

/** 重置后应写回的本地键（调用方逐项 setItem）。 */
export function resetValues() {
  return {
    'rw-best': '0',
    'rw-history': '[]',
    'rw-collection': '[]',
    'rw-diff': 'normal',
    'rw-daily': '',
    'rw-daily-history': '[]',
    'rw-weekly': '',
    'rw-weekly-history': '[]',
    'rw-achievements': '[]',
  };
}
