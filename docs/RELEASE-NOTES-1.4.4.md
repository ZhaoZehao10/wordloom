# 拾径 · Wordloom v1.4.4 发布说明

发布日期：2026-11-15

## 本版新增

- **成就搜索**：成就总览新增搜索框，可按中文名、英文名或成就 key 搜索（不区分大小写）
- 搜索可与分类筛选、只看未解锁叠加使用
- 英文界面下搜索框 placeholder 自动翻译

## 质量指标

| 项目 | 结果 |
|------|------|
| 单元测试 | 756 项断言 |
| 桌面 e2e | 183 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局，堆增长与趋势斜率双门禁 |
| CI | Unit / E2E（含离线版与视觉回归）/ Pages 全部通过 |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.4.apk`（versionCode 13）
- 离线单文件：`Wordloom-offline-v1.4.4.html`

## 兼容性

- 存档：v1 / v2 均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.3
