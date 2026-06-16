// Main entrypoint: boot → init three → planet → avatar → loop → net.
import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, Vector3, Group, FogExp2,
  ACESFilmicToneMapping, SRGBColorSpace, MeshBasicMaterial, Mesh, SphereGeometry,
} from 'three';
import { startRain } from './ui/rain.js';
import { bootSequence } from './ui/boot.js';
import { Terminal } from './ui/terminal.js';
import { InputState } from './systems/input.js';
import { SphereWalker } from './systems/sphere-physics.js';
import { buildPlanet } from './scenes/planet.js';
import { buildAvatar, alignToPlanet } from './scenes/avatar.js';
import { PlanetCameraRig } from './scenes/camera-rig.js';
import { MatrixNet } from './systems/net.js';
import { QuestEngine } from './systems/quests.js';
import { PHYSICS, DISTRICTS, PLANETS, G } from './ontology/world.js';

const PLANET_RADIUS = PHYSICS.planet_radius;
const state = { peers: new Map(), tag: prompt_tag() };

main().catch((e) => {
  console.error(e);
  document.getElementById('boot-log').textContent += `\n[fatal] ${e?.stack ?? e}`;
});

async function main() {
  startRain(document.getElementById('rain'));
  await bootSequence();

  // three.js scene
  const scene = new Scene();
  scene.background = new Color('#000503');
  scene.fog = new FogExp2(0x000805, 0.012);

  const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, PLANET_RADIUS + 5, PLANET_RADIUS + 30);

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  document.getElementById('app').appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // planet
  const planet = buildPlanet(scene, { radius: PLANET_RADIUS });

  // avatar
  const me = buildAvatar({ color: '#00ff41', label: state.tag });
  scene.add(me);

  // delivery target glyph (a wireframe cube hovering at the destination)
  const deliveryTarget = new Mesh(
    new SphereGeometry(2.5, 12, 12),
    new MeshBasicMaterial({ color: 0xffb000, wireframe: true, transparent: true, opacity: 0.7 })
  );
  deliveryTarget.visible = false;
  scene.add(deliveryTarget);
  const pickupTarget = new Mesh(
    new SphereGeometry(2.5, 12, 12),
    new MeshBasicMaterial({ color: 0x39ff14, wireframe: true, transparent: true, opacity: 0.7 })
  );
  pickupTarget.visible = false;
  scene.add(pickupTarget);

  // peer avatars
  const peerGroup = new Group();
  scene.add(peerGroup);
  const peerMeshes = new Map();

  // input + physics — now multi-body. Walker reads PLANETS/G directly from world.js.
  const input = new InputState();
  const walker = new SphereWalker({
    planets:   PLANETS,
    gConst:    G,
    jumpForce: PHYSICS.jump_force,
    speed:     PHYSICS.walk_speed,
    startPlanetId: 'zion',
  });

  const rig = new PlanetCameraRig(camera, { distance: 9, height: 4 });

  // quests
  const quests = new QuestEngine({ planetRadius: PLANET_RADIUS });
  quests.spawn();
  updateQuestHud();

  quests.addEventListener('spawn', updateQuestHud);
  quests.addEventListener('pickup', (e) => {
    me.userData.carryCube.visible = true;
    term.ok(`[pickup] ${e.detail.typeLabel} from ${e.detail.fromName} → carry to ${e.detail.toName}`);
    updateQuestHud();
  });
  quests.addEventListener('complete', (e) => {
    me.userData.carryCube.visible = false;
    term.ok(`[delivered] +${e.detail.reward} rep ::: ${e.detail.typeLabel}`);
    net.sendEvent('delivery_complete', { type: e.detail.type, reward: e.detail.reward });
    setTimeout(() => quests.spawn(), 800);
  });

  // terminal
  const term = new Terminal({
    onCommand: handleCommand,
    onChat: (text) => {
      net.sendChat(text);
      term.chat(state.tag, text);
    },
  });
  term.show();
  term.sys('// terminal online // /help for commands');

  // hud
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('hud-id').textContent = state.tag;

  // net — allow override via ?ws=<url>, useful when client is on GitHub Pages
  // and the relay is somewhere else; default to same-origin /ws.
  const params  = new URLSearchParams(location.search);
  const wsParam = params.get('ws');
  const wsUrl   = wsParam
    || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

  const net = new MatrixNet({ url: wsUrl, roomPrefix: 'matrix', room: 'zion' });
  net.localData.tag = state.tag;

  let netGaveUp = false;
  let firstErrorAt = 0;
  net.addEventListener('error', (e) => {
    if (netGaveUp) return;
    firstErrorAt ||= Date.now();
    // If we can't reach a relay within 4s, declare offline mode and stop spamming.
    if (Date.now() - firstErrorAt > 4000) {
      netGaveUp = true;
      net.disconnect();
      term.err('[net] no relay reachable — running in OFFLINE mode (single-player).');
      term.sys('[net] start a server (npm start) or pass ?ws=<wss://your-relay/ws> in the URL.');
      document.getElementById('hud-id').textContent = `${state.tag}#offline`;
      document.getElementById('hud-peers').textContent = '—';
    }
  });
  net.connect();
  net.addEventListener('id', (e) => {
    document.getElementById('hud-id').textContent = `${state.tag}#${e.detail}`;
    term.ok(`[net] id=${e.detail}`);
  });
  net.addEventListener('room', (e) => term.sys(`[net] room=${e.detail}`));
  net.addEventListener('chat', (e) => term.chat(e.detail.from, e.detail.text));
  net.addEventListener('peer', (e) => {
    const { from, data } = e.detail;
    let m = peerMeshes.get(from);
    if (!m) {
      m = buildAvatar({ color: hashColor(from), label: data.tag || from });
      peerGroup.add(m);
      peerMeshes.set(from, m);
      term.sys(`[net] peer joined: ${from}`);
    }
    if (data.p) {
      const target = new Vector3(...data.p);
      m.userData._target = target;
      if (data.r) m.userData._yaw = data.r[1] ?? 0;
    }
  });
  net.addEventListener('leave', (e) => {
    const m = peerMeshes.get(e.detail);
    if (m) { peerGroup.remove(m); peerMeshes.delete(e.detail); term.sys(`[net] peer left: ${e.detail}`); }
  });

  // click to capture mouse
  renderer.domElement.addEventListener('click', () => input.requestCapture(renderer.domElement));

  // main loop
  const clock = { last: performance.now() };
  function tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - clock.last) / 1000);
    clock.last = now;

    const ipt = input.consume(dt);
    const physOut = walker.step(ipt, dt);
    alignToPlanet(me, physOut.position, physOut.forward, PLANET_RADIUS);
    me.position.copy(walker.position);

    rig.update(walker.position, physOut.forward, physOut.up);

    // quests
    const active = quests.update(walker.position);
    if (active) {
      pickupTarget.visible = active.stage === 'pickup';
      pickupTarget.position.copy(active.fromPos.clone().multiplyScalar(1.06));
      deliveryTarget.visible = active.stage === 'deliver';
      deliveryTarget.position.copy(active.toPos.clone().multiplyScalar(1.06));
    } else {
      pickupTarget.visible = false;
      deliveryTarget.visible = false;
    }

    // smooth peer positions
    for (const m of peerMeshes.values()) {
      const tgt = m.userData._target;
      if (tgt) {
        const cur = m.position.clone();
        cur.lerp(tgt, 0.18);
        const up = cur.clone().normalize();
        const fwd = new Vector3(Math.cos(m.userData._yaw || 0), 0, Math.sin(m.userData._yaw || 0)).normalize();
        alignToPlanet(m, cur, fwd, PLANET_RADIUS);
      }
    }

    // throttled net send
    net.setLocal({
      p: walker.position.toArray(),
      r: [0, walker.heading, 0],
      anim: ipt.forward !== 0 || ipt.strafe !== 0 ? 1 : 0,
      tag: state.tag,
    });

    // hud
    document.getElementById('hud-peers').textContent = String(peerMeshes.size);
    document.getElementById('hud-lat').textContent = String(net.latency || '--');
    document.getElementById('hud-node').textContent = `~/${net.room}`;

    planet.root.userData.update?.(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // expose for debugging
  window.matrix = { scene, camera, renderer, walker, planet, net, quests, peerMeshes, state };

  // helper: handle slash commands
  function handleCommand(cmd, args) {
    switch (cmd) {
      case 'help':
        term.sys('/help          show this');
        term.sys('/who           list peers');
        term.sys('/goto <id>     teleport to a district (zion|construct|mainframe|loop|source|oracle)');
        term.sys('/quest         pick a new delivery');
        term.sys('/room <name>   join a different room');
        term.sys('/tag <name>    rename yourself');
        term.sys('/where         print your coords');
        term.sys('/ontology      print URL to machine-readable world ontology');
        break;
      case 'who':
        term.sys(`peers: ${peerMeshes.size}`);
        for (const [id, m] of peerMeshes) term.sys(`  ${id} (${m.userData.label})`);
        break;
      case 'goto': {
        const d = DISTRICTS.find((x) => x.id === args[0]);
        if (!d) { term.err(`unknown district: ${args[0]}`); break; }
        const v = new Vector3(...d.direction).normalize().multiplyScalar(PLANET_RADIUS + 0.5);
        walker.position.copy(v);
        walker.velocity.set(0, 0, 0);
        walker.altitudeVel = 0;
        term.ok(`teleported to ${d.name}`);
        break;
      }
      case 'quest':
        quests.cancel();
        quests.spawn();
        updateQuestHud();
        break;
      case 'room':
        if (!args[0]) { term.err('usage: /room <name>'); break; }
        net.room = args[0];
        net._sendJson({ r: [net.roomPrefix, net.room] });
        for (const m of peerMeshes.values()) peerGroup.remove(m);
        peerMeshes.clear();
        break;
      case 'tag':
        if (!args[0]) { term.err('usage: /tag <name>'); break; }
        state.tag = args[0].slice(0, 16);
        net.localData.tag = state.tag;
        document.getElementById('hud-id').textContent = `${state.tag}#${net.id ?? '----'}`;
        term.ok(`renamed → ${state.tag}`);
        break;
      case 'where':
        term.sys(`pos=${walker.position.toArray().map((n)=>n.toFixed(2)).join(',')}  heading=${walker.heading.toFixed(2)}`);
        break;
      case 'ontology':
        term.sys('GET /ontology  (json-ld)');
        term.sys('GET /ontology.ttl  (turtle)');
        term.sys('GET /agent-sdk.js  (drop-in agent client)');
        break;
      default:
        term.err(`unknown command: /${cmd}  (try /help)`);
    }
  }

  function updateQuestHud() {
    const el = document.getElementById('hud-quest');
    if (!quests.active) { el.textContent = '(no active quest)'; return; }
    const a = quests.active;
    el.textContent = a.stage === 'pickup'
      ? `Pick up ${a.typeLabel} @ ${a.fromName}`
      : `Deliver ${a.typeLabel} → ${a.toName}  [+${a.reward}]`;
  }
}

function prompt_tag() {
  const saved = localStorage.getItem('matrix.tag');
  if (saved) return saved;
  const word = pickRandom([
    'neo', 'trinity', 'morpheus', 'oracle', 'cypher', 'tank', 'dozer', 'switch',
    'mouse', 'apoc', 'niobe', 'ghost', 'sati', 'seraph', 'kid',
  ]);
  const tag = `${word}_${Math.random().toString(36).slice(2, 5)}`;
  localStorage.setItem('matrix.tag', tag);
  return tag;
}

function pickRandom(a) { return a[Math.floor(Math.random() * a.length)]; }

function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  // bias toward green/cyan/amber so it stays Matrix-y
  const palette = ['#00ff41', '#39ff14', '#39ffd1', '#9eff00', '#ffb000', '#ff8a00'];
  return palette[Math.abs(h) % palette.length];
}
