# 拾径 · Wordloom v1.4.15 发布说明

发布日期：2026-11-16

## 本版新增

- **仓库审计纳入本地全量**：`tools/test-all.mjs` 增加「仓库审计」套件，本地 8 套件全跑
- **审计 CI 工作流** `.github/workflows/audit.yml`：每次 push / PR 自动执行 `npm run audit`
  - 上传 `AUDIT.md` 报告 artifact（即使失败也保留）
- 当前审计：无错误、无警告

## 质量指标

| 项目 | 结果 |
|------|------|
| 本地套件 | 8/8（新增仓库审计） |
| 单元测试 | 801 项断言 |
| 桌面 e2e | 195 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局，堆增长与趋势斜率双门禁 |
| CI | Unit / E2E / Audit / Pages 全部通过 |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.15.apk`（versionCode 24）
- 离线单文件：`Wordloom-offline-v1.4.15.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.14
