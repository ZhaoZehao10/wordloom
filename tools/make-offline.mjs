// 把拾径 Wordloom 打包成单文件离线 HTML（file:// 直接打开）
// - ESM 多模块 → 手工拼接：按依赖序内联 data/graph/audio/main，剥掉 import/export
// - three.module.min.js 内联为普通 <script>（全局 THREE）+ 一个命名空间桥接
// 用法: node tools\make-offline.mjs  →  输出 dist/拾径-离线版.html
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..');
const PUB = path.join(ROOT, 'public');
const stripBom = (s) => s.replace(/^\uFEFF/, '');

const read = (...p) => stripBom(fs.readFileSync(path.join(...p), 'utf8'));

// ---------- 1) three.js → 全局 THREE ----------
// min 包是 `export{...}` 结尾的 ESM；包一层：定义全局 X 捕获导出，再映射到 THREE
const threeSrc = read(PUB, 'vendor', 'three.module.min.js');
// 提取 export{...} 里的名字，生成 `THREE.Name = Name`
const exportMatch = threeSrc.match(/export\{([^}]+)\};?\s*$/);
if (!exportMatch) { console.error('three.js 导出表解析失败'); process.exit(1); }
const names = exportMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
  .map((s) => (s.includes(' as ') ? s.split(/\s+as\s+/) : [s, s]));
const glue = names.map(([local, pub]) => `THREE.${pub}=${local};`).join('');

const threeScript = `// three.js r160 (C) 2010-2023 Three.js Authors · MIT · 单文件离线内联版
var THREE = {};
(function(){
const exportNames = [];
${threeSrc.replace(/export\{[^}]+\};?\s*$/, `
${glue}
`)}
})();
`;

// ---------- 2) 游戏模块 → 依序拼接（剥 import/export 语句） ----------
function stripModule(src) {
  return src
    .replace(/^import\s+[^;]+?;\s*$/gm, '')
    .replace(/^import\s+[^;]+?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(?=(const|let|var|function|class)\s)/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, '');
}

// VRButton.js：非 min 的 ESM，剥掉 export 后类定义留在全局作用域
const vrButtonSrc = stripModule(read(PUB, 'vendor', 'VRButton.js'));

const gameSrc = [
  ['data', 'rw/js/data.mjs'],
  ['i18n', 'rw/js/i18n.mjs'],         // 语言表（被 menu/main 引用）
  ['rules', 'rw/js/rules.mjs'],       // 依赖 data
  ['geometry', 'rw/js/geometry.mjs'], // 纯数组数学，无依赖
  ['poster', 'rw/js/poster.mjs'],     // 海报绘制，依赖 DOM canvas
  ['menu', 'rw/js/menu.mjs'],         // VR 菜单布局/命中，纯函数
  ['stats', 'rw/js/stats.mjs'],       // 本地战绩统计，纯函数
  ['spatial', 'rw/js/spatial.mjs'],   // 空间音效 PCM 合成，纯函数
  ['replay', 'rw/js/replay.mjs'],     // 路径回放取样，纯函数
  ['daily', 'rw/js/daily.mjs'],       // 每日挑战日期/种子，纯函数
  ['save', 'rw/js/save.mjs'],         // 存档导入导出，纯函数
  ['tutorial', 'rw/js/tutorial.mjs'], // 新手引导状态，纯函数
  ['graph', 'rw/js/graph.mjs'],
  ['audio', 'rw/js/audio.mjs'],       // 依赖 data
  ['main', 'rw/js/main.mjs'],         // 依赖以上全部
].map(([tag, rel]) => `// ===== ${rel} =====\n${stripModule(read(PUB, ...rel.split('/')))}`).join('\n');

// graph.mjs / main.mjs 里 `import * as THREE` 已剥掉；它们引用的 THREE 来自上面全局。
// audio.mjs import data.mjs 的 TIMBRES 也在同一作用域（var/function 提升 + const 顺序正确）。

// ---------- 3) 页面 HTML：内联 CSS + JS ----------
let html = read(PUB, 'rw', 'index.html');
// CSS
const css = read(PUB, 'rw', 'rw.css');
html = html.replace('<link rel="stylesheet" href="rw.css">', `<style>\n${css}\n</style>`);
// 模块脚本 → 普通脚本（three 全局 + VRButton + 游戏代码依序）
html = html.replace('<script type="module" src="js/main.mjs"></script>',
  `<script>\n${threeScript}\n</script>\n<script>\n${vrButtonSrc}\n</script>\n<script>\n${gameSrc}\n</script>`);
// 离线提示与 VR 引导差异说明
html = html.replace('</body>', `<div style="position:fixed;bottom:8px;left:0;right:0;text-align:center;z-index:9;opacity:.6;font-size:12px">单文件离线版 · 若无 ENTER VR 按钮请改用 APK 版（README）</div></body>`);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', '拾径-离线版.html');
fs.writeFileSync(out, html, 'utf8');
console.log('写出:', out, `${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB`);
