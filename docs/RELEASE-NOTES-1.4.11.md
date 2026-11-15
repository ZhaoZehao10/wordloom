# 拾径 · Wordloom v1.4.11 发布说明

发布日期：2026-11-15

## 本版新增

- **发布断网自动回退**：`release.mjs --publish` 在 `git push` 失败时自动改用 **GitHub Git Data API**：
  - 逐个提交重建 blob/tree/commit（保持 SHA 与本地一致）
  - 更新 main ref、补推标签、创建 Release 并上传资产
- 新增 `tools/git-publish.mjs`（可单测的提交/身份解析逻辑）
- 适用于 `github.com:443` 被阻断但 `api.github.com` 可达的网络环境

## 质量指标

| 项目 | 结果 |
|------|------|
| 单元测试 | 789 项断言 |
| 桌面 e2e | 193 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局，堆增长与趋势斜率双门禁 |
| CI | Unit / E2E（含离线版与视觉回归）/ Pages 全部通过 |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.11.apk`（versionCode 20）
- 离线单文件：`Wordloom-offline-v1.4.11.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.10
