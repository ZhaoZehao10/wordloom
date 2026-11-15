# 拾径 · Wordloom v1.4.7 发布说明

发布日期：2026-11-15

## 本版新增

- **SHA-256 校验清单**：发布资产附 `SHA256SUMS.txt`，下载后可自行校验完整性
  - Windows：`Get-FileHash .\Wordloom-v1.4.7.apk -Algorithm SHA256`
  - macOS/Linux：`shasum -a 256 Wordloom-v1.4.7.apk`
- **第三方许可声明**：新增 `THIRD-PARTY-NOTICES.md`（three.js / qrcode-generator，均 MIT）
- **真机验收记录模板**：新增 `docs/DEVICE-ACCEPTANCE-TEMPLATE.md`，逐项记录 ✅/⚠️/❌

## 质量指标

| 项目 | 结果 |
|------|------|
| 单元测试 | 771 项断言 |
| 桌面 e2e | 190 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局，堆增长与趋势斜率双门禁 |
| CI | Unit / E2E（含离线版与视觉回归）/ Pages 全部通过 |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.7.apk`（versionCode 16）
- 离线单文件：`Wordloom-offline-v1.4.7.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.6
