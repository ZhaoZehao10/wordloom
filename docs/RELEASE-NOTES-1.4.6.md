# 拾径 · Wordloom v1.4.6 发布说明

发布日期：2026-11-15

## 本版新增

- **关于面板**：版本号、MIT 许可、第三方组件（three.js r160 / qrcode-generator 2.0.4）、本地存储占用、在线地址与作者
- **全局面板 Esc 关闭**：成就 / 统计 / 关于 / 月视图 / 词集面板统一支持 Esc
- **版本一致性测试**：`APP_VERSION` 与 `package.json` 强制一致，防止发版遗漏

## 质量指标

| 项目 | 结果 |
|------|------|
| 单元测试 | 768 项断言 |
| 桌面 e2e | 190 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局，堆增长与趋势斜率双门禁 |
| CI | Unit / E2E（含离线版与视觉回归）/ Pages 全部通过 |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.6.apk`（versionCode 15）
- 离线单文件：`Wordloom-offline-v1.4.6.html`

## 兼容性

- 存档：v1 / v2 均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.5
