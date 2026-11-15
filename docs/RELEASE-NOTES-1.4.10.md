# 拾径 · Wordloom v1.4.10 发布说明

发布日期：2026-11-15

## 本版新增

- **一键发布（--publish）**：`npm run release:publish` 在原有 release:prepare 基础上自动：
  - 推送 main 与标签
  - 创建 GitHub Release（正文取自 `docs/RELEASE-NOTES-<版本>.md`）
  - 上传 APK / 离线单文件 / SHA256SUMS 三个资产
- 资产名由纯函数 `releaseAssetsFor` 统一生成，单测覆盖命名规范

## 质量指标

| 项目 | 结果 |
|------|------|
| 单元测试 | 786 项断言 |
| 桌面 e2e | 193 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局，堆增长与趋势斜率双门禁 |
| CI | Unit / E2E（含离线版与视觉回归）/ Pages 全部通过 |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.10.apk`（versionCode 19）
- 离线单文件：`Wordloom-offline-v1.4.10.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.9
