# 拾径 · Wordloom v1.4.12 发布说明

发布日期：2026-11-16

## 本版新增

- **每日挑战分享文案**：月视图新增「分享今日」按钮，一键复制包含日期/得分/连续天数的挑战文案
- **API 回退路径自动化测试**：用 mock GitHub API 验证逐提交推送流程（blob → tree → commit → ref）
- 单测覆盖每日分享空态与完整态

## 质量指标

| 项目 | 结果 |
|------|------|
| 单元测试 | 795 项断言 |
| 桌面 e2e | 194 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局，堆增长与趋势斜率双门禁 |
| CI | Unit / E2E（含离线版与视觉回归）/ Pages 全部通过 |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.12.apk`（versionCode 21）
- 离线单文件：`Wordloom-offline-v1.4.12.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.11
