# 拾径 · Wordloom v1.4.14 发布说明

发布日期：2026-11-16

## 本版新增

- **仓库健康审计工具** `tools/audit.mjs`（`npm run audit`）：
  - 敏感模式扫描：GitHub token / AWS key / 私钥 / 明文密码赋值
  - 大文件检查（>2MB，vendor 除外）、可疑文件（.env/.pem/.key/node_modules）
  - LICENSE（MIT）与 THIRD-PARTY-NOTICES 检查
  - 输出 `dist/AUDIT.md`，有阻塞问题退出码 1
- 当前审计结果：**96 个文件 / 3.03MB，无错误、无警告**

## 质量指标

| 项目 | 结果 |
|------|------|
| 单元测试 | 801 项断言 |
| 桌面 e2e | 195 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局，堆增长与趋势斜率双门禁 |
| CI | Unit / E2E（含离线版与视觉回归）/ Pages 全部通过 |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.14.apk`（versionCode 23）
- 离线单文件：`Wordloom-offline-v1.4.14.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.13
