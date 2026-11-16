# 拾径 · Wordloom v1.4.16 发布说明

发布日期：2026-11-16

## 本版新增：成就解锁动画

- **2D 提示**：金色 toast 弹入（0.6 → 1.12 过冲 → 1），带呼吸光晕
- **VR 提示**：3D 面板 0.45 秒缩放弹入、4.2 秒内缓慢上浮 5cm、末段淡出
- 动画曲线抽为纯函数 `anim.mjs`：
  - `popScale(progress)`：弹出缩放（含过冲）
  - `toastAlpha(elapsed)`：保持 3s 后 1.2s 淡出
  - `toastRise(elapsed)`：上浮位移
- 单测覆盖边界/NaN/clamp；e2e 校验 `animationName` 含 `ach-pop`

## 质量指标

| 项目 | 结果 |
|------|------|
| 本地套件 | 8/8 |
| 单元测试 | 812 项断言 |
| 桌面 e2e | 196 项 |
| 离线版 e2e | 6 项 |
| 视觉回归 | 5 张基线（Windows / Linux） |
| soak 稳定性 | 60 局 |
| CI | Unit / E2E / Audit / Pages |

## 产物

- 在线试玩：https://zhaozehao10.github.io/wordloom/rw/
- APK：`Wordloom-v1.4.16.apk`（versionCode 25）
- 离线单文件：`Wordloom-offline-v1.4.16.html`
- 校验清单：`SHA256SUMS.txt`

## 兼容性

- 存档：v1 / v2 / 加密存档均可导入
- APK：包名与签名不变，可覆盖安装 v1.4.15
