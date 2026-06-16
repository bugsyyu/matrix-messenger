// Third-person camera rig that orbits the avatar with the planet's up vector.
import { Vector3 } from 'three';

export class PlanetCameraRig {
  constructor(camera, { distance = 7, height = 3.5, lerp = 0.15 } = {}) {
    this.camera = camera;
    this.distance = distance;
    this.height = height;
    this.lerp = lerp;
    this.up = new Vector3(0, 1, 0);
    this._desired = new Vector3();
    this._tmp = new Vector3();
  }

  update(avatarPos, avatarForward, planetUp) {
    this.up.lerp(planetUp, 0.25);

    const back = avatarForward.clone().multiplyScalar(-this.distance);
    this._desired.copy(avatarPos)
      .add(back)
      .addScaledVector(planetUp, this.height);

    this.camera.position.lerp(this._desired, this.lerp);
    this.camera.up.copy(this.up);

    this._tmp.copy(avatarPos).addScaledVector(planetUp, 1.2);
    this.camera.lookAt(this._tmp);
  }
}
