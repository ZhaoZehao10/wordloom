// 拾径 · Wordloom — 一键发布准备 / 发布
//
// 做发布前的确定性检查与构建，避免手工步骤漏项：
//   1) 版本三方一致：package.json / public/rw/js/data.mjs APP_VERSION / AndroidManifest versionName
//   2) 工作区干净（可 --allow-dirty 跳过）
//   3) 单元测试通过（可 --skip-tests 跳过）
//   4) 构建离线单文件 + APK
//   5) 生成 SHA256SUMS.txt
//   6) --tag 创建本地标签
//   7) --publish 推送 main/tag 并创建 GitHub Release、上传资产（需要本机 git 凭据）
//
// 用法：node tools/release.mjs [--skip-tests] [--allow-dirty] [--tag] [--publish]
// 注意：--publish 会执行网络操作（git push + api.github.com），请确认版本与提交后再用。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publishBranchViaApi, publishTagViaApi } from './git-publish.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 发布资产的规范名称/类型（纯函数）。 */
export function releaseAssetsFor(tag) {
  return [
    { name: `Wordloom-${tag}.apk`, kind: 'apk', type: 'application/vnd.android.package-archive' },
    { name: `Wordloom-offline-${tag}.html`, kind: 'offline', type: 'text/html' },
    { name: 'SHA256SUMS.txt', kind: 'checksums', type: 'text/plain' },
  ];
}

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
  if (args.has('--tag') || args.has('--publish')) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { cwd: ROOT, stdio: 'ignore' });
      console.log(`ℹ️ 标签 ${tag} 已存在，跳过创建`);
    } catch {
      execFileSync('git', ['tag', '-a', tag, '-m', `拾径 Wordloom ${tag}`], { cwd: ROOT, stdio: 'inherit' });
      console.log(`✅ 已创建标签 ${tag}`);
    }
  }
  console.log(`\n下一步：\n  git push origin main\n  git push origin ${tag}\n  或运行发布脚本创建 GitHub Release（资产：dist/Wordloom-${tag}.apk 等）`);

  if (args.has('--publish')) {
    const token = githubToken();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const okMain = tryRun('git', ['push', 'origin', 'main']);
    if (!okMain) {
      console.log('⚠️ git push 分支失败，改用 GitHub API 推送…');
      await publishBranchViaApi({ owner: 'zhaozehao10', name: 'wordloom', token, root: ROOT, head });
    }
    const okTag = tryRun('git', ['push', 'origin', tag]);
    if (!okTag) {
      console.log('⚠️ git push 标签失败，改用 GitHub API 推送标签…');
      await publishTagViaApi({ owner: 'zhaozehao10', name: 'wordloom', token, root: ROOT, tag });
    }
    await publishRelease(tag, v.pkgVersion, token);
  }
}

function tryRun(cmd, cmdArgs) {
  try { execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit' }); return true; }
  catch { return false; }
}

function githubToken() {
  const cred = execFileSync('git', ['-C', ROOT, 'credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
  });
  const line = cred.split('\n').find((l) => l.startsWith('password='));
  if (!line) throw new Error('未找到 GitHub 凭据');
  return line.slice('password='.length);
}

async function githubApi(token, method, url, payload) {
  const r = await fetch('https://api.github.com' + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'wordloom-release' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 300)}`);
  return json;
}

async function publishRelease(tag, version, token) {
  const owner = 'zhaozehao10';
  const name = 'wordloom';
  const notesPath = path.join(ROOT, 'docs', `RELEASE-NOTES-${version}.md`);
  if (!fs.existsSync(notesPath)) throw new Error(`缺少发布说明：${notesPath}`);
  const body = fs.readFileSync(notesPath, 'utf8');
  let rel;
  try { rel = await githubApi(token, 'GET', `/repos/${owner}/${name}/releases/tags/${tag}`); }
  catch {
    rel = await githubApi(token, 'POST', `/repos/${owner}/${name}/releases`, {
      tag_name: tag, name: `拾径 · Wordloom ${tag}`, body, draft: false, prerelease: false,
    });
    console.log('✅ 已创建 Release', rel.id);
  }
  const existing = new Set((rel.assets || []).map((a) => a.name));
  const files = {
    apk: path.join(ROOT, 'dist', '拾径Wordloom.apk'),
    offline: path.join(ROOT, 'dist', '拾径-离线版.html'),
    checksums: path.join(ROOT, 'dist', 'SHA256SUMS.txt'),
  };
  for (const asset of releaseAssetsFor(tag)) {
    if (existing.has(asset.name)) { console.log('ℹ️ 资产已存在:', asset.name); continue; }
    const file = files[asset.kind];
    if (!fs.existsSync(file)) { console.warn('⚠️ 缺少资产文件:', file); continue; }
    const buf = fs.readFileSync(file);
    const r = await fetch(`https://uploads.github.com/repos/${owner}/${name}/releases/${rel.id}/assets?name=${asset.name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': asset.type, 'User-Agent': 'wordloom-release', 'Content-Length': String(buf.length) },
      body: buf,
    });
    console.log(r.ok ? '✅ 上传' : '❌ 上传失败', asset.name, r.status);
  }
  const after = await githubApi(token, 'GET', `/repos/${owner}/${name}/releases/tags/${tag}`);
  console.log('Release:', after.html_url);
}
