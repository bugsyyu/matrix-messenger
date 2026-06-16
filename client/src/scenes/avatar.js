// Stylized low-poly avatar: capsule body + cylinder head + glowing eye band.
import {
  Group, Mesh, CapsuleGeometry, CylinderGeometry, SphereGeometry,
  MeshStandardMaterial, MeshBasicMaterial, Color, Vector3, Quaternion, BoxGeometry,
} from 'three';

export function buildAvatar({ color = '#00ff41', label = '' } = {}) {
  const root = new Group();

  const bodyMat = new MeshStandardMaterial({
    color: new Color('#001a0c'),
    emissive: new Color(color),
    emissiveIntensity: 0.4,
    roughness: 0.6,
    metalness: 0.1,
    flatShading: true,
  });

  const body = new Mesh(new CapsuleGeometry(0.5, 1.0, 4, 8), bodyMat);
  body.position.y = 1.0;
  root.add(body);

  const head = new Mesh(new CylinderGeometry(0.42, 0.42, 0.55, 12), bodyMat);
  head.position.y = 1.95;
  root.add(head);

  // glowing eye band
  const eyeBand = new Mesh(
    new BoxGeometry(0.86, 0.1, 0.86),
    new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity: 0.95 })
  );
  eyeBand.position.y = 2.0;
  root.add(eyeBand);

  // small backpack — for the deliveries
  const pack = new Mesh(
    new BoxGeometry(0.5, 0.6, 0.3),
    new MeshStandardMaterial({ color: new Color('#003816'), emissive: new Color('#001a0c') })
  );
  pack.position.set(0, 1.3, -0.4);
  root.add(pack);

  // floating "carrying" cube above the head when delivering
  const carryCube = new Mesh(
    new BoxGeometry(0.45, 0.45, 0.45),
    new MeshBasicMaterial({ color: new Color('#ffb000'), wireframe: true })
  );
  carryCube.position.y = 2.7;
  carryCube.visible = false;
  root.add(carryCube);

  root.userData = { color, label, head, eyeBand, carryCube };
  return root;
}

const _up = new Vector3();
const _q = new Quaternion();
const _qb = new Quaternion();

/** Re-orient avatar so its feet are on the planet surface and it faces along `forward`. */
export function alignToPlanet(avatar, position, forward, planetRadius) {
  _up.copy(position).normalize();
  avatar.position.copy(_up).multiplyScalar(planetRadius);
  // local Y = up
  _q.setFromUnitVectors(new Vector3(0, 1, 0), _up);
  // yaw around up to face `forward`
  const localForward = new Vector3(0, 0, -1).applyQuaternion(_q);
  const target = forward.clone().normalize();
  // project both onto tangent plane
  const lf = localForward.clone().sub(_up.clone().multiplyScalar(localForward.dot(_up))).normalize();
  const tf = target.clone().sub(_up.clone().multiplyScalar(target.dot(_up))).normalize();
  const dot = Math.max(-1, Math.min(1, lf.dot(tf)));
  const cross = lf.clone().cross(tf).dot(_up);
  const ang = Math.atan2(cross, dot);
  _qb.setFromAxisAngle(_up, ang);
  avatar.quaternion.copy(_qb.multiply(_q));
}
