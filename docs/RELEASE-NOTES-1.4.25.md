# 拾径 · Wordloom v1.4.25 发布说明

发布日期：2026-11-17

## 本版新增（游戏性）：连击得分

- 相邻两次走子间隔 **≤ 2.5 秒** 触发连击：
  - 连击 2 → 每步 +1 分
  - 连击 3 → 每步 +2 分
  - 连击 4/5 → 每步 +3 分（上限 5 连）
- HUD 显示「连击 xN」；结算页显示「最高连击 xN」
- 超时/时间倒流会断连，重置为 1
- 纯函数 `walkCombo`，单测覆盖 1s/2s/2.5s 边界、上限、NaN

## 质量指标

| 项目 | 结果 |
|------|------|
| 本地套件 | 10/10 |
| 单元测试 | 869 项断言 |
| 桌面 e2e | 211 项 |
| 离线版 e2e | 6 项 |
| 跨浏览器矩阵 | Chrome / Edge 双通过 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局 |
| CI | Unit / E2E / Audit / Pages |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.25.apk`（versionCode 34）
- 离线单文件：`Wordloom-offline-v1.4.25.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.24
