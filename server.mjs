// 拾径 Wordloom — HTTPS 静态服务器（零依赖，Node 内置模块实现）
//
// 为什么必须 HTTPS：WebXR 需要 secure context。Pico 浏览器通过局域网 IP 访问时，
// 只有 https:// 才会暴露 navigator.xr；http:// 会直接没有"进入 VR"按钮。
//
// 端口默认 8543（HTTPS）/ 8181（HTTP 引导页），与拼图仓库（8443/8081）错开，
// 两个游戏可以同时在本机运行互不干扰。
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, 'public');
const PORT = parseInt(process.env.PORT || '8543', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '8181', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pem': 'application/x-pem-file',
};

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

function serveFile(res, abs) {
  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache', // 迭代期禁缓存，改代码刷新即生效
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

function safeJoin(urlPath) {
  const rel = decodeURIComponent(urlPath.split('?')[0]);
  const abs = path.normalize(path.join(PUB, rel === '/' ? '/rw/index.html' : rel));
  if (!abs.startsWith(PUB)) return null; // 防目录穿越
  return abs;
}

// 明文 HTTP 端口：引导页（告诉头盔该走 https）+ CA 证书下载
const httpServer = http.createServer((req, res) => {
  const ip = lanIp();
  if (req.url.split('?')[0] === '/ca.crt') {
    res.writeHead(200, {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="wordloom-ca.crt"',
    });
    res.end(fs.readFileSync(path.join(__dirname, 'cert', 'ca.crt')));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>拾径 Wordloom — 请使用 HTTPS 访问</title></head>
<body style="font-family:sans-serif;background:#0b1020;color:#dfe7ff;padding:24px;line-height:1.8">
<h2>🎲 拾径 Wordloom</h2>
<p>WebXR 需要 HTTPS。请在浏览器地址栏使用下面的 <b>https://</b> 地址：</p>
<p style="font-size:1.4em"><a href="https://${ip}:${PORT}/" style="color:#6cf">https://${ip}:${PORT}/</a></p>
<p>推荐：先 <a href="http://${ip}:${HTTP_PORT}/ca.crt" style="color:#6dffa8">下载并安装 CA 证书</a>
（设置→安全→从存储安装），之后 HTTPS <b>零警告</b>。</p>
<p>不安装也可以：打开 https 地址后点「高级」→「仍要继续」。</p>
</body></html>`);
});

const httpsServer = https.createServer(
  {
    key: fs.readFileSync(path.join(__dirname, 'cert', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'cert', 'cert.pem')),
  },
  (req, res) => {
    if ((req.url || '').split('?')[0] === '/ca.crt') {
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename="wordloom-ca.crt"',
      });
      res.end(fs.readFileSync(path.join(__dirname, 'cert', 'ca.crt')));
      return;
    }
    const abs = safeJoin(req.url || '/');
    if (!abs) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    serveFile(res, abs);
  }
);

httpsServer.on('clientError', (err, socket) => {
  // 老版本 Pico 浏览器有时会先发明文探测，别让这类错误刷崩溃进程
  if (err.code === 'ECONNRESET' || err.code === 'ERR_SSL_WRONG_VERSION_NUMBER') return;
});

httpsServer.listen(PORT, () => {
  const ip = lanIp();
  console.log('==============================================');
  console.log(' 拾径 Wordloom 已启动');
  console.log(` 头显浏览器访问:  https://${ip}:${PORT}/`);
  console.log(` CA 证书下载:     http://${ip}:${HTTP_PORT}/ca.crt  → 安装后零警告`);
  console.log(` 本机调试访问:    https://localhost:${PORT}/`);
  console.log(` HTTP 引导页:     http://${ip}:${HTTP_PORT}/`);
  console.log('==============================================');
});

httpServer.listen(HTTP_PORT);
