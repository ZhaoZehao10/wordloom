// 拾径 Wordloom — 结算海报（PNG）绘制
//
// 原版网页回合结束会生成「思想路径」海报并可下载 PNG。VR 版此前只有复制文案，
// 这里补齐同等能力：把结算数据排成 1080×1620 的竖版海报，浏览器内导出 PNG。
//
// 设计：内容组装（posterContent）是纯函数，可在 Node 里断言；
// 绘制（drawPoster）只依赖一个 2D context，便于用 mock 断言「画了什么字」。

const W = 1080;
const H = 1620;

/** 把结算结果整理成海报内容（纯函数，便于单元测试）。 */
export function posterContent(result, { round = 0 } = {}) {
  const words = result.words || [];
  // 路径词按行排布，每行最多 6 个，最多 4 行（超出用省略号）
  const perLine = 6;
  const maxLines = 4;
  const lines = [];
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine));
  let poemLines = lines.slice(0, maxLines).map((l) => l.join(' · '));
  if (lines.length > maxLines) poemLines[maxLines - 1] = poemLines[maxLines - 1] + ' …';
  if (!poemLines.length) poemLines = ['（一条无言的路）'];

  return {
    title: '拾径',
    subtitle: 'RANDOM WALK · 思想路径',
    outcome: result.win ? '抵达 1024' : '路，未走完',
    poemLines,
    quote: `「${result.quote.text}」`,
    flavor: `—— ${result.quote.flavor} 一言`,
    stats: `${result.steps} 步 · 收录 ${result.wordCount ?? words.length} 词 · ${result.score} 分`,
    achievements: (result.achievements || []).map((a) => `${a.icon} ${a.name}`),
    footer: round > 0 ? `第 ${round} 局 · Pico Neo3 VR` : 'Pico Neo3 VR',
  };
}

function rrect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** 在给定 2D context 上绘制海报。返回绘制到的文字清单（便于测试/调试）。 */
export function drawPoster(c, result, { round = 0, width = W, height = H } = {}) {
  const data = posterContent(result, { round });
  const drawn = [];
  const text = (s, x, y, font, color, align = 'center') => {
    c.font = font;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillText(s, x, y);
    drawn.push(s);
  };

  // 背景：深空渐变 + 细网格
  const bg = c.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#0b1020');
  bg.addColorStop(0.55, '#111a36');
  bg.addColorStop(1, '#0a0e1c');
  c.fillStyle = bg;
  c.fillRect(0, 0, width, height);

  c.strokeStyle = 'rgba(108,160,255,0.07)';
  c.lineWidth = 1;
  for (let x = 0; x < width; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, height); c.stroke(); }
  for (let y = 0; y < height; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke(); }

  // 外框
  c.strokeStyle = 'rgba(140,165,255,0.35)';
  c.lineWidth = 3;
  rrect(c, 48, 48, width - 96, height - 96, 32);
  c.stroke();

  // 背景水印「1024」：填补下半版心，同时点题
  c.globalAlpha = 0.055;
  c.font = 'bold 300px "Segoe UI",sans-serif';
  c.fillStyle = '#ffcf4d';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('1024', width / 2, 1250);
  c.globalAlpha = 1;

  // 标题
  text(data.title, width / 2, 200, 'bold 96px "PingFang SC","Microsoft YaHei",sans-serif', '#eaf0ff');
  text(data.subtitle, width / 2, 280, '28px "Segoe UI",sans-serif', '#8b96b8');

  // 结果
  text(data.outcome, width / 2, 380, 'bold 52px "PingFang SC",sans-serif', result.win ? '#ffcf4d' : '#ff9a7a');

  // 分隔线
  c.strokeStyle = 'rgba(140,165,255,0.25)';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(160, 440); c.lineTo(width - 160, 440); c.stroke();

  // 路径诗（流式：从 y=520 起逐行下移）
  let y = 520;
  for (const line of data.poemLines) {
    text(line, width / 2, y, '44px "PingFang SC","Microsoft YaHei",sans-serif', '#f2f6ff');
    y += 78;
  }

  // 分隔线 + 一言（跟随诗句高度，避免大段空白）
  y += 40;
  c.strokeStyle = 'rgba(140,165,255,0.25)';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(220, y); c.lineTo(width - 220, y); c.stroke();
  y += 90;
  text(data.quote, width / 2, y, 'italic 36px "PingFang SC",serif', '#b18cff');
  text(data.flavor, width / 2, y + 62, '26px "Segoe UI",sans-serif', '#8b96b8');

  // 数据（与一言保持呼吸距离，但不早于 930）
  const statsY = Math.max(y + 140, 930);
  text(data.stats, width / 2, statsY, '30px "Segoe UI",sans-serif', '#dfe7ff');

  // 成就
  let ax = 160;
  const ay = statsY + 90;
  for (const a of data.achievements) {
    c.font = '26px "PingFang SC",sans-serif';
    const w = c.measureText(a).width + 44;
    c.fillStyle = 'rgba(255,207,77,0.10)';
    c.strokeStyle = 'rgba(255,207,77,0.45)';
    c.lineWidth = 2;
    rrect(c, ax, ay - 26, w, 52, 26);
    c.fill(); c.stroke();
    text(a, ax + w / 2, ay, '26px "PingFang SC",sans-serif', '#ffcf4d');
    ax += w + 16;
    if (ax > width - 220) break;
  }

  // 页脚
  text(data.footer, width / 2, height - 110, '24px "Segoe UI",sans-serif', '#5f6a88');
  text('1024 · 标记独属于你的思想路径', width / 2, height - 70, '20px "PingFang SC",sans-serif', '#4a5470');

  return { drawn, data };
}

export const POSTER_SIZE = { width: W, height: H };
