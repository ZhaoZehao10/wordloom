# 拾径 · Wordloom

> 词与线织成一片荒原。每一步都是一次删减，走完就是一条只属于你的思想路径。

在 VR 里沿词图行走的小游戏（**Pico Neo3 · WebXR**）：每步只能走到相邻的词节点，
沿墨线穿过星座般的词群，在步数耗尽前抵达赤金色的 **1024**；沿途收录的词会织成
结算海报。词图每局随机生成（主干保证可达 + 旁支随机），配五声音阶程序化音效。

玩法源自 1024 程序员节彩蛋《随机游走》。

## 特性

- **每局都是新图**：主干路径保证起点到 1024 可达，旁支按相对邻居图随机织入；
- **三种难度**（悠然 16 步 / 标准 12 步 / 紧绷 9 步）、**三套皮肤**、**三种音色**；
- **VR 内设置菜单**：握键呼出，射线点选难度 / 皮肤 / 音色 / 开始；
- **舒适快转**：摇杆推一次转 30°，回中才能再转，避免连续转圈致晕；
- **空间音效**：走路与收词声定位到对应词节点，转头能听出方位；
- **路径回放**：结算后沿本局足迹自动巡览，可随时跳过；
- **结算海报**：一键导出 1080×1620 PNG（路径诗 + 一言 + 数据 + 成就）；
- **元进度**：本地战绩（胜率 / 最佳 / 各难度）、跨局词集（集满 60 词）、
  以及「词集三十」「三途皆涉」「词汇全图」等跨难度成就；
- **零外部依赖**：three.js 与字体全部本地化，运行时无任何外网请求；
- **三种交付形态**：局域网 HTTPS 网页、单文件离线 HTML、离线 APK。

## 运行

**在线试玩**：<https://ZhaoZehao10.github.io/wordloom/rw/>（HTTPS，Pico 浏览器可直接进 VR）

本地运行：

```powershell
node make-cert.mjs        # 首次：生成本地 CA + 服务器证书（cert/）
node server.mjs           # HTTPS 8543 / HTTP 8181
```

- 头显浏览器访问 `https://<电脑局域网IP>:8543/`
- 首次建议先装 CA：`http://<IP>:8181/ca.crt`，之后 HTTPS 零警告
- 游戏页面也可直接访问 `https://<IP>:8543/rw/index.html`

## 玩法与交互

- **目标**：从朱砂色的「出发」出发，沿墨线走到相邻词节点，每走一步耗一步数；
  步数耗尽前抵达赤金色的「1024」即成功，走完无论胜负都会生成结算海报。
- **走子**：手柄射线瞄准带脉冲光环的相邻节点，扣扳机滑翔过去；
- **彩蛋**：连点标题七次可解除步数限制；键盘敲出 `1024` 有惊喜；
- **VR 设置菜单**：任意时刻按手柄**握键**呼出，射线点选；难度「下一局生效」，
  皮肤与音色即时生效并记住；
- **快转**：推右 / 左摇杆一次转 30°，必须回中才能再次触发；
- **空间音效**：收词与走路声定位到对应词节点，转头可听出方位（Pico 内生效）；
- **路径回放**：结算后点「▶ 重放路径」沿本局足迹自动巡览，扣扳机可跳过；
- **震动反馈**：走路轻震、收词重震（机型支持时生效）；
- **元进度**：结算写入本地战绩；收录过的词永久进入词集，引导页点「词集 x/60」
  可展开一览，集满即全部点亮。

## 构建

```powershell
node tools\make-offline.mjs            # → dist\拾径-离线版.html（单文件、无外部请求）
powershell -File tools\build-apk.ps1   # → dist\拾径Wordloom.apk（aapt2/javac/d8/zipalign/apksigner）
```

APK 为壳工程（`apk/`）：应用启动后把内置 `assets/game/index.html` 拷到私有目录，
在 `127.0.0.1:8899` 起微型 HTTP 服务（loopback 属可信来源，WebXR 必然暴露），
再拉起头显浏览器。首次安装需在 Pico 设置 → 安全 中允许未知来源。

依赖：JDK 17 + Android SDK（`platforms;android-33`、`build-tools;33.0.2`，用
`sdkmanager` 安装）。签名密钥由构建脚本在本地生成，口令写入 `apk/.keystore.pass`
（已在 `.gitignore` 中，不会入库）。

## 测试

```powershell
node tools\test-all.mjs        # 单元 + 打包 + 两套 e2e + 性能（自动起停 8543 服务器）
node tools\test-all.mjs --fast # 跳过性能实测
node test\rw-unit.mjs          # 只跑纯逻辑单元测试（毫秒级）
```

| 套件 | 覆盖 |
|------|------|
| `test/rw-unit.mjs` | 286 项断言：图生成不变量（200 种子×3 难度）/ 规则边界 / 数据完整性 / 合批几何（含三角形绕序）/ 快转 / 海报 / 菜单布局与命中 / 战绩统计 / 词集收藏与容错 / 空间音效 / 路径回放 / 跨难度成就 / 打包静态检查 |
| `test/rw-e2e.mjs` | 69 项：页面无报错 → 开局 → 走子/收词 → 胜负结算 → 主干可达性 → 彩蛋 → 皮肤音色 → 海报导出 → 快转 → VR 菜单 → 战绩与难度记忆 → 词集与一览面板 → 路径回放/空间音效回落/跨难度成就 → 渲染结构 |
| `test/rw-offline-e2e.mjs` | 单文件离线版 `file://` 直开可玩 + WebXR 接口探测 |
| `test/rw-perf.mjs` | 6x CPU 限速：开局/重开耗时 + 帧率中位数 + 结构门禁（drawcall≤60、三角形≤60000、每节点顶点=165） |

性能（6x CPU 限速 ≈ 骁龙 XR2）：开局约 0.45s、重开约 0.15s、帧率中位数 77~90fps；
渲染结构 35 drawcall / 7600 三角形。

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
    js/stats.mjs     本地战绩与词集收藏（纯函数 + 容错解析）
    js/spatial.mjs   空间音效 PCM 合成（纯函数）
    js/replay.mjs    路径回放取样（纯函数）
    js/main.mjs      场景 / 交互 / 渲染主程序
  vendor/        three.module.min.js（r160）+ VRButton.js（本地化，运行时零外网请求）
apk/             壳工程（AndroidManifest / res / src；build/ 为产物，已 ignore）
tools/           make-offline / make-icons / build-apk / test-all
test/            chrome / rw-unit / rw-e2e / rw-offline-e2e / rw-perf
server.mjs       HTTPS 静态服务器（8543 / 8181）
cert/            自签名证书（gitignore，由 make-cert.mjs 生成）
```

## 开发者与许可

- 开发者：ZhaoZehao10 · [GitHub](https://github.com/ZhaoZehao10)
- 许可证：[MIT](LICENSE)
