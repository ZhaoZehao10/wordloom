// 拾径 · Wordloom — 数据包：词库 / 一言 / 皮肤 / 音色 / 成就 / 难度
// 全部为可自由替换的静态数据，与渲染逻辑解耦。

export const WORDS = [
  '字节', '递归', '光', '熵', '诗', '梦', '回声', '奇点', '量子', '星尘',
  '野草', '远方', '代码', '闰年', '泡沫', '灯火', '山海', '缪斯', '街角', '银河',
  '雨', '拓扑', '缓存', '指针', '黎明', '潮汐', '麦浪', '风筝', '硅', '蒸汽',
  '神经', '平仄', '变量', '无限', '石头', '候鸟', '硬币', '逻辑', '深渊', '群星',
  '镜像', '果壳', '蝴蝶', '磁场', '萤火', '冗余', '断点', '子夜', '晨昏', '白噪',
  '冰河', '岛屿', '苔藓', '时差', '棱镜', '潮牌', '回车', '浮点', '麦田', '蝉鸣',
];

export const FLAVORS = ['哲思', '极客', '古风', '清醒', '科幻'];
export const QUOTES = {
  哲思: [
    '我们不是在行走，是在被路径走出。',
    '每一步都是对无限可能的一次删减。',
    '地图不是疆域，路径才是。',
    '所谓选择，不过是与世界交换信息。',
    '终点回望时，迷路也是路。',
  ],
  极客: [
    '人生没有 undo，但每一步都在提交。',
    'random.seed(你) —— 今日份路径已生成。',
    '所有死锁，都源于两个不肯回头的人。',
    '0 与 1 之间，隔着整个世界。',
    '常走的路会变成算法，偶尔迷路才能采到新解。',
  ],
  古风: [
    '山重水复疑无路，柳暗花明又一村。',
    '人生天地间，忽如远行客。',
    '此心安处，即是吾乡。',
    '行到水穷处，坐看云起时。',
    '路漫漫其修远兮，吾将上下而求索。',
  ],
  清醒: [
    '走错的路也算数，前提是你真的走了。',
    '别用战术上的勤奋，掩盖路径上的懒惰。',
    '世界是个巨大的图，你是其中一个活跃节点。',
    '焦虑，源于想同时走两条路。',
    '先出发，意义会在路上追上你。',
  ],
  科幻: [
    '在光走过的地方，黑暗才知道自己缺了什么。',
    '每个选择分裂出一个你，正走在另一条边上。',
    '文明不过是宇宙随机游走中的一段长程关联。',
    '1024 是二进制的圆周率日。',
    '熵增不可逆，所以你走过的路才珍贵。',
  ],
};

// 皮肤：影响背景 / 墨线 / 高亮 / 词色 / 起点终点色
export const SKINS = {
  ink: {
    name: '墨', bg: 0x0b1020, fog: 0x0b1020, floor: 0x141b33, grid1: 0x2c3a6e, grid2: 0x222e58,
    line: 0x55628c, lineHi: 0x6cd0ff, trail: 0xb18cff, word: 0xdfe9ff, wordVisited: 0x5a6488,
    start: 0xff5544, goal: 0xffcf4d, halo: 0x6cd0ff, hud: '#dfe7ff',
  },
  cinnabar: {
    name: '朱砂', bg: 0x150e0c, fog: 0x150e0c, floor: 0x241612, grid1: 0x4a2c22, grid2: 0x35201a,
    line: 0x5c4038, lineHi: 0xff8866, trail: 0xffb02e, word: 0xffe9d6, wordVisited: 0x7a5c50,
    start: 0xff3b2f, goal: 0xffd24d, halo: 0xff8866, hud: '#ffe9d6',
  },
  celadon: {
    name: '青瓷', bg: 0x0a1412, fog: 0x0a1412, floor: 0x10231e, grid1: 0x1e4638, grid2: 0x16332a,
    line: 0x2e5c4c, lineHi: 0x6dffa8, trail: 0xffd76d, word: 0xdcfff0, wordVisited: 0x4e7a6a,
    start: 0xff5544, goal: 0xffd76d, halo: 0x6dffa8, hud: '#dcfff0',
  },
};

// 音色：换音色等于换乐器
export const TIMBRES = {
  wood:  { name: '木鱼', step: { type: 'triangle', gain: 0.10 }, collect: { type: 'triangle', gain: 0.12 }, ui: { type: 'square', gain: 0.05 } },
  synth: { name: '电子', step: { type: 'square', gain: 0.07 }, collect: { type: 'sawtooth', gain: 0.08 }, ui: { type: 'square', gain: 0.05 } },
  chime: { name: '风铃', step: { type: 'sine', gain: 0.12 }, collect: { type: 'sine', gain: 0.14 }, ui: { type: 'sine', gain: 0.06 } },
};

export const ACHIEVEMENTS = {
  reach:  { icon: '🏁', name: '抵达 1024' },
  calm:   { icon: '🧘', name: '从容不迫' },   // 胜利且剩余步数 ≥ 5
  pearls: { icon: '📿', name: '字字珠玑' },   // 收录 ≥ 10 词
  stroll: { icon: '🚶', name: '信步由缰' },   // 失败但收录 ≥ 6 词
  egg:    { icon: '✨', name: '1024 之魂' },  // 触发 1024 彩蛋
  collector: { icon: '📚', name: '词集三十' }, // 跨局词集 ≥ 30 词
  allDiffs:  { icon: '🧭', name: '三途皆涉' }, // 三种难度各胜一局
  lexicon:   { icon: '🌌', name: '词汇全图' }, // 词集集满
};

export const DIFFICULTIES = [
  { key: 'easy',   name: '悠然', steps: 16 },
  { key: 'normal', name: '标准', steps: 12 },
  { key: 'hard',   name: '紧绷', steps: 9 },
];

export const SCORE = { word: 10, stepLeft: 5, win: 100 };

// ---------------- 主题词包 ----------------
// 词包只影响「这一局用哪些词」，不改变规则；词集是跨词包的全局收藏。
// 每个词包至少 40 词，保证 9~16 步的图也有足够多样性。
const POETRY_EXTRA = [
  '落花', '流水', '明月', '长亭', '故人', '青衫', '归舟', '烟雨', '旧梦', '折柳',
  '听雪', '问月', '孤舟', '残照', '寒山', '夜航', '春信', '秋声', '空谷', '余音',
];
const GEEK_EXTRA = [
  '二进制', '协议', '线程', '编译', '哈希', '内核', '栈帧', '管道', '信号', '调度',
  '字节码', '对象', '闭包', '迭代', '并行', '容错', '灰度', '沙箱', '快照', '回滚',
];
const NATURE_EXTRA = [
  '晚霞', '溪流', '山谷', '林间', '荒原', '云', '风', '露水', '松涛', '雪线',
  '花期', '落叶', '远山', '薄雾', '草甸', '河湾', '石阶', '炊烟', '南风', '晴空',
];

export const WORD_PACKS = {
  classic: { key: 'classic', name: '经典', desc: '词与线织成的荒原', words: WORDS },
  poetry: {
    key: 'poetry', name: '诗词', desc: '落花流水，长亭故人',
    words: [...new Set([
      '诗', '梦', '山海', '灯火', '银河', '雨', '潮汐', '麦浪', '风筝', '萤火',
      '蝉鸣', '晨昏', '子夜', '岛屿', '苔藓', '蝴蝶', '果壳', '深渊', '群星', '缪斯',
      ...POETRY_EXTRA,
    ])],
  },
  geek: {
    key: 'geek', name: '极客', desc: '字节与指针的夜航',
    words: [...new Set([
      '字节', '递归', '代码', '缓存', '指针', '变量', '逻辑', '拓扑', '熵', '量子',
      '奇点', '硅', '蒸汽', '冗余', '断点', '浮点', '回车', '白噪', '镜像', '磁场',
      ...GEEK_EXTRA,
    ])],
  },
  nature: {
    key: 'nature', name: '自然', desc: '野草、候鸟与溪流',
    words: [...new Set([
      '光', '星尘', '野草', '远方', '泡沫', '黎明', '潮汐', '石头', '候鸟', '麦田',
      '冰河', '岛屿', '苔藓', '蝴蝶', '萤火', '蝉鸣', '回声', '银河', '雨',
      ...NATURE_EXTRA,
    ])],
  },
};

export const PACK_KEYS = Object.keys(WORD_PACKS);

/** 所有词包的并集：词集收藏的口径（跨词包累计）。 */
export const ALL_WORDS = [...new Set(PACK_KEYS.flatMap((k) => WORD_PACKS[k].words))];
export const TOTAL_WORDS = ALL_WORDS.length;

/** 词包合法性校验。 */
export function normalizePack(v) {
  return PACK_KEYS.includes(v) ? v : 'classic';
}