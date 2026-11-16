// 拾径 · Wordloom — 仓库健康审计
//
// 只读检查（不修改任何文件）：
//   1) 敏感信息模式（GitHub token / AWS key / 私钥 / 明文 password=）
//   2) 大文件（> 2MB，vendor 例外）
//   3) 许可文件（LICENSE / THIRD-PARTY-NOTICES.md）
//   4) 可疑文件（.env / *.pem / *.key / node_modules 入版本库）
// 输出 Markdown 报告到 dist/AUDIT.md；有 error 时进程退出码 1。
//
// 用法：node tools/audit.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SECRET_PATTERNS = [
  { name: 'GitHub token', re: /ghp_[A-Za-z0-9]{36}/g },
  { name: 'GitHub fine-grained PAT', re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/g },
  { name: '私钥', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: '明文密码赋值', re: /password\s*[:=]\s*['"][A-Za-z0-9_-]{6,}['"]/g },
];

/** 扫描文本中的敏感模式，返回 [{type,count}]。 */
export function scanForSecrets(text) {
  const out = [];
  for (const p of SECRET_PATTERNS) {
    const m = String(text || '').match(p.re);
    if (m && m.length) out.push({ type: p.name, count: m.length });
  }
  return out;
}

/** 审计文件列表（纯函数部分）。返回 {errors, warnings, checks}。 */
export function auditFiles(root, files) {
  const errors = [];
  const warnings = [];
  const checks = [];
  let totalBytes = 0;
  for (const rel of files) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const st = fs.statSync(abs);
    totalBytes += st.size;
    const vendor = rel.includes('/vendor/') || rel.startsWith('dist/');
    if (st.size > 2 * 1024 * 1024 && !vendor) errors.push(`大文件：${rel}（${(st.size / 1024 / 1024).toFixed(1)}MB）`);
    if (/\.(env|pem|key)$/i.test(rel)) warnings.push(`可疑文件：${rel}`);
    if (/(^|\/)node_modules\//.test(rel)) errors.push(`node_modules 被纳入版本库：${rel}`);
    if (st.size < 512 * 1024 && /\.(mjs|js|json|md|html|css|yml|ps1|txt)$/i.test(rel)) {
      const text = fs.readFileSync(abs, 'utf8');
      const hits = scanForSecrets(text);
      for (const h of hits) warnings.push(`敏感模式（${h.type} ×${h.count}）：${rel}`);
    }
  }
  checks.push(`文件数：${files.length}，总体积：${(totalBytes / 1024 / 1024).toFixed(2)}MB`);
  return { errors, warnings, checks };
}

function main() {
  const files = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const result = auditFiles(ROOT, files);
  const hasLicense = files.includes('LICENSE') && /MIT/i.test(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'));
  const hasNotices = files.includes('THIRD-PARTY-NOTICES.md');
  if (!hasLicense) result.errors.push('缺少 MIT LICENSE 文件');
  if (!hasNotices) result.warnings.push('缺少 THIRD-PARTY-NOTICES.md');
  const lines = [
    '# 仓库健康审计报告',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '## 结果',
    '',
    result.errors.length ? `❌ 发现 ${result.errors.length} 个问题` : '✅ 无阻塞问题',
    '',
    '### 错误',
    ...(result.errors.length ? result.errors.map((x) => `- ❌ ${x}`) : ['- 无']),
    '',
    '### 警告',
    ...(result.warnings.length ? result.warnings.map((x) => `- ⚠️ ${x}`) : ['- 无']),
    '',
    '### 检查项',
    ...result.checks.map((x) => `- ${x}`),
    `- LICENSE：${hasLicense ? 'MIT ✅' : '缺失 ❌'}`,
    `- THIRD-PARTY-NOTICES：${hasNotices ? '存在 ✅' : '缺失 ⚠️'}`,
    '',
  ];
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist', 'AUDIT.md'), lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
  process.exit(result.errors.length ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('audit.mjs')) main();
