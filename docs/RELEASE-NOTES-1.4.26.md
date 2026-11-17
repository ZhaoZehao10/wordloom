# 拾径 · Wordloom v1.4.26 发布说明

发布日期：2026-11-18

## 本版新增（游戏性）

- **「⚡ 五连珠」成就**：单局最高连击达到 5 解锁（成就总数 **22**）
- 连击成就归入「单局」分类，可与其它成就叠加
- 单测覆盖 4 连不达成 / 5 连解锁；e2e 验证真实连击 + 成就

## 质量指标

| 项目 | 结果 |
|------|------|
| 本地套件 | 10/10 |
| 单元测试 | 873 项断言 |
| 桌面 e2e | 212 项 |
| 离线版 e2e | 6 项 |
| 跨浏览器矩阵 | Chrome / Edge 双通过 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局 |
| CI | Unit / E2E / Audit / Pages |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.26.apk`（versionCode 35）
- 离线单文件：`Wordloom-offline-v1.4.26.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.25
