// Sphere-walking physics. Local "up" is the position vector from planet center.
// Player has tangential velocity that stays on the sphere; jump adds radial velocity.
import { Vector3, Quaternion, Matrix4 } from 'three';

const _up = new Vector3();
const _right = new Vector3();
const _forward = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();

export class SphereWalker {
  constructor({ radius = 50, gravity = 28, jumpForce = 12, speed = 9 } = {}) {
    this.radius = radius;
    this.gravity = gravity;
    this.jumpForce = jumpForce;
    this.speed = speed;
    this.position = new Vector3(0, radius + 1, 0);
    this.velocity = new Vector3();         // tangent velocity (world space)
    this.altitudeVel = 0;                  // radial velocity (signed)
    this.heading = 0;                      // yaw around local up (radians)
    this.grounded = false;
    this.lastGroundedAt = 0;
  }

  /** input: {forward:-1..1, strafe:-1..1, yaw:radians, jump:bool}, dt seconds */
  step(input, dt) {
    _up.copy(this.position).normalize();

    // build local frame from heading
    this.heading += input.yaw ?? 0;
    // pick a stable world axis to derive right
    const axis = Math.abs(_up.y) < 0.95 ? Math.abs(_up.x) < 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    _right.copy(axis).cross(_up).normalize();
    _forward.copy(_up).cross(_right).normalize();
    // rotate forward/right by heading around up
    _q.setFromAxisAngle(_up, this.heading);
    _forward.applyQuaternion(_q);
    _right.applyQuaternion(_q);

    // tangential desired velocity
    const tx = (input.forward ?? 0) * this.speed;
    const ty = (input.strafe ?? 0) * this.speed;
    const tangent = _forward.clone().multiplyScalar(tx).addScaledVector(_right, ty);
    // smooth toward desired
    this.velocity.lerp(tangent, Math.min(1, dt * 8));

    // jump
    if (input.jump && this.grounded) {
      this.altitudeVel = this.jumpForce;
      this.grounded = false;
    }

    // gravity
    this.altitudeVel -= this.gravity * dt;

    // integrate
    this.position.addScaledVector(this.velocity, dt);
    this.position.addScaledVector(_up, this.altitudeVel * dt);

    // clamp to sphere surface (no clipping through)
    const r = this.position.length();
    if (r < this.radius) {
      this.position.setLength(this.radius);
      this.altitudeVel = 0;
      this.grounded = true;
      this.lastGroundedAt = performance.now();
    } else if (Math.abs(r - this.radius) < 0.05 && this.altitudeVel <= 0) {
      this.position.setLength(this.radius);
      this.altitudeVel = 0;
      this.grounded = true;
      this.lastGroundedAt = performance.now();
    } else {
      this.grounded = false;
    }

    return { position: this.position, up: _up.clone(), forward: _forward.clone(), right: _right.clone() };
  }

  /** Convenient orientation quaternion (for the avatar to stand "up" on the planet). */
  getOrientation(out = new Quaternion()) {
    _up.copy(this.position).normalize();
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
