// 随机游走 VR 一键测试 — node tools/test-all.mjs [--fast] [--no-server]
//
// 串行运行全部套件，自动按需拉起本地 HTTPS 服务器（8543，结束后关闭）。
//   --fast       跳过性能实测（rw-perf）
//   --no-server  假定 8543 已在运行，不自动拉起
import { spawn, spawnSync } from 'node:child_process';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const FAST = process.argv.includes('--fast');
const NO_SERVER = process.argv.includes('--no-server');

const SUITES = [
  { name: '离线单文件打包', file: 'tools/make-offline.mjs' },
  { name: '桌面端到端', file: 'test/rw-e2e.mjs', server: true },
  { name: '离线版端到端', file: 'test/rw-offline-e2e.mjs' },
  { name: '浏览器性能', file: 'test/rw-perf.mjs', slow: true, server: true },
].filter((s) => !(FAST && s.slow));

function serverUp() {
  return new Promise((resolve) => {
    const req = https.get(
      { host: '127.0.0.1', port: 8543, path: '/rw/index.html', rejectUnauthorized: false, timeout: 1200 },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitServer(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await serverUp()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const needServer = SUITES.some((s) => s.server);
let serverProc = null;

if (needServer && !NO_SERVER) {
  if (await serverUp()) {
    console.log('· 检测到 8543 已在运行，复用现有服务器');
  } else {
    console.log('· 启动本地服务器…');
    serverProc = spawn(NODE, [path.join(ROOT, 'server.mjs')], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitServer())) {
      console.error('✗ 服务器启动失败（8543 未就绪）');
      if (serverProc) serverProc.kill();
      process.exit(1);
    }
    console.log('· 服务器已就绪');
  }
}

const results = [];
const t0 = Date.now();

for (const suite of SUITES) {
  const start = Date.now();
  process.stdout.write(`\n=== ${suite.name} (${suite.file}) ===\n`);
  const r = spawnSync(NODE, [path.join(ROOT, suite.file)], {
    cwd: ROOT, encoding: 'utf8', timeout: 600000,
  });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const lines = out.split('\n').filter((l) => l !== '');
  const tail = r.status === 0 ? lines.slice(-3) : lines.slice(-20);
  for (const l of tail) console.log('  ' + l);
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  const ok = r.status === 0;
  results.push({ name: suite.name, ok, secs });
  console.log(`  → ${ok ? 'PASS' : 'FAIL'} (${secs}s)`);
}

if (serverProc) serverProc.kill();

const failed = results.filter((r) => !r.ok);
const total = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\n================ 汇总 ================');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(14, ' ')} ${r.secs}s`);
console.log('--------------------------------------');
console.log(`${results.length - failed.length}/${results.length} 套件通过，总耗时 ${total}s`);
process.exit(failed.length ? 1 : 0);
