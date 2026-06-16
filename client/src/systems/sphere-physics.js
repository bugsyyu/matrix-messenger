// Multi-body sphere physics.
//   Net acceleration = Σ G·M_i / |r-c_i|² toward c_i
//   Integrator       = semi-implicit (symplectic) Euler:
//                          v ← v + a(r) · dt
//                          r ← r + v · dt
//   The "up" axis used for character orientation is -normalize(net force);
//   collision is detected against the *dominant* attractor (the planet whose
//   gravity term has the largest magnitude at the player's current position).
//
// Why semi-implicit (rather than forward Euler):
//   forward Euler injects spurious energy each step — orbits spiral outward
//   no matter how small dt gets. Swapping the two update lines makes the
//   integrator symplectic; energy oscillates but does not drift. Two-line
//   change, structurally different correctness — see test/physics.test.mjs.
import { Vector3, Quaternion, Matrix4 } from 'three';
import { G, PLANETS } from '../ontology/world.js';

const _up      = new Vector3();
const _right   = new Vector3();
const _forward = new Vector3();
const _m       = new Matrix4();
const _q       = new Quaternion();
const _accel   = new Vector3();
const _tmp     = new Vector3();

/**
 * Compute net gravitational acceleration at a world position from a set of bodies.
 * @param {Vector3} positionOut – mutated in-place if `out` provided, else returns new Vector3
 * @param {Vector3} worldPos
 * @param {Array<{position:[number,number,number], mass:number}>} planets
 * @param {number} G
 * @returns {Vector3}
 */
export function gravityAt(worldPos, planets, gConst, out = new Vector3()) {
  out.set(0, 0, 0);
  for (const p of planets) {
    _tmp.set(p.position[0], p.position[1], p.position[2]).sub(worldPos);
    const r2 = _tmp.lengthSq();
    if (r2 < 1e-6) continue;            // singular: skip
    const invR = 1 / Math.sqrt(r2);
    const a = gConst * p.mass / r2;     // magnitude
    out.addScaledVector(_tmp, a * invR); // _tmp / |_tmp| = unit toward p
  }
  return out;
}

/** Return the planet whose gravity contribution at `worldPos` is largest. */
export function dominantPlanet(worldPos, planets, gConst) {
  let best = null, bestMag = -Infinity;
  for (const p of planets) {
    _tmp.set(p.position[0], p.position[1], p.position[2]).sub(worldPos);
    const r2 = _tmp.lengthSq();
    if (r2 < 1e-6) continue;
    const mag = gConst * p.mass / r2;
    if (mag > bestMag) { bestMag = mag; best = p; }
  }
  return best;
}

export class SphereWalker {
  constructor({ planets = PLANETS, gConst = G, jumpForce = 12, speed = 9, startPlanetId = null } = {}) {
    this.planets = planets;
    this.G = gConst;
    this.jumpForce = jumpForce;
    this.speed = speed;
    // start on the first planet's north pole unless told otherwise
    const start = startPlanetId
      ? planets.find((p) => p.id === startPlanetId) ?? planets[0]
      : planets[0];
    const c = start.position;
    this.position = new Vector3(c[0], c[1] + start.radius + 1, c[2]);
    this.velocity = new Vector3();
    this.heading = 0;
    this.currentPlanet = start;          // tracked for HUD/quest layer; physics is forces only
    this.grounded = false;
    this.lastGroundedAt = 0;
  }

  /**
   * Step physics by dt seconds.
   * input: {forward:-1..1, strafe:-1..1, yaw:radians, jump:bool}
   */
  step(input, dt) {
    // ---- 1. work out local frame (up = -net gravity direction) ----
    gravityAt(this.position, this.planets, this.G, _accel);
    if (_accel.lengthSq() < 1e-12) {
      // free fall in null field — keep last up
      _up.copy(this.position).sub(_tmp.set(this.currentPlanet.position[0], this.currentPlanet.position[1], this.currentPlanet.position[2])).normalize();
    } else {
      _up.copy(_accel).normalize().negate();
    }

    this.heading += input.yaw ?? 0;
    const axis = Math.abs(_up.y) < 0.95
      ? new Vector3(0, 1, 0)
      : new Vector3(1, 0, 0);
    _right.copy(axis).cross(_up).normalize();
    _forward.copy(_up).cross(_right).normalize();
    _q.setFromAxisAngle(_up, this.heading);
    _forward.applyQuaternion(_q);
    _right.applyQuaternion(_q);

    // ---- 2. desired tangent velocity from input (player intent) ----
    const tx = (input.forward ?? 0) * this.speed;
    const ty = (input.strafe  ?? 0) * this.speed;
    const desiredTangent = _forward.clone().multiplyScalar(tx).addScaledVector(_right, ty);

    // ---- 3. project current velocity onto tangent + radial (relative to dominant up) ----
    const radialVelMag = this.velocity.dot(_up);         // signed
    const tangentVel = this.velocity.clone().addScaledVector(_up, -radialVelMag);

    // smooth tangent toward desired
    tangentVel.lerp(desiredTangent, Math.min(1, dt * 8));

    // jump impulse only when grounded
    let newRadialVel = radialVelMag;
    if (input.jump && this.grounded) {
      newRadialVel = this.jumpForce;
      this.grounded = false;
    }

    // rebuild velocity (tangent + radial in local frame)
    this.velocity.copy(tangentVel).addScaledVector(_up, newRadialVel);

    // ---- 4. semi-implicit Euler:   v ← v + a·dt   ;   r ← r + v·dt ----
    this.velocity.addScaledVector(_accel, dt);
    this.position.addScaledVector(this.velocity, dt);

    // ---- 5. collision against dominant planet (sphere surface) ----
    const dom = dominantPlanet(this.position, this.planets, this.G);
    if (dom) {
      this.currentPlanet = dom;
      _tmp.set(dom.position[0], dom.position[1], dom.position[2]);
      const toCenter = this.position.clone().sub(_tmp);
      const r = toCenter.length();
      if (r < dom.radius) {
        // clamp out to surface
        toCenter.setLength(dom.radius);
        this.position.copy(_tmp).add(toCenter);
        // kill velocity component pointing into the surface
        const surfaceNormal = toCenter.normalize();
        const into = this.velocity.dot(surfaceNormal);
        if (into < 0) this.velocity.addScaledVector(surfaceNormal, -into);
        this.grounded = true;
        this.lastGroundedAt = performance.now();
      } else if (Math.abs(r - dom.radius) < 0.05) {
        // resting on surface
        const surfaceNormal = toCenter.normalize();
        const into = this.velocity.dot(surfaceNormal);
        if (into < 0) this.velocity.addScaledVector(surfaceNormal, -into);
        this.grounded = true;
        this.lastGroundedAt = performance.now();
      } else {
        this.grounded = false;
      }
    } else {
      this.grounded = false;
    }

    return {
      position: this.position,
      up: _up.clone(),
      forward: _forward.clone(),
      right: _right.clone(),
      grounded: this.grounded,
      planet: this.currentPlanet,
    };
  }

  getOrientation(out = new Quaternion()) {
    gravityAt(this.position, this.planets, this.G, _accel);
    if (_accel.lengthSq() > 1e-12) _up.copy(_accel).normalize().negate();
    else _up.set(0, 1, 0);
    const axis = Math.abs(_up.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    _right.copy(axis).cross(_up).normalize();
    _forward.copy(_up).cross(_right).normalize();
    _q.setFromAxisAngle(_up, this.heading);
    _forward.applyQuaternion(_q);
    _right.applyQuaternion(_q);
    _m.makeBasis(_right, _up, _forward.clone().negate());
    return out.setFromRotationMatrix(_m);
  }
}
