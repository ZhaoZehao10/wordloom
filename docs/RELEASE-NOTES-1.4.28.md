# 拾径 · Wordloom v1.4.28 发布说明

发布日期：2026-11-18

## 本版新增（游戏性）

- **限时模式最后 10 秒警示**：
  - HUD 计时变红（最后 10 秒）
  - 最后 5 秒红色闪烁（critical）
  - 每秒提示音，最后 5 秒音调更高
- 纯函数 `timerState`：warning（≤10s）/ critical（≤5s）/ seconds
- 单测覆盖 11/10/5/0/NaN；e2e 验证 HUD 类名切换

## 质量指标

| 项目 | 结果 |
|------|------|
| 本地套件 | 10/10 |
| 单元测试 | 884 项断言 |
| 桌面 e2e | 215 项 |
| 离线版 e2e | 6 项 |
| 跨浏览器矩阵 | Chrome / Edge 双通过 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局 |
| CI | Unit / E2E / Audit / Pages |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.28.apk`（versionCode 37）
- 离线单文件：`Wordloom-offline-v1.4.28.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.27
