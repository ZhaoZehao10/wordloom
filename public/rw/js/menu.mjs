// 拾径 Wordloom — VR 内菜单的纯布局与命中判定（不依赖 three / DOM，可单测）
//
// 设计：菜单是一张 canvas 贴图（1024×720）+ 一块 1.2×0.84m 的 3D 面板。
// 射线命中面板后拿到 UV，交给 hitTestMenu 换算成按钮 id —— 这样命中逻辑
// 与渲染解耦，可以直接在 Node 里穷举测试「每个按钮中心点都能点中自己」。

export const MENU_W = 1024;
export const MENU_H = 720;

const M = 40;          // 外边距
const TITLE_H = 90;    // 标题区高度
const ROW_H = 108;     // 每行高度
const ROW_GAP = 14;

/**
 * 菜单布局。返回 { buttons: [{id,label,row,x,y,w,h}], rows: [{title, y}] }
 * 坐标均为 canvas 像素，原点左上。
 */
import { tr } from './i18n.mjs';

export function buildMenuLayout({
  difficulties = ['悠然', '标准', '紧绷'],
  skins = ['墨', '朱砂', '青瓷'],
  timbres = ['木鱼', '电子', '风铃'],
  moves = ['滑翔', '瞬移'],
} = {}) {
  const rows = [
    { title: '难度（下一局生效）', items: difficulties.map((label, i) => ({ id: `diff:${['easy', 'normal', 'hard'][i]}`, label })) },
    { title: '皮肤', items: skins.map((label, i) => ({ id: `skin:${['ink', 'cinnabar', 'celadon'][i]}`, label })) },
    { title: '音色', items: timbres.map((label, i) => ({ id: `timbre:${['wood', 'synth', 'chime'][i]}`, label })) },
    { title: '移动', items: moves.map((label, i) => ({ id: `move:${['glide', 'teleport'][i]}`, label })) },
  ];

  const buttons = [];
  let y = TITLE_H + 10;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const n = row.items.length;
    const gap = 18;
    const usable = MENU_W - M * 2;
    const w = Math.floor((usable - gap * (n - 1)) / n);
    const itemY = y + 44;
    row.items.forEach((it, i) => {
      buttons.push({
        id: it.id, label: it.label, row: r,
        x: M + i * (w + gap), y: itemY, w, h: 68,
      });
    });
    y = itemY + 68 + ROW_GAP;
  }

  // 底部主按钮：开始 / 重开
  const startW = 420;
  buttons.push({
    id: 'start', label: '开始游走', row: rows.length,
    x: (MENU_W - startW) / 2, y: y + 10, w: startW, h: 84,
  });

  // 行长表（绘制标题用）
  let ry = TITLE_H + 10;
  const rowTitles = rows.map((row) => {
    const yy = ry;
    ry += 44 + 68 + ROW_GAP;
    return { title: row.title, y: yy };
  });

  return { buttons, rowTitles, width: MENU_W, height: MENU_H };
}

/** 命中判定：u,v ∈ [0,1]（面板 UV，原点左上）。返回按钮 id 或 null。 */
export function hitTestMenu(buttons, u, v) {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  const px = u * MENU_W;
  const py = v * MENU_H;
  for (const b of buttons) {
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.id;
  }
  return null;
}

/** 选中态：用于给按钮画高亮（纯函数，便于测试）。 */
export function isSelected(id, { difficulty = 'normal', skin = 'ink', timbre = 'wood', moveMode = 'glide' } = {}) {
  const [kind, value] = id.split(':');
  if (kind === 'diff') return value === difficulty;
  if (kind === 'skin') return value === skin;
  if (kind === 'timbre') return value === timbre;
  if (kind === 'move') return value === moveMode;
  return false;
}

/**
 * 绘制菜单。ctx 为 2D context；返回 layout（便于测试断言）。
 */
export function drawMenu(ctx, state = {}) {
  const { buttons, rowTitles, width, height } = buildMenuLayout();
  const {
    difficulty = 'normal', skin = 'ink', timbre = 'wood',
    pendingDifficulty = 'normal', moveMode = 'glide', lang = 'zh',
  } = state;
  const T = (s) => tr(s, lang);

  // 背板
  ctx.fillStyle = 'rgba(10,14,28,0.94)';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(140,165,255,0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, width - 12, height - 12);

  // 标题
  ctx.fillStyle = '#eaf0ff';
  ctx.font = 'bold 44px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(T('拾径 · 设置'), width / 2, 52);

  // 行标题
  ctx.font = '26px "PingFang SC",sans-serif';
  ctx.fillStyle = '#8b96b8';
  ctx.textAlign = 'left';
  for (const r of rowTitles) ctx.fillText(T(r.title), 40, r.y + 16);

  // 按钮
  for (const b of buttons) {
    const sel = isSelected(b.id, { difficulty: pendingDifficulty, skin, timbre, moveMode });
    const isStart = b.id === 'start';
    ctx.fillStyle = isStart
      ? 'rgba(70,110,200,0.85)'
      : sel ? 'rgba(108,208,255,0.22)' : 'rgba(30,40,74,0.9)';
    ctx.strokeStyle = isStart
      ? 'rgba(150,200,255,0.9)'
      : sel ? 'rgba(108,208,255,0.95)' : 'rgba(140,165,255,0.35)';
    ctx.lineWidth = sel || isStart ? 4 : 2;
    roundRect(ctx, b.x, b.y, b.w, b.h, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isStart ? '#ffffff' : sel ? '#bfe9ff' : '#dfe7ff';
    ctx.font = `${isStart ? 'bold ' : ''}${isStart ? 34 : 30}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(T(b.label), b.x + b.w / 2, b.y + b.h / 2 + 1);
  }

  // 提示
  ctx.fillStyle = '#5f6a88';
  ctx.font = '22px "PingFang SC",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(T('扣扳机点选 · 再按握键收起'), width / 2, height - 26);

  return { buttons, rowTitles, width, height };
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
