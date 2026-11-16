# 拾径 · Wordloom v1.4.20 发布说明

发布日期：2026-11-16

## 本版新增（工程）

- **依赖版本与许可审计** `tools/deps-audit.mjs`（`npm run audit:deps`）：
  - three.js REVISION = 160
  - qrcode-generator = 2.0.4（从 LICENSE 文件核对）
  - package.json license 必须 MIT；THIRD-PARTY-NOTICES 必须覆盖每个依赖
  - 输出 `dist/DEPS-AUDIT.md`，错误时退出码 1
- **依赖审计纳入本地全量**：套件数从 8 → **9**
- 单测覆盖版本解析、版本不一致、文件缺失、许可缺失、非 MIT

## 质量指标

| 项目 | 结果 |
|------|------|
| 本地套件 | 9/9 |
| 单元测试 | 834 项断言 |
| 桌面 e2e | 205 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局 |
| CI | Unit / E2E / Audit / Pages |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.20.apk`（versionCode 29）
- 离线单文件：`Wordloom-offline-v1.4.20.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.19
