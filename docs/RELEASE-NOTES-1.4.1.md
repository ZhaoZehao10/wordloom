# 拾径 · Wordloom v1.4.1 发布说明

发布日期：2026-11-15

## 本版新增

- **「双重考验」成就**：迷雾 + 限时同时开启并获胜（成就总数 19）
- **对局记录标记**：最近对局列表显示 ⏱（限时）/ 🌫（迷雾）标记
- 修复 `buildResult` 缺少 `comboWin` 解构导致的结算异常

## 质量指标

| 项目 | 结果 |
|------|------|
| 单元测试 | 703 项断言 |
| 桌面 e2e | 174 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局，堆增长与趋势斜率双门禁 |
| CI | Unit / E2E（含离线版与视觉回归）/ Pages 全部通过 |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.1.apk`（versionCode 10）
- 离线单文件：`Wordloom-offline-v1.4.1.html`

## 兼容性

- 存档：v1 / v2 均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.0
