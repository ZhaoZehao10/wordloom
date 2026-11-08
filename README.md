# 随机游走 VR（Pico Neo3 WebXR）

在 VR 里沿词图一路走一路拼句子的小游戏：每步从相邻词里选一个，越走越长；
词图每局随机生成（主干保证可达 + 旁支随机），配五声音阶程序化音效与结算海报。

> 本仓库只包含「随机游走 VR」。另一款「3D 拼图 VR」在独立仓库
> `../Pico3D`（https://github.com/… 待推送），两者互不混用。

## 运行

```powershell
node make-cert.mjs        # 首次：生成本地 CA + 服务器证书（cert/）
node server.mjs           # HTTPS 8543 / HTTP 8181（与拼图仓库端口错开）
```

- 头显浏览器访问 `https://<电脑局域网IP>:8543/`
- 首次建议先装 CA：`http://<IP>:8181/ca.crt`，之后 HTTPS 零警告
- 游戏页面也可直接访问 `https://<IP>:8543/rw/index.html`

## 构建

```powershell
node tools\make-offline.mjs    # → dist\随机游走VR-离线版.html（单文件、无外部请求）
powershell -File tools\build-apk.ps1   # → dist\随机游走VR.apk（无 Gradle：aapt2/javac/d8/zipalign/apksigner）
```

APK 为壳工程（`apk/`）：应用启动后把内置 `assets/game/index.html` 拷到私有目录，
在 `127.0.0.1:8899` 起微型 HTTP 服务（loopback 属可信来源，WebXR 必然暴露），
再拉起头显浏览器。首次安装需在 Pico 设置 → 安全 中允许未知来源。

依赖：JDK 17 + Android SDK（`android-sdk/`，本仓库以目录联接复用到共享 SDK；
CI 或新机器上用 sdkmanager 安装 platforms;android-33 / build-tools;33.0.2）。

## 测试

```powershell
node tools\test-all.mjs        # 单元 + 打包 + 两套 e2e + 性能（自动起停 8543 服务器）
node tools\test-all.mjs --fast # 跳过性能实测
node test\rw-unit.mjs          # 只跑纯逻辑单元测试（毫秒级）
```

| 套件 | 覆盖 |
|------|------|
| `test/rw-unit.mjs` | 175 项断言：图生成不变量（200 种子×3 难度）/ 规则边界 / 数据完整性 / 合批几何（含三角形绕序）/ 快转 / 海报 / 菜单布局与命中 |
| `test/rw-e2e.mjs` | 37 项：页面无报错 → 开局 → 走子/收词 → 胜负结算 → 主干可达性 → 彩蛋 → 皮肤音色 → 海报导出 → 快转 → VR 菜单 → 渲染结构 |
| `test/rw-offline-e2e.mjs` | 单文件离线版 `file://` 直开可玩 + WebXR 接口探测 |
| `test/rw-perf.mjs` | 6x CPU 限速：开局/重开耗时 + 帧率中位数 + **结构门禁**（drawcall≤60、三角形≤60000、每节点顶点=165） |

性能（6x CPU 限速 ≈ 骁龙 XR2）：开局 ~0.45s、重开 ~0.15s、帧率中位数 77~90fps；
渲染结构 35 drawcall / 7600 三角形（词球与边全部合批，改动前为 113 / 15382）。

## 目录

```
public/
  rw/
    index.html / rw.css
    js/data.mjs      词库 / 一言 / 皮肤 / 音色 / 成就 / 难度
    js/graph.mjs     词图生成（主干保证可达 + 相对邻居图）
    js/rules.mjs     纯规则：计分/成就/路径诗/一言/结算汇总/快转
    js/geometry.mjs  纯几何：边缓冲、词球合批（顶点色烘焙光照）、拾取映射
    js/poster.mjs    结算海报绘制（1080×1620 PNG）
    js/menu.mjs      VR 菜单布局与命中判定
    js/audio.mjs     WebAudio 程序化音效
    js/main.mjs      场景 / 交互 / 渲染主程序
  vendor/        three.module.min.js（r160）+ VRButton.js（本地化，运行时零外网请求）
apk/             壳工程（AndroidManifest / res / src；build/ 为产物，已 ignore）
tools/           make-offline / make-icons / build-apk / test-all
test/            rw-unit / rw-e2e / rw-offline-e2e / rw-perf
server.mjs       HTTPS 静态服务器（8543 / 8181）
cert/            自签名证书（gitignore，由 make-cert.mjs 生成）
```

## 玩法与交互（补充）

- **VR 设置菜单**：任意时刻按手柄**握键**呼出，射线点选难度 / 皮肤 / 音色 / 开始；
  难度「下一局生效」，皮肤与音色即时生效并记住；
- **快转**：推右/左摇杆一次转 30°，必须回中才能再转（防连续转圈致晕）；
- **结算海报**：走完一局在结算页点「⬇ 下载海报 PNG」，得到 1080×1620 竖版海报
  （路径诗 + 一言 + 数据 + 成就 + 1024 水印）。


## 历史说明

本仓库由原 `Pico3D` 混合仓库拆分而来，拆分前的提交历史保留在 `../Pico3D`；
拆分后本仓库独立演进。
