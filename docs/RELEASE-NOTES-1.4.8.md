# 拾径 · Wordloom v1.4.8 发布说明

发布日期：2026-11-15

## 本版新增

- **一键发布准备脚本** `tools/release.mjs` / `npm run release:prepare`：
  - 三方版本一致性校验（package.json / APP_VERSION / AndroidManifest）
  - 工作区干净检查（`--allow-dirty` 可跳过）
  - 单元测试 → 离线构建 → APK 构建 → SHA256 清单
  - `--tag` 自动创建本地标签
- 单测覆盖版本校验的各类不一致场景

## 质量指标

| 项目 | 结果 |
|------|------|
| 单元测试 | 776 项断言 |
| 桌面 e2e | 190 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局，堆增长与趋势斜率双门禁 |
| CI | Unit / E2E（含离线版与视觉回归）/ Pages 全部通过 |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.8.apk`（versionCode 17）
- 离线单文件：`Wordloom-offline-v1.4.8.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.7
