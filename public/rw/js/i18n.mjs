// 拾径 · Wordloom — 界面语言（i18n）
//
// 设计：以「中文原文」作为 key，英文查表；查不到就回落中文。
// 好处是改动面最小、不会因为漏词而出现空白，也方便后续补翻译。
// 说明：词库与「一言」属于游戏内容，保持中文；界面文案支持中/英。

export const LANG_KEY = 'rw-lang';
export const LANGS = ['zh', 'en'];

/** 英文对照表（key 为中文原文）。 */
export const EN = {
  // ---- 引导页 ----
  'WORDLOOM · 在词与线的星座间行走 · Pico Neo3 WebXR': 'WORDLOOM · Wander the constellation of words · Pico Neo3 WebXR',
  '规则：从朱砂「出发」沿墨线走到相邻节点，每走一步耗一步数': 'Rules: start at the vermilion "Start" node; walk along ink lines to adjacent nodes; each step costs one move',
  '目标：步数耗尽前抵达赤金色的 1024 即成功': 'Goal: reach the golden 1024 before your moves run out',
  '操作：手柄射线瞄准脉冲光环节点，扣扳机走过去': 'Controls: aim the controller ray at a haloed node and pull the trigger',
  '收录：沿途词收进思想路径，走完生成海报': 'Collect: words you pass join your thought path and become a poster',
  '彩蛋：连点标题七次；键盘敲出 1024': 'Easter eggs: tap the title 7 times; type 1024 on a keyboard',

  // ---- 名称 ----
  '墨': 'Ink', '朱砂': 'Cinnabar', '青瓷': 'Celadon',
  '木鱼': 'Wood', '电子': 'Synth', '风铃': 'Chime',
  '悠然': 'Easy', '标准': 'Normal', '紧绷': 'Hard',
  '哲思': 'Philosophy', '极客': 'Geek', '古风': 'Classical', '清醒': 'Lucid', '科幻': 'Sci-fi',
  '抵达 1024': 'Reached 1024', '从容不迫': 'Unhurried', '字字珠玑': 'Word by word',
  '信步由缰': 'Free wanderer', '1024 之魂': 'Spirit of 1024', '词集三十': 'Lexicon 30',
  '三途皆涉': 'All three paths', '词汇全图': 'Full lexicon',
  '第': 'Round',
  '局': '',
  '词集': 'Lexicon',
  '累计': 'Total',
  '分': 'pts',
  '最佳': 'Best',
  '规则': 'Rules',
  ' — 从朱砂「出发」沿墨线走到相邻节点，每走一步耗一步数': ' — start at the vermilion "Start" node and walk along ink lines to adjacent nodes; each step costs one move',
  '目标': 'Goal',
  ' — 步数耗尽前抵达赤金色的「': ' — reach the golden "',
  '」，即成功': '" before you run out of moves',
  '操作': 'Controls',
  ' — 手柄射线瞄准带': ' — aim your controller ray at a node with a ',
  '脉冲光环': 'pulsing halo',
  '的节点，扣扳机即走过去': ', then pull the trigger to walk over',
  '收录': 'Collect',
  ' — 沿途词会被收进「思想路径」，走完生成你的路径海报': ' — words you pass are collected into your "thought path" and turned into a poster',
  '彩蛋': 'Easter eggs',
  ' — 连点标题七次…；键盘敲出 1024…（你试试看）': ' — tap the title 7 times...; type 1024 on a keyboard... (try it)',
  '开始游走 ▸': 'Start ▸',
  '📅 每日挑战': '📅 Daily Challenge',
  '今日未完成': 'Not played today',
  '今日已完成': 'Completed today',
  '难度': 'Difficulty',
  '悠然 16步': 'Easy 16',
  '标准 12步': 'Normal 12',
  '紧绷 9步': 'Hard 9',
  '皮肤': 'Skin',
  '音色': 'Timbre',
  '音效': 'Sound',
  '存档': 'Save',
  '导出': 'Export',
  '导入': 'Import',
  '重置': 'Reset',
  '词包': 'Word pack',
  '经典': 'Classic',
  '诗词': 'Poetry',
  '极客': 'Geek',
  '自然': 'Nature',
  '混合': 'Mixed',
  '连续': 'Streak',
  '🏆 成就': '🏆 Achievements',
  '成就总览': 'Achievements',
  '历史最佳': 'All-time best',
  '已解锁': 'Unlocked',
  '未解锁': 'Locked',
  '步数奖励': 'bonus moves',
  '音量': 'Volume',
  '防晕遮罩': 'Comfort vignette',
  '开': 'On',
  '关': 'Off',
  '座姿标定': 'Calibrate seated',
  '本月': 'This month',
  '天': 'days',
  '胜': 'wins',
  '每日挑战 · 月视图': 'Daily challenge · Month',
  '桌面模式可预览玩法；头显内才有完整体验（ENTER VR 按钮）': 'Desktop preview only; the full experience is in a headset (ENTER VR).',
  '步数': 'Moves',
  '收录词': 'Words',

  // ---- 结算 ----
  '抵达 1024': 'Reached 1024',
  '路，未走完': 'Path incomplete',
  '一言': 'Quote',
  '本次无成就': 'No achievements this run',
  '▶ 重放路径': '▶ Replay path',
  '↻ 换一句': '↻ Another quote',
  '复制路径文案': 'Copy path text',
  '已复制 ✓': 'Copied ✓',
  '⬇ 下载海报 PNG': '⬇ Download poster PNG',
  '再走一条 ▸': 'Walk again ▸',
  '历史': 'History',
  '胜率': 'win rate',
  '本局新词': 'new words',

  // ---- 词集面板 ----
  '收录过的词会永久留在词集里，集满即全部点亮': 'Collected words stay in your lexicon forever; collect them all to light it up.',
  '知道了': 'Got it',

  // ---- 提示 ----
  '✦ 1024 ✦': '✦ 1024 ✦',
  '步数限制已解除 · 本局无限步': 'Move limit lifted · unlimited moves this run',
  '▶ 路径回放中 · 扣扳机或点此跳过': '▶ Replaying path · press trigger or tap to skip',

  // ---- VR 菜单 / HUD / 面板 ----
  '拾径 · 设置': 'Wordloom · Settings',
  '难度（下一局生效）': 'Difficulty (next run)',
  '移动': 'Locomotion',
  '滑翔': 'Glide',
  '瞬移': 'Teleport',
  '开始游走': 'Start',
  '扣扳机点选 · 再按握键收起': 'Trigger to select · grip to close',
  '扣扳机 → 开始游走': 'Trigger → Start',
  '路未走完': 'Path incomplete',
  '🔇 静音': '🔇 Muted',
  '瞄准光环节点 · 扣扳机行走': 'Aim at a haloed node · trigger to walk',
  '步数': 'Moves',
  '词': 'words',
  '▶ 重放': '▶ Replay',
  '▸ 再来一局': '▸ Play again',
  '—': '—',

  // ---- 新手引导 ----
  '新手引导': 'Getting started',
  '寻找光圈': 'Find the halo',
  '能走的相邻词会亮起脉冲光环': 'Adjacent reachable words light up with a pulsing halo',
  '扣扳机前进': 'Pull the trigger',
  '手柄射线瞄准光圈，扣扳机走过去': 'Aim the controller ray at a halo and pull the trigger',
  '抵达 1024': 'Reach 1024',
  '步数耗尽前走到赤金色的 1024': 'Get to the golden 1024 before your moves run out',
  '知道了，开始吧': 'Got it, let\'s go',

  // ---- 海报 ----
  '随机游走': 'Wordloom',
  'RANDOM WALK · 思想路径': 'WORDLOOM · THOUGHT PATH',
  'Pico Neo3 VR': 'Pico Neo3 VR',
  '1024 · 标记独属于你的思想路径': '1024 · Mark your own thought path',

  // ---- 系统提示 ----
  '导入失败': 'Import failed',
  '存档已导入': 'Save imported',
  '确定清空本机所有进度（战绩 / 词集 / 每日挑战）吗？': 'Clear all local progress (records / lexicon / daily challenge)?',
};

/** 语言值归一化。 */
export function normalizeLang(v) {
  return LANGS.includes(v) ? v : 'zh';
}

/**
 * 翻译一段中文原文。lang !== 'en' 时原样返回。
 * 查不到的词条回落中文，保证不会出现空白界面。
 */
export function tr(text, lang = 'zh') {
  if (normalizeLang(lang) !== 'en') return text;
  const s = String(text);
  return Object.prototype.hasOwnProperty.call(EN, s) ? EN[s] : s;
}

/**
 * 应用静态 DOM 翻译：元素上的 data-i18n 存放中文原文。
 * 切回中文时用原文恢复，避免反复翻译导致串味。
 */
export function applyDomI18n(doc, lang) {
  const l = normalizeLang(lang);
  for (const el of doc.querySelectorAll('[data-i18n]')) {
    const zh = el.getAttribute('data-i18n');
    el.textContent = l === 'en' ? tr(zh, 'en') : zh;
  }
  for (const el of doc.querySelectorAll('[data-i18n-html]')) {
    const zh = el.getAttribute('data-i18n-html');
    el.innerHTML = l === 'en' ? tr(zh, 'en') : zh;
  }
  return l;
}
