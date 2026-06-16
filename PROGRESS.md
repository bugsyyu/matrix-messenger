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

## 下一步 (阶段 2: 架构设计)

- [ ] 锁定 Matrix 视觉:CRT 绿 (#00ff41) + 字符雨 shader + ASCII 替代纹理 + monospace 终端 HUD。
- [ ] 选型:SvelteKit + Three.js + Vite(同款客户端);uWebSockets.js + 同 microrealm 协议(可直接借用)。
- [ ] 物理本体:JSON-LD/Turtle schema 描述 planet/NPC/quest/delivery/action,挂在 `/ontology` 端点。
