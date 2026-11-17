# 拾径 · Wordloom v1.4.24 发布说明

发布日期：2026-11-17

## 本版新增（游戏性）：每日挑战补签卡

- **获取**：每日挑战连续打卡每满 7 天，奖励 **1 张补签卡**（上限 3 张）
- **使用**：月视图显示「🎫 补签卡 X/3」；若昨天未挑战且有卡，出现「补签昨天（-1）」
  - 补签后昨天记为完成（0 分），连续天数恢复
  - 重复补签/无卡时按钮不出现
- 纯函数：`parseFixCards` / `earnedFixCards` / `canFixYesterday` / `applyFixYesterday`
- 单测覆盖边界与幂等；e2e 覆盖真实点击补签与扣卡

## 质量指标

| 项目 | 结果 |
|------|------|
| 本地套件 | 10/10 |
| 单元测试 | 863 项断言 |
| 桌面 e2e | 209 项 |
| 离线版 e2e | 6 项 |
| 跨浏览器矩阵 | Chrome / Edge 双通过 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局 |
| CI | Unit / E2E / Audit / Pages |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.24.apk`（versionCode 33）
- 离线单文件：`Wordloom-offline-v1.4.24.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入（补签卡存 `rw-fix-cards`）
- APK：包名与签名不变，可覆盖安装 v1.4.23
