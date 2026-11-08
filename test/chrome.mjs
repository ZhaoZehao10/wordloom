// 统一解析本机 Chromium 内核浏览器路径（跨平台，避免把个人机器路径写进仓库）
//
// 优先级：环境变量 CHROME_PATH > 常见安装位置 > PATH 中的 google-chrome/chromium
import fs from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function resolveChrome() {
  for (const p of CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* 忽略不可访问路径 */ }
  }
  throw new Error(
    '找不到可用的 Chromium 内核浏览器。请设置环境变量 CHROME_PATH 指向 chrome/msedge 可执行文件。'
  );
}

/** 每个测试用例用独立的临时 profile 目录，避免互相污染 localStorage。 */
export function tempProfile(prefix) {
  return `${process.env.TEMP || process.env.TMPDIR || '/tmp'}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
