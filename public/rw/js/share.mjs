// 拾径 · Wordloom — 分享文案（纯函数）
//
// 三张卡（统计 / 成就 / 周报）各生成一段可直接粘贴到聊天窗口的文本。
// 不包含任何个人信息，只包含游戏数据与官网链接。

export const SITE_URL = 'https://zhaozehao10.github.io/wordloom/rw/';

/** 统计分享文案。 */
export function shareStatsText(stats, url = SITE_URL) {
  const s = stats && typeof stats === 'object' ? stats : {};
  const total = Number.isFinite(s.total) ? s.total : 0;
  const wins = Number.isFinite(s.wins) ? s.wins : 0;
  const winRate = Number.isFinite(s.winRate) ? s.winRate : 0;
  const best = Number.isFinite(s.best) ? s.best : 0;
  const avgSteps = Number.isFinite(s.avgSteps) ? s.avgSteps : 0;
  if (total === 0) return `我在《拾径》里还没走完一局，来陪我走第一段路：${url}`;
  return `我在《拾径》走了 ${total} 局，${wins} 胜（${winRate}%），最佳 ${best} 分，平均 ${avgSteps} 步。来挑战我：${url}`;
}

/** 成就分享文案。 */
export function shareAchievementsText({ unlocked = 0, total = 0, names = [] } = {}, url = SITE_URL) {
  const u = Number.isFinite(unlocked) ? unlocked : 0;
  const t = Number.isFinite(total) ? total : 0;
  const list = Array.isArray(names) ? names.filter((n) => typeof n === 'string' && n).slice(0, 3) : [];
  const suffix = list.length ? `（${list.join('、')}）` : '';
  return `我在《拾径》解锁了 ${u}/${t} 个成就${suffix}，来把我的记录刷掉：${url}`;
}

/** 周报分享文案。 */
export function shareWeeklyText({ weeksPlayed = 0, best = 0, total = 0, currentKey = '' } = {}, url = SITE_URL) {
  const w = Number.isFinite(weeksPlayed) ? weeksPlayed : 0;
  const b = Number.isFinite(best) ? best : 0;
  const t = Number.isFinite(total) ? total : 0;
  const key = typeof currentKey === 'string' ? currentKey : '';
  if (w === 0) return `《拾径》每周挑战本周还没人走，来拿首胜：${url}`;
  return `《拾径》每周挑战${key ? ' ' + key : ''}：我最近 ${w} 周共 ${t} 分，最佳 ${b}。来挑战本周词图：${url}`;
}
