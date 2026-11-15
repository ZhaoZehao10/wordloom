// 拾径 · Wordloom — 一键发布准备
//
// 做发布前的确定性检查与构建，避免手工步骤漏项：
//   1) 版本三方一致：package.json / public/rw/js/data.mjs APP_VERSION / AndroidManifest versionName
//   2) 工作区干净（可 --allow-dirty 跳过）
//   3) 单元测试通过（可 --skip-tests 跳过）
//   4) 构建离线单文件 + APK
//   5) 生成 SHA256SUMS.txt
//   6) 打印后续推送/发布命令（--tag 可直接创建本地标签）
//
// 用法：node tools/release.mjs [--skip-tests] [--allow-dirty] [--tag]
// 注意：脚本不执行任何网络操作；推送与创建 GitHub Release 需人工确认后执行。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 校验三方版本是否一致（纯函数，便于单测）。 */
export function validateVersions({ pkgVersion, appVersion, manifestVersionName, manifestVersionCode }) {
  const errors = [];
  if (!/^\d+\.\d+\.\d+$/.test(String(pkgVersion || ''))) errors.push(`package.json 版本非法：${pkgVersion}`);
  if (appVersion !== pkgVersion) errors.push(`APP_VERSION(${appVersion}) != package.json(${pkgVersion})`);
  if (manifestVersionName !== pkgVersion) errors.push(`AndroidManifest versionName(${manifestVersionName}) != package.json(${pkgVersion})`);
  if (!Number.isInteger(Number(manifestVersionCode)) || Number(manifestVersionCode) <= 0) errors.push(`versionCode 非法：${manifestVersionCode}`);
  return { ok: errors.length === 0, errors };
}

function readVersions() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const dataSrc = fs.readFileSync(path.join(ROOT, 'public', 'rw', 'js', 'data.mjs'), 'utf8');
  const appVersion = (dataSrc.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
  const manifest = fs.readFileSync(path.join(ROOT, 'apk', 'AndroidManifest.xml'), 'utf8');
  const name = (manifest.match(/android:versionName="([^"]+)"/) || [])[1];
  const code = (manifest.match(/android:versionCode="(\d+)"/) || [])[1];
  return { pkgVersion: pkg.version, appVersion, manifestVersionName: name, manifestVersionCode: code };
}

const args = new Set(process.argv.slice(2));
const run = (cmd, cmdArgs, opts = {}) => {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', ...opts });
};

if (process.argv[1] && process.argv[1].endsWith('release.mjs')) {
  const v = readVersions();
  const check = validateVersions(v);
  console.log('版本检查:', v);
  if (!check.ok) {
    console.error('❌ 版本不一致:\n - ' + check.errors.join('\n - '));
    process.exit(1);
  }
  console.log('✅ 版本一致:', v.pkgVersion);

  if (!args.has('--allow-dirty')) {
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (dirty) {
      console.error('❌ 工作区不干净，请先提交或使用 --allow-dirty\n' + dirty);
      process.exit(1);
    }
    console.log('✅ 工作区干净');
  }

  if (!args.has('--skip-tests')) {
    run('node', [path.join('test', 'rw-unit.mjs')]);
  }
  run('node', [path.join('tools', 'make-offline.mjs')]);
  if (process.platform === 'win32') {
    run('powershell', ['-ExecutionPolicy', 'Bypass', '-File', path.join('tools', 'build-apk.ps1')]);
  } else {
    console.log('⚠️ 非 Windows 环境跳过 APK 构建');
  }
  run('node', [path.join('tools', 'release-checksums.mjs')]);

  const tag = `v${v.pkgVersion}`;
  if (args.has('--tag')) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { cwd: ROOT, stdio: 'ignore' });
      console.log(`ℹ️ 标签 ${tag} 已存在，跳过创建`);
    } catch {
      execFileSync('git', ['tag', '-a', tag, '-m', `拾径 Wordloom ${tag}`], { cwd: ROOT, stdio: 'inherit' });
      console.log(`✅ 已创建标签 ${tag}`);
    }
  }
  console.log(`\n下一步：\n  git push origin main\n  git push origin ${tag}\n  或运行发布脚本创建 GitHub Release（资产：dist/Wordloom-${tag}.apk 等）`);
}
