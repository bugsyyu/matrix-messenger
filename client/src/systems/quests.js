// Local quest engine. The server-side ontology defines schemas, the client picks one and tracks it.
import { Vector3 } from 'three';
import { DISTRICTS, DELIVERY_TYPES } from '../ontology/world.js';

export class QuestEngine extends EventTarget {
  constructor({ planetRadius = 50 } = {}) {
    super();
    this.planetRadius = planetRadius;
    this.active = null;
    this.completed = 0;
    this.reputation = 0;
  }

  /** Pick a new random delivery quest from a→b. */
  spawn() {
    const from = DISTRICTS[Math.floor(Math.random() * DISTRICTS.length)];
    let to;
    do { to = DISTRICTS[Math.floor(Math.random() * DISTRICTS.length)]; } while (to.id === from.id);
    const type = weightedPick(DELIVERY_TYPES);

    this.active = {
      id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      from: from.id, fromName: from.name, fromPos: dirToPos(from.direction, this.planetRadius),
      to: to.id,     toName: to.name,     toPos:   dirToPos(to.direction,   this.planetRadius),
      type: type.id, typeLabel: type.label, reward: type.reward,
      stage: 'pickup', // → 'deliver' → 'complete'
      pickedUpAt: 0, completedAt: 0,
    };
    this.dispatchEvent(new CustomEvent('spawn', { detail: this.active }));
    return this.active;
  }

  /** Called each frame with the player position. */
  update(playerPos) {
    if (!this.active) return null;
    const a = this.active;
    if (a.stage === 'pickup' && playerPos.distanceTo(a.fromPos) < 4.5) {
      a.stage = 'deliver';
      a.pickedUpAt = performance.now();
      this.dispatchEvent(new CustomEvent('pickup', { detail: a }));
    } else if (a.stage === 'deliver' && playerPos.distanceTo(a.toPos) < 4.5) {
      a.stage = 'complete';
      a.completedAt = performance.now();
      this.completed += 1;
      this.reputation += a.reward;
      this.dispatchEvent(new CustomEvent('complete', { detail: a }));
      this.active = null;
    }
    return a;
  }

  cancel() {
    if (!this.active) return;
    this.dispatchEvent(new CustomEvent('cancel', { detail: this.active }));
    this.active = null;
  }
}

function weightedPick(items) {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function dirToPos(dir, radius) {
  const v = new Vector3(...dir);
  v.normalize().multiplyScalar(radius);
  return v;
}
