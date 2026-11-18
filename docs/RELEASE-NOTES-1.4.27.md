# 拾径 · Wordloom v1.4.27 发布说明

发布日期：2026-11-18

## 本版新增（游戏性）

- **连击反馈强化**：
  - 音调随连击升高（C5 起每级 +1 半音，4 连以上加高八度点缀）
  - 震动强度与时长随连击递增（0.42→0.9，24→48ms）
- 纯函数 `comboFeedback` 统一计算强度/时长/音高，覆盖 1~5 连与越界
- 单测 + e2e 覆盖反馈参数单调性

## 质量指标

| 项目 | 结果 |
|------|------|
| 本地套件 | 10/10 |
| 单元测试 | 879 项断言 |
| 桌面 e2e | 213 项 |
| 离线版 e2e | 6 项 |
| 跨浏览器矩阵 | Chrome / Edge 双通过 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局 |
| CI | Unit / E2E / Audit / Pages |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.27.apk`（versionCode 36）
- 离线单文件：`Wordloom-offline-v1.4.27.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.26
