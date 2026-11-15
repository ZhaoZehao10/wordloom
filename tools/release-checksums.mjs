// 拾径 · Wordloom — 发布资产 SHA-256 校验清单
//
// 为发布产物生成 SHA256SUMS.txt，下载后可自行校验：
//   Windows:  Get-FileHash .\Wordloom-vX.Y.Z.apk -Algorithm SHA256
//   macOS/Linux: shasum -a 256 Wordloom-vX.Y.Z.apk
//
// 用法：node tools/release-checksums.mjs [输出文件]

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 计算字符串/缓冲区的 sha256 十六进制。 */
export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** 对一组文件生成清单文本（不存在则跳过）。 */
export function buildChecksumList(files) {
  const lines = [];
  for (const f of files) {
    if (!fs.existsSync(f.path)) continue;
    const buf = fs.readFileSync(f.path);
    lines.push({ name: f.name, sha256: sha256(buf), size: buf.length });
  }
  return lines;
}

/** 渲染为 sha256sum 兼容格式。 */
export function renderChecksums(list) {
  return list.map((x) => `${x.sha256}  ${x.name}`).join('\n') + '\n';
}

if (process.argv[1] && process.argv[1].endsWith('release-checksums.mjs')) {
  const out = process.argv[2] || path.join(ROOT, 'dist', 'SHA256SUMS.txt');
  const list = buildChecksumList([
    { name: 'Wordloom-app.apk', path: path.join(ROOT, 'dist', '拾径Wordloom.apk') },
    { name: 'Wordloom-offline.html', path: path.join(ROOT, 'dist', '拾径-离线版.html') },
    { name: 'perf-report.html', path: path.join(ROOT, 'dist', 'perf-report.html') },
  ]);
  fs.writeFileSync(out, renderChecksums(list), 'utf8');
  console.log('写出:', out);
  for (const x of list) console.log(`  ${x.sha256.slice(0, 16)}…  ${x.name} (${x.size} bytes)`);
}
