// 证书生成工具（mkcert 模式）— node make-cert.mjs
//
// 生成两级结构：本地 CA（安装到设备信任区后零警告）+ 由 CA 签发的服务器证书。
//   cert/ca.crt    ← 安装到 Pico 头盔/PC 的受信任根（一次性）
//   cert/key.pem   ← 服务器私钥
//   cert/cert.pem  ← 服务器证书（CA 签发，SAN 覆盖全部本机 IPv4）
//
// 何时运行：首次部署、或服务器启动后打印的 IP 与证书不一致（换了 Wi-Fi）。
// 自检强制项：CA 链可验证、Subject 非空、SAN 覆盖全部本机 IP。
// （历史教训：openssl -subj 用双斜杠 '//CN=...' 在 Windows 下生成空 Subject
//   证书 → Chromium 判 ERR_CERT_INVALID 且不提供绕过入口。）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.join(__dirname, 'cert');
const CA_KEY = path.join(CERT_DIR, 'ca.key');
const CA_CERT = path.join(CERT_DIR, 'ca.crt');
const KEY = path.join(CERT_DIR, 'key.pem');
const CERT = path.join(CERT_DIR, 'cert.pem');
const CSR = path.join(CERT_DIR, 'server.csr');
const EXT = path.join(CERT_DIR, 'server.ext');
const SRL = path.join(CERT_DIR, 'ca.srl');

function findOpenssl() {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
  ];
  for (const c of candidates) {
    try { execFileSync(c, ['version'], { stdio: 'ignore' }); return c; } catch { /* next */ }
  }
  return null;
}

function lanIps() {
  const ips = new Set(['127.0.0.1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.add(ni.address);
    }
  }
  return [...ips];
}

const openssl = findOpenssl();
if (!openssl) {
  console.error('找不到 openssl。请安装 Git for Windows（自带 openssl）或将其加入 PATH。');
  process.exit(1);
}
const run = (args) => execFileSync(openssl, args, { stdio: ['ignore', 'ignore', 'inherit'] });

const ips = lanIps();
fs.mkdirSync(CERT_DIR, { recursive: true });

// 1) 本地 CA（10 年）—— 证书只用于局域网内网 HTTPs，Subject 保持中性、不含个人信息
run(['genrsa', '-out', CA_KEY, '2048']);
run(['req', '-x509', '-new', '-key', CA_KEY,
  '-subj', '/CN=Wordloom Local CA/O=Wordloom',
  '-days', '3650', '-out', CA_CERT,
  '-addext', 'basicConstraints=critical,CA:TRUE',
  '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);

// 2) 服务器私钥 + CSR
run(['req', '-new', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', KEY, '-subj', '/CN=wordloom.local/O=Wordloom', '-out', CSR]);

// 3) CA 签发服务器证书（SAN 覆盖全部本机 IP）
const san = ['DNS:localhost', ...ips.map((ip) => `IP:${ip}`)].join(',');
fs.writeFileSync(EXT, [
  'basicConstraints=CA:FALSE',
  'keyUsage=digitalSignature,keyEncipherment',
  'extendedKeyUsage=serverAuth',
  `subjectAltName=${san}`,
  'authorityKeyIdentifier=keyid,issuer',
].join('\n'));
run(['x509', '-req', '-in', CSR,
  '-CA', CA_CERT, '-CAkey', CA_KEY, '-CAcreateserial',
  '-days', '3650', '-extfile', EXT, '-out', CERT]);

// 4) 自检：链验证 + Subject 非空 + SAN 覆盖
const chain = execFileSync(openssl, ['verify', '-CAfile', CA_CERT, CERT], { encoding: 'utf8' });
if (!/OK/.test(chain)) {
  console.error('证书链验证失败:\n' + chain);
  process.exit(1);
}
const text = execFileSync(openssl, ['x509', '-in', CERT, '-noout', '-subject', '-ext', 'subjectAltName'], { encoding: 'utf8' });
const subjOk = /CN\s*=\s*\S/.test(text);
const missing = ips.filter((ip) => !text.includes(ip));
if (!subjOk || missing.length) {
  console.error(`证书自检失败！subject 非空=${subjOk}，缺失 IP: ${missing.join(',')}`);
  console.error(text);
  process.exit(1);
}

for (const tmp of [CSR, EXT, SRL]) if (fs.existsSync(tmp)) fs.unlinkSync(tmp);

console.log('==============================================');
console.log(' 证书已生成并通过自检（CA 链验证 OK）');
console.log(` 服务器证书 SAN 覆盖: ${ips.join(', ')}`);
console.log(` CA 证书（安装到头盔后零警告）: ${CA_CERT}`);
console.log(' 服务器会把它挂在 /ca.crt 路径供头盔直接下载');
console.log(' 换 Wi-Fi / IP 变化后重跑本脚本并重启 server.mjs');
console.log('==============================================');
