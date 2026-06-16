// Client mirror of the world ontology. Server is source of truth, this is for instant render.
// Each district is a "node" of the Matrix. Color hex is what the beacon emits.

export const DISTRICTS = [
  {
    id: 'zion',
    name: 'Zion Dock',
    color: '#00ff41',
    direction: [ 0,  1,  0],   // north pole
    description: 'Last free city. Mail comes in raw.',
  },
  {
    id: 'construct',
    name: 'The Construct',
    color: '#9eff00',
    direction: [ 1,  0.2,  0],
    description: 'Loading program. Anything you can imagine, you can deliver.',
  },
  {
    id: 'mainframe',
    name: 'Mainframe Spire',
    color: '#39ff14',
    direction: [-0.6,  0.3,  0.8],
    description: 'Sysadmin tower. Bureaucratic agents stamp the packets.',
  },
  {
    id: 'loop',
    name: 'The Loop',
    color: '#39ffd1',
    direction: [ 0.8, -0.3, -0.6],
    description: 'Recursive suburb. Couriers from the future leave you notes.',
  },
  {
    id: 'source',
    name: 'The Source',
    color: '#ffb000',
    direction: [-0.7, -0.4, -0.5],
    description: 'Where every package goes to be born and to die.',
  },
  {
    id: 'oracle',
    name: 'The Oracle’s Kitchen',
    color: '#ff8a00',
    direction: [ 0,  -1,  0],   // south pole
    description: 'Cookies, prophecies, gossip. Pickup on the counter.',
  },
];

export const DELIVERY_TYPES = [
  { id: 'redpill',  label: 'Redpill cache',    weight: 0.4,  reward: 30 },
  { id: 'bluepill', label: 'Bluepill memo',    weight: 0.2,  reward: 10 },
  { id: 'glitch',   label: 'Glitch fragment',  weight: 1.2,  reward: 60 },
  { id: 'kernel',   label: 'Kernel update',    weight: 0.8,  reward: 45 },
  { id: 'whisper',  label: "Oracle's whisper", weight: 0.05, reward: 25 },
  { id: 'agent_smith', label: 'Cursed packet', weight: 0.6,  reward: -5 },
];

// Multi-body gravity field. Net acceleration = Σ G·M_i / |r-c_i|² toward c_i.
// G is in our toy units (m³ kg⁻¹ s⁻²·c) — tuned so that with PLANETS[0] alone
// the surface acceleration equals the legacy `gravity = 28 m/s²`:
//
//     g_surface = G · M / R²   ⇒   G = g · R² / M = 28 · 50² / 250_000 = 0.28
//
// Anyone who needs the old single-planet `gravity` constant can still read it;
// physics code now reads PLANETS + G instead.
export const G = 0.28;

export const PLANETS = [
  {
    id:     'zion',
    mass:   250_000,        // toy kg
    radius: 50,             // m  (visual + collision)
    position: [   0, 0, 0],
  },
  {
    id:     'construct',
    mass:   180_000,        // a bit lighter
    radius: 38,
    position: [ 180, 0, 0], // 180 m east of Zion
  },
];

export const PHYSICS = {
  planet_radius: 50,        // legacy single-planet alias (== PLANETS[0].radius)
  gravity: 28,               // legacy surface gravity at PLANETS[0] (derived; not used by sphere-physics anymore)
  jump_force: 12,            // m/s radial impulse
  walk_speed: 9,             // m/s tangential
  air_friction: 0.0,
  ground_friction: 0.8,
  G,
  planets: PLANETS,
};
