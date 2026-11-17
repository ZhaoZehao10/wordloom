# 拾径 · Wordloom v1.4.22 发布说明

发布日期：2026-11-17

## 本版新增（工程）

- **性能趋势看板增强**：
  - 每次性能记录附带**版本号**（`version` 字段）
  - 报告新增**四条趋势线**：帧率 / drawcall / 开局耗时 / 重开耗时
  - 新增**按版本汇总**表：次数、平均 fps、最佳开局耗时
  - 明细表增加版本列
- 单测覆盖版本汇总、四趋势与版本列

## 质量指标

| 项目 | 结果 |
|------|------|
| 本地套件 | 10/10 |
| 单元测试 | 837 项断言 |
| 桌面 e2e | 205 项 |
| 离线版 e2e | 6 项 |
| 跨浏览器矩阵 | Chrome / Edge 双通过 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局 |
| CI | Unit / E2E / Audit / Pages |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.22.apk`（versionCode 31）
- 离线单文件：`Wordloom-offline-v1.4.22.html`
- 本地性能看板：`dist/perf-report.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.21
