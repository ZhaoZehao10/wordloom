// 拾径 · Wordloom — 存档导出 / 导入 / 重置（纯函数）
//
// 目标：玩家的战绩、词集、偏好可以备份到文件、换设备/换浏览器后恢复。
// 导入要做严格校验：任何缺字段、类型不对、版本不兼容的输入都必须被拒绝，
// 并且绝不能把坏数据写进 localStorage。

export const SAVE_VERSION = 1;
export const SAVE_APP = 'wordloom-vr';

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 把当前存档整理成可导出的 JSON 字符串（不含任何个人信息）。 */
export function exportSave(save = {}) {
  const {
    best = 0, history = [], collection = [], diff = 'normal', skin = 'ink', timbre = 'wood',
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
    },
  };
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

  const best = isNum(d.best) && d.best >= 0 ? d.best : 0;
  const history = Array.isArray(d.history) ? d.history.filter(isValidHistory).slice(0, 60) : [];
  const collection = Array.isArray(d.collection)
    ? [...new Set(d.collection.filter((w) => isStr(w) && w.length > 0 && w.length <= 12))].slice(0, 200)
    : [];
  const settings = (d.settings && typeof d.settings === 'object') ? {
    diff: ['easy', 'normal', 'hard'].includes(d.settings.diff) ? d.settings.diff : 'normal',
    skin: isStr(d.settings.skin) ? d.settings.skin : 'ink',
    timbre: isStr(d.settings.timbre) ? d.settings.timbre : 'wood',
  } : { diff: 'normal', skin: 'ink', timbre: 'wood' };

  return { ok: true, data: { best, history, collection, settings } };
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
  };
}
