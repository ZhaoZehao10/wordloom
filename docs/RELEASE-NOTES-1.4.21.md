# 拾径 · Wordloom v1.4.21 发布说明

发布日期：2026-11-16

## 本版新增（工程）

- **跨浏览器矩阵冒烟** `test/rw-browser-matrix.mjs`（`npm run test:matrix`）：
  - Chrome 与 Edge 各跑一遍最小链路：页面加载 → `__rw` 钩子 → 开局 → 图节点/渲染器 → 无控制台异常
  - 缺失的浏览器明确「跳过」而非失败（CI 无 Edge 也能通过）
  - 本机实测：**Chrome ✓ / Edge ✓**
- 纳入本地全量：套件数 **9 → 10**

## 质量指标

| 项目 | 结果 |
|------|------|
| 本地套件 | 10/10 |
| 单元测试 | 834 项断言 |
| 桌面 e2e | 205 项 |
| 离线版 e2e | 6 项 |
| 跨浏览器矩阵 | Chrome / Edge 双通过 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局 |
| CI | Unit / E2E / Audit / Pages |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.21.apk`（versionCode 30）
- 离线单文件：`Wordloom-offline-v1.4.21.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.20
