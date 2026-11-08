// 生成 APK 启动图标（骰子 🎲 风格：深蓝底 + 金色路径折线），PNG 各密度
// 零依赖：手写 PNG 编码（zlib store 块）——只在构建 APK 时运行一次
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 192; // 主尺寸，其他密度缩放
function px(x, y, s) {
  // 归一化坐标 0..1
  const u = x / s, v = y / s;
  // 圆角方底
  const r = 0.18, m = 0.02;
  const inBox = u > m && u < 1 - m && v > m && v < 1 - m;
  // 圆角判定
  const cx = Math.min(Math.max(u, m + r), 1 - m - r);
  const cy = Math.min(Math.max(v, m + r), 1 - m - r);
  const corner = (u - cx) ** 2 + (v - cy) ** 2 > r * r;
  if (!inBox || corner) return null;
  // 背景渐变（深蓝→深紫）
  const t = (u + v) / 2;
  let R = Math.round(13 + t * 30), G = Math.round(16 + t * 10), B = Math.round(32 + t * 60);
  // 金色路径折线（贝塞尔感折线，宽 0.035）
  const pts = [[0.16, 0.80], [0.32, 0.58], [0.52, 0.66], [0.68, 0.36], [0.86, 0.24]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let tt = ((u - x1) * dx + (v - y1) * dy) / len2;
    tt = Math.min(1, Math.max(0, tt));
    const ddx = u - (x1 + tt * dx), ddy = v - (y1 + tt * dy);
    if (ddx * ddx + ddy * ddy < 0.032 * 0.032) return [255, 207, 77, 255];
  }
  // 节点圆点
  for (const [x1, y1] of pts) {
    const dd = (u - x1) ** 2 + (v - y1) ** 2;
    if (dd < 0.030 * 0.030) return [255, 240, 200, 255];
    if (dd < 0.045 * 0.045) return [255, 207, 77, 180];
  }
  // 终点星芒（右上金色光点）
  const gd = (u - 0.86) ** 2 + (v - 0.24) ** 2;
  if (gd < 0.012 * 0.012) return [255, 255, 230, 255];
  return [R, G, B, 255];
}

function makePng(s) {
  const raw = Buffer.alloc(s * (s * 4 + 1));
  for (let y = 0; y < s; y++) {
    raw[y * (s * 4 + 1)] = 0; // filter none
    for (let x = 0; x < s; x++) {
      const c = px(x, y, s) || [0, 0, 0, 0];
      const o = y * (s * 4 + 1) + 1 + x * 4;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = c[3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunks = [];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc);
    return Buffer.concat([len, body, crcB]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0); ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', idat));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

const root = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..');
const resDir = path.join(root, 'apk', 'res');
for (const [dpi, s] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  const d = path.join(resDir, `mipmap-${dpi}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'ic_launcher.png'), makePng(s));
}
console.log('图标已生成 apk/res/mipmap-*');
