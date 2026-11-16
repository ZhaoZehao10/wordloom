// 拾径 · Wordloom — 依赖版本与许可审计
//
// 核对本地 vendor 依赖的版本标记与许可声明：
//   - three.js：REVISION 常量
//   - qrcode-generator：LICENSE 文件版本
//   - THIRD-PARTY-NOTICES 是否覆盖每个依赖
//   - package.json 是否为 MIT
//
// 用法：node tools/deps-audit.mjs → dist/DEPS-AUDIT.md，错误时退出码 1

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEPS = [
  {
    name: 'three.js',
    file: 'public/vendor/three.module.min.js',
    expected: '160',
    versionRe: /const [a-zA-Z]="(\d+)",/,
    notices: 'three.js',
  },
  {
    name: 'qrcode-generator',
    file: 'public/rw/vendor/qrcode.js',
    versionFile: 'public/rw/vendor/qrcode-LICENSE.txt',
    expected: '2.0.4',
    versionRe: /qrcode-generator v([\d.]+)/,
    notices: 'qrcode-generator',
  },
];

/** 从文本解析版本（无匹配返回 null）。 */
export function parseVersion(text, re) {
  const m = String(text || '').match(re);
  return m ? m[1] : null;
}

/** 审计单个依赖。 */
export function auditDependency(dep, content, noticesText, pkgLicense) {
  const errors = [];
  const warnings = [];
  if (content === null) {
    errors.push(`${dep.name}: 文件缺失 ${dep.file}`);
  } else if (dep.versionRe && dep.expected) {
    const v = parseVersion(content, dep.versionRe);
    if (v !== dep.expected) errors.push(`${dep.name}: 版本 ${v || '未知'} ≠ 期望 ${dep.expected}`);
  }
  if (dep.notices && !String(noticesText || '').includes(dep.notices)) {
    warnings.push(`${dep.name}: THIRD-PARTY-NOTICES 未提及`);
  }
  if (pkgLicense && pkgLicense !== 'MIT') errors.push(`package.json license 不是 MIT：${pkgLicense}`);
  return { errors, warnings };
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const noticesPath = path.join(ROOT, 'THIRD-PARTY-NOTICES.md');
  const noticesText = fs.existsSync(noticesPath) ? fs.readFileSync(noticesPath, 'utf8') : '';
  const errors = [];
  const warnings = [];
  const rows = [];
  for (const dep of DEPS) {
    const abs = path.join(ROOT, dep.file);
    const content = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    const vContent = dep.versionFile && fs.existsSync(path.join(ROOT, dep.versionFile))
      ? fs.readFileSync(path.join(ROOT, dep.versionFile), 'utf8') : content;
    const res = auditDependency(dep, vContent, noticesText, pkg.license);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
    const v = vContent ? parseVersion(vContent, dep.versionRe) : null;
    rows.push(`| ${dep.name} | ${v || '—'} | ${dep.expected} | ${content ? '✅' : '❌'} |`);
  }
  const lines = [
    '# 依赖版本审计',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    `结果：${errors.length ? `❌ ${errors.length} 个错误` : '✅ 全部通过'}${warnings.length ? `（${warnings.length} 个警告）` : ''}`,
    '',
    '| 依赖 | 检测版本 | 期望版本 | 文件 |',
    '|------|----------|----------|------|',
    ...rows,
    '',
    '## 错误',
    ...(errors.length ? errors.map((x) => `- ${x}`) : ['- 无']),
    '',
    '## 警告',
    ...(warnings.length ? warnings.map((x) => `- ${x}`) : ['- 无']),
    '',
    `- package.json license：${pkg.license} ${pkg.license === 'MIT' ? '✅' : '❌'}`,
    `- THIRD-PARTY-NOTICES：${noticesText ? '存在 ✅' : '缺失 ❌'}`,
    '',
  ];
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist', 'DEPS-AUDIT.md'), lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('deps-audit.mjs')) main();
