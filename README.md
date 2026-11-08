# 拾径 · Wordloom

> 词与线织成一片荒原。每一步都是一次删减，走完就是一条只属于你的思想路径。

在 VR 里沿词图行走的小游戏（**Pico Neo3 · WebXR**）：每步只能走到相邻的词节点，
沿墨线穿过星座般的词群，在步数耗尽前抵达赤金色的 **1024**；沿途收录的词会织成
结算海报。词图每局随机生成（主干保证可达 + 旁支随机），配五声音阶程序化音效。

- 开发者：ZhaoZehao10 · [GitHub](https://github.com/ZhaoZehao10)
- 许可证：[MIT](LICENSE)
- 灵感来源：装置展览《标记独属于你的思想路径 Random Walk》（1024 程序员节彩蛋）；
  本项目为独立的 3D/VR 重新实现，名称与代码均与原作者及其作品无隶属关系。

### 关于名字

- 中文名 **拾径**（shí jìng）：拾起词语、走出一条小径；两个字都是常用字，组合为自造词。
- 英文名 **Wordloom**：word + loom（织机），呼应「沿途收录的词织成思想路径」。
- 起名时做过检索，已避开这些既有产品：`Word Roam – Word Of Wonders`、`WordWeave`、
  `Wordrift`、`墨径`（公司名）、`拾词`（浏览器扩展）。
- **注意**：以上只是公开检索层面的查重，不构成商标法律意见。正式商用/上架应用商店前，
  建议在目标国家/地区的商标数据库（如中国商标网、USPTO）做一次正式检索。

> 本仓库只包含「拾径 / Wordloom」。另一款「3D 拼图 VR」由另一个仓库单独维护，
> 两者互不混用。

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
node tools\make-offline.mjs    # → dist\拾径Wordloom-离线版.html（单文件、无外部请求）
powershell -File tools\build-apk.ps1   # → dist\拾径Wordloom.apk（无 Gradle：aapt2/javac/d8/zipalign/apksigner）
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
| `test/rw-unit.mjs` | 286 项断言：图生成不变量（200 种子×3 难度）/ 规则边界 / 数据完整性 / 合批几何（含三角形绕序）/ 快转 / 海报 / 菜单布局与命中 / 战绩统计 / 词集收藏与容错 |
| `test/rw-e2e.mjs` | 69 项：页面无报错 → 开局 → 走子/收词 → 胜负结算 → 主干可达性 → 彩蛋 → 皮肤音色 → 海报导出 → 快转 → VR 菜单 → 战绩与难度记忆 → 词集与一览面板 → 路径回放/空间音效回落/跨难度成就 → 渲染结构 |
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
    js/stats.mjs     本地战绩与词集收藏（纯函数 + 容错解析）
    js/spatial.mjs   空间音效 PCM 合成（纯函数）
    js/replay.mjs    路径回放取样（纯函数）
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
- **元进度**：每局结算写入本地战绩（最近 30 局，含胜率/最佳/各难度分项）；
  收录过的词永久进入**词集**，引导页点「词集 x/60」可展开一览，集满即全部点亮。
- **跨难度成就**：「词集三十」（词集 ≥30）、「三途皆涉」（三种难度各胜一局）、
  「词汇全图」（集满 60 词）。
- **空间音效**：收词与走路声定位到对应词节点，转头可听出方位（Pico 内生效）。
- **路径回放**：结算后点「▶ 重放路径」沿本局足迹自动巡览，扣扳机可跳过。
- **震动反馈**：走路轻震、收词重震（机型支持时生效）。
- **难度记忆**：菜单/引导页选的难度会记住，重开与再次进入都沿用。


## 历史说明

本仓库由原 `Pico3D` 混合仓库拆分而来，拆分前的提交历史保留在 `../Pico3D`；
拆分后本仓库独立演进。
