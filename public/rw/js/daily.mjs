// 拾径 · Wordloom — 每日挑战（纯函数）
//
// 规则：以本地日期为种子生成当天唯一的词图（同一天全球同一张图），
// 每天一次机会，结果记录在本地。日期与种子的换算全部是纯函数，便于测试。

const PAD = (n) => String(n).padStart(2, '0');

/** 本地日期键：YYYY-MM-DD。 */
export function dailyKey(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

/** 字符串 → 稳定 32 位种子（FNV-1a）。同一天必然同图。 */
export function dailySeed(key) {
  let h = 0x811c9dc5;
  for (const ch of String(key ?? '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 每日难度轮换：按距 1970-01-01 的天数取模，三天一轮。 */
export function dailyDifficulty(key, keys = ['easy', 'normal', 'hard']) {
  const t = Date.parse(`${key}T00:00:00`);
  if (Number.isNaN(t)) return keys[1] ?? 'normal';
  const days = Math.floor(t / 86400000);
  const i = ((days % keys.length) + keys.length) % keys.length;
  return keys[i];
}

/** 解析本地保存的每日成绩：坏数据一律视为「没玩过」。 */
export function parseDaily(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return null;
    if (typeof d.key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.key)) return null;
    if (!Number.isFinite(d.score)) return null;
    return { key: d.key, score: d.score, win: !!d.win, ts: Number.isFinite(d.ts) ? d.ts : 0 };
  } catch {
    return null;
  }
}

/** 今天的挑战状态：{ played, score, win }。跨天后旧记录自动失效。 */
export function dailyStatus(saved, todayKey) {
  if (!saved || saved.key !== todayKey) return { played: false, score: 0, win: false };
  return { played: true, score: saved.score, win: !!saved.win };
}

/** 生成一条可保存的每日成绩。 */
export function dailyRecord({ key, score, win, ts = Date.now() }) {
  return { key: String(key), score: Number.isFinite(score) ? score : 0, win: !!win, ts: Number.isFinite(ts) ? ts : Date.now() };
}
