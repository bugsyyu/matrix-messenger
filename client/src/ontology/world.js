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

export const PHYSICS = {
  planet_radius: 50,
  gravity: 28,        // m/s^2 toward planet center
  jump_force: 12,     // m/s radial impulse
  walk_speed: 9,      // m/s tangential
  air_friction: 0.0,
  ground_friction: 0.8,
};
