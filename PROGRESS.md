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

## 下一步

- [ ] Playwright headful 抓:首屏所有 GET、WS 握手帧、二进制消息样本。
- [ ] 解析 multiplayer WS 协议(opcode、msgpack/binary 编码、房间/位置同步)。
- [ ] 锁定 Matrix 视觉语言:CRT 绿、字符雨 shader、ASCII 替代纹理、终端 HUD。
- [ ] 起 SvelteKit + Three.js + uWebSockets.js server 骨架。
