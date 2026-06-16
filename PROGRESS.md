# Matrix Messenger — Progress Log

> 仿照 messenger.abeto.co (小行星送货游戏) 实现一个**黑客帝国风格**同款,然后把游戏物理本体化让 agent 可读。
> 主目录 `/home/cym/abeto`,语言 Node + Three.js (后续可能用 Svelte 5)。

## Timeline

- **2026-06-16 17:20 UTC** — 任务接收,环境就绪 (curl/node24/npm/git 全在)。
- **2026-06-16 17:21 UTC** — `curl -A "Mozilla/5.0" https://messenger.abeto.co/` 200 OK 抓回真实 HTML;主入口 `assets/webgl-C4v7tvuW.js` (5.2KB) + 隐含 `App3D-BLRWK1h9.js` (1.9MB)。
- **2026-06-16 17:22 UTC** — 下载 webgl/runtime/style/App3D 全 bundle 到 `research/assets/`。
  - 技术栈识别:**Svelte 5** (`$.mount` API) + **Vite** + **Three.js**(WebGL 自写场景)。
  - 8 Worker:draco / exr / collision / geometry / glyph / msdf / character / bitmap。
- **2026-06-16 17:25 UTC** — 解析 App3D 字符串表,枚举资源清单:
  - **19 NPC**(alien/boss/caveman/chef/diver/factory-worker-a/b/c/female-scientist/fox/male-scientist/mountainman/musician/office-worker/oldwoman/owl/scout/threekid/young-lady)— 每个带 bones + idle + talk + walk DRC (Draco-compressed) 动画。
  - **6 大场景** ambiance OGG:beach / city / factory / forest / temple / waterfalls。
  - **6 种快递包裹**:clothes / letterwet / note / offering / postcard / samplebox。
  - **quest schema 关键词**:`quest_enable_id` / `quest_disable_id` / `quest_give_model` / `quest_receive_model` / `quest_step_check` / `quest_completed`。
  - **多人服务器**:`wss://multiplayer-server-76608060529.us-central1.run.app` (Google Cloud Run + uWebSockets.js v20)。
- **2026-06-16 17:27 UTC** — Playwright + Chromium 装好 (`~/.cache/ms-playwright/chromium-1208`),准备抓运行时网络/WS 流量。
- **2026-06-16 17:28 UTC** — git init + baseline commit research/。
- **2026-06-16 17:35 UTC** — Playwright headless 跑 messenger.abeto.co,118 个 HTTP 资源全抓回 `research/network/requests.json`:
  - 主域全 CDN(`assets/audio/{music,ambiances,dialogues,ui,character,camera,intro}/*.ogg`、`assets/images/*.ktx2`、`assets/libs/{basis,draco}/*.wasm`)。
  - 截图首屏 `intro.png` 拿到:**3D 行星 + 大写立体 "MESSENGER" + 黄色 "BEGIN" 按钮**,手绘水彩风。
- **2026-06-16 17:38 UTC** — WS 直连 `wss://multiplayer-server-76608060529.us-central1.run.app/` 拿到第一帧服务端响应:`{"id":"frRS"}`(JSON,4 字符短 ID 分配)。发垃圾 byte 被 1006 关闭 = 严协议。
- **2026-06-16 17:42 UTC** — 反向解析 App3D bundle 完整确认 `microrealm` 协议:
  - **lib 名**:`MicroRealmConnection`(作者自创通用中继),WS subprotocol = `permessage-deflate`。
  - **控制面 JSON**:client `{ping:ts}` / `{r:[prefix,room]}`,server `{id}` / `{r}` / `{data:bytes}` / `{leave:id}`。
  - **数据面 protobuf**:动态 schema(`createMessage("RealmData", data, dataTypes)`,字段从初始 data 推),35Hz 更新 + 20Hz 心跳。
  - **角色 payload schema 已知**:`{p:[x,y,z] float, r:[rx,ry,rz] float, medium:uint32, animation:uint32, bonesFile:string, modelFiles:string, animationFiles:string, tag:string, networkEvent:string}`。
  - **球面引力**:`mesh.up = mesh.position.normalize()`(从行星中心朝外)— 标准 sphere-walking 物理。

## 阶段 1 结论 = 调研完成

abeto Messenger 真正是: **Svelte 5 + Three.js WebGL** 客户端 + **uWebSockets.js generic-relay 服务端**(动态 protobuf RealmData);**单一小行星(planet `present`)** 上 6 个区域(intro/beach/city/factory/forest/temple/waterfalls);**19 NPC + 6 类快递包裹 + quest engine**(`quest_enable/disable/give/receive_model + step_check`);角色绕球面行走,多人同步只传 pos/rot/anim/tag/networkEvent。

## 阶段 2 实际决策 (2026-06-16 17:50 — 与阶段1 计划有 2 处偏离, 已记录)

- 视觉 ✅:CRT 绿 `#00ff41` + 字符雨 canvas2D + scanline + 终端 monospace HUD + boot 序列。
- 客户端框架 **改 SvelteKit → Vanilla JS + Vite**:游戏没有路由/SSR/数据层,Svelte 组件化收益低,DOM 改动只有 HUD/终端两块,直接操作更轻;Three.js 主导。
- 服务端 **改 uWebSockets.js → `ws` (纯 Node)**:本地开发优先,`ws` API 与 uWS 接近,后续 Cloud Run 部署可一行换包;线协议层完全照搬 microrealm(`{id}/{r}/{data}/{leave}/{ping}/{pong}`),零差异。
- 物理本体 (阶段4):JSON-LD + Turtle + `/agent-sdk.js`。

## Watson critic 反馈 (2026-06-16 19:12, agent_solve probe)

调 `bash .monitor/agent_solve.sh "<q>" probe` 真测改革 B — Watson 给出实质裁决,不是 ceremony:

- **Cynefin 域** = complex (confidence 0.82),不是 simple/complicated/chaotic。
- **method_family 主轴** = `hybrid`(c 选项),次轴 `cynefin + dsm_interface`。
- **route**:不要先拍板三选一,要做 **seam 测试** — abeto 6 districts → Matrix 语义 → 导航命名映射稳定性。基底落在内容 taxonomy / 命名 / 迁移约束。
- **disconfirming**:若 districts 已硬编码 → 降级到 dsm_interface(纯接口映射工作);若评分准则就绪 → 降级 complicated。

**真效果**:Watson 这次反馈让我 (1) 明确选 hybrid (匹配现有方向, +信号), (2) 加 seam 验证 — 把 `abeto_alias` + `abeto_ambiance` 字段塞进 districts schema,让跨域 agent (读 abeto 文档的 + 读我们 ontology 的) 可以对账,**这是我自己没想到的层**。
- **改革 B 评价**:真有用(非装饰),关键在 probe 模式给出"why-not 4 条"而非"yes/no",省了我自己穷举的麻烦。

## 阶段 3 代码骨架 (2026-06-16 17:55)

- `client/`:`index.html` + `vite.config.mjs` + `src/{main.js, ui/{rain,boot,terminal,styles}, scenes/{planet,avatar,camera-rig}, systems/{input,sphere-physics,net,quests}, ontology/world.js}` — 共 12 文件 ~900 行。
- `server/`:`src/index.mjs` 微 realm 中继 + ontology 端点 + 静态文件。

## 阶段 3 + 4 跑通 (2026-06-16 19:25)

- `server/src/index.mjs` 启动监听 :3006,4 端点 `/healthz /ontology /ontology.ttl /agent-sdk.js` 全 200。
- `server/src/e2e.test.mjs` 8/8 断言全过(id/room/relay/from/pong/leave)。
- `server/src/agent.test.mjs` 6/6 断言全过(ontology ingest / peer visibility / chat / event / 球面行走 18.3m)。
- 客户端 `vite build` 生成 dist/ 507KB(gzip 130KB),server 自动从 dist 服务。
- Playwright headless 跑 4 截图(`research/visual/`):
  - **01-boot.png**:黑底 + 绿 typewriter log + 隐约字符雨。
  - **02-planet.png**:绿色 wireframe 行星 + Zion 区域绿色信标柱 + HUD(NODE/ID/PEERS/LAT/QUEST)+ 终端。
  - **04-after-goto.png**:`/goto oracle` 传送后,橙色 (#ff8a00) Oracle 信标在视野中,终端显示 /help 完整菜单 + teleport 成功。
  - 0 错误,0 console error。
- 球面行走 SDK 修了一个 antipodal slerp bug(原 cartesian + 投影在大圆切线 = 0 处不收敛,改 SLERP 真球面插值)。

## 阶段 5 — 进行中

- [x] **README.md** (2026-06-16 19:35) — 项目介绍 + 5 截图(docs/screens/)+ 跑法 + 架构 ASCII + 协议表 + 物理常数表 + agent SDK quickstart + repo layout + test 章节。强调 ontology + abeto‑alias seam,标"无 abeto 代码包含" 出处声明。
- [x] `npm test` 一键 pipeline:`scripts/run-e2e.sh` 起临时 server :3007 → 跑 e2e + agent SDK,完赛 trap kill。28 assertions 全过(14 ontology + 8 ws + 6 sdk)。
- [x] 截图迁移到 `docs/screens/`(README 引用稳定路径,与 research/visual 解耦)。
- [x] **Dockerfile + .dockerignore + fly.toml** (2026-06-16 19:50):
  - Multi-stage Node 24 slim:builder 装全 deps + `vite build` + 跑 ontology test;runtime 仅 prod deps + dist/ + server,non-root user。
  - 镜像 **91.8 MB**(content size),build 后 `docker run` 2s 启动,`/healthz` `/ontology` 200,e2e 8/8 + agent 6/6 在容器内全过。
  - WSL2 docker daemon stale lock 修了一次:`reset-failed docker.service && start`。
  - fly.toml:`internal_port 3005` + `/healthz` check + `auto_stop_machines` + 256MB VM。
- [ ] favicon SVG。
- [ ] 性能压测:50 peers / room 看 latency。
