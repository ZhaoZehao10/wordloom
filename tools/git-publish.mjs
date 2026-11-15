// 拾径 · Wordloom — Git Data API 发布回退
//
// 当 github.com:443 被阻断导致 git push 失败时，用 GitHub Git Data API
// 逐个提交重建 tree/commit 并更新 ref（提交 SHA 与本地完全一致）。
// 仅由 tools/release.mjs --publish 在 git push 失败时调用。

import { execFileSync } from 'node:child_process';

/** 解析 git 身份行（author/committer）。 */
export function parseIdent(line, prefix) {
  const m = line.slice(prefix.length).match(/^(.*) <(.*)> (\d+) ([+-]\d{4})$/);
  if (!m) throw new Error(`无法解析 ${prefix} 行：${line}`);
  const [, name, email, ts, off] = m;
  const sign = off[0] === '-' ? -1 : 1;
  const offSec = sign * (parseInt(off.slice(1, 3), 10) * 3600 + parseInt(off.slice(3, 5), 10) * 60);
  const d = new Date((Number(ts) + offSec) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    name, email,
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${off.slice(0, 3)}:${off.slice(3, 5)}`,
  };
}

/** 读取一个提交对象（用于 API 重建）。 */
export function readCommit(root, sha) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const raw = execFileSync('git', ['-C', root, 'cat-file', '-p', sha], { encoding: 'utf8' });
  const lines = raw.split('\n');
  const parentLine = lines.find((l) => l.startsWith('parent '));
  const message = raw.slice(raw.indexOf('\n\n') + 2);
  return {
    parent: parentLine ? parentLine.slice(7).trim() : null,
    message,
    author: parseIdent(lines.find((l) => l.startsWith('author ')), 'author '),
    committer: parseIdent(lines.find((l) => l.startsWith('committer ')), 'committer '),
    files: git('ls-tree', '-r', sha).split('\n').filter(Boolean).map((row) => {
      const m = row.match(/^(\d{6}) (\w+) ([0-9a-f]+)\t(.+)$/);
      return m ? { mode: m[1], type: m[2], blob: m[3], path: m[4] } : null;
    }).filter(Boolean),
  };
}

/** 通过 API 把本地 head 推送到远端 main（远端须为 head 的祖先）。 */
export async function publishBranchViaApi({ owner, name, token, root, head, api }) {
  const call = api || (async (method, url, payload) => {
    const r = await fetch('https://api.github.com' + url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'wordloom-release' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
    if (!r.ok) throw new Error(`${method} ${url} ${r.status} ${t.slice(0, 300)}`);
    return j;
  });
  const ref = await call('GET', `/repos/${owner}/${name}/git/ref/heads/main`);
  const base = ref.object.sha;
  const list = execFileSync('git', ['-C', root, 'rev-list', '--reverse', `${base}..${head}`], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  if (!list.length) { console.log('ℹ️ 远端已是最新，无需 API 推送'); return base; }
  let parent = base;
  for (const sha of list) {
    const c = readCommit(root, sha);
    const tree = [];
    for (const f of c.files) {
      const buf = execFileSync('git', ['-C', root, 'cat-file', 'blob', f.blob], { maxBuffer: 64 * 1024 * 1024 });
      const blob = await call('POST', `/repos/${owner}/${name}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
      tree.push({ path: f.path, mode: f.mode, type: f.type, sha: blob.sha });
    }
    const treeObj = await call('POST', `/repos/${owner}/${name}/git/trees`, { tree });
    const commit = await call('POST', `/repos/${owner}/${name}/git/commits`, {
      message: c.message, tree: treeObj.sha, parents: [parent], author: c.author, committer: c.committer,
    });
    console.log('⬆️ API 推送提交', sha.slice(0, 7), '->', commit.sha.slice(0, 7), commit.sha === sha ? '(SHA 一致)' : '');
    parent = commit.sha;
  }
  await call('PATCH', `/repos/${owner}/${name}/git/refs/heads/main`, { sha: parent, force: true });
  return parent;
}

/** 通过 API 推送本地标签。 */
export async function publishTagViaApi({ owner, name, token, root, tag, api }) {
  const call = api || (async (method, url, payload) => {
    const r = await fetch('https://api.github.com' + url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'wordloom-release' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
    if (!r.ok) throw new Error(`${method} ${url} ${r.status} ${t.slice(0, 300)}`);
    return j;
  });
  const raw = execFileSync('git', ['-C', root, 'cat-file', '-p', `refs/tags/${tag}`], { encoding: 'utf8' });
  const lines = raw.split('\n');
  const object = lines.find((l) => l.startsWith('object ')).slice(7).trim();
  const tagName = lines.find((l) => l.startsWith('tag ')).slice(4).trim();
  const message = raw.slice(raw.indexOf('\n\n') + 2).replace(/\n+$/, '');
  const tagger = parseIdent(lines.find((l) => l.startsWith('tagger ')), 'tagger ');
  const created = await call('POST', `/repos/${owner}/${name}/git/tags`, { tag: tagName, message, object, type: 'commit', tagger });
  await call('POST', `/repos/${owner}/${name}/git/refs`, { ref: `refs/tags/${tag}`, sha: created.sha });
  console.log('🏷️ API 推送标签', tag, '->', created.sha.slice(0, 7));
  return created.sha;
}
