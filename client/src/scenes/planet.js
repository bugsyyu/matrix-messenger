// The Matrix planet: a sphere wireframe + glyph crust + 6 districts marked with vertical beacons.
import {
  Mesh, SphereGeometry, IcosahedronGeometry, MeshBasicMaterial, LineSegments,
  WireframeGeometry, Color, Group, BufferGeometry, BufferAttribute, PointsMaterial,
  Points, Vector3, CylinderGeometry, MeshStandardMaterial, AmbientLight,
  DirectionalLight, AdditiveBlending, ShaderMaterial, BackSide,
} from 'three';
import { DISTRICTS } from '../ontology/world.js';

export function buildPlanet(scene, { radius = 50 } = {}) {
  const root = new Group();
  root.name = 'planet';
  scene.add(root);

  // core sphere — black with rim
  const core = new Mesh(
    new IcosahedronGeometry(radius, 4),
    new MeshStandardMaterial({
      color: new Color('#001a0c'),
      emissive: new Color('#003816'),
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true,
    })
  );
  core.castShadow = false;
  core.receiveShadow = true;
  root.add(core);

  // Wireframe overlay (the iconic Matrix grid)
  const wire = new LineSegments(
    new WireframeGeometry(new IcosahedronGeometry(radius * 1.001, 5)),
    new MeshBasicMaterial({ color: new Color('#00ff41'), transparent: true, opacity: 0.35 })
  );
  root.add(wire);

  // "Code particles" floating just above the surface
  const cnt = 4000;
  const pgeo = new BufferGeometry();
  const pos = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    const v = new Vector3().randomDirection().multiplyScalar(radius + 0.4 + Math.random() * 6);
    pos[i*3+0] = v.x; pos[i*3+1] = v.y; pos[i*3+2] = v.z;
  }
  pgeo.setAttribute('position', new BufferAttribute(pos, 3));
  const dust = new Points(pgeo, new PointsMaterial({
    color: 0x39ff14, size: 0.18, transparent: true, opacity: 0.55,
    depthWrite: false, blending: AdditiveBlending,
  }));
  root.add(dust);

  // Atmosphere shader — soft green Fresnel halo
  const atmo = new Mesh(
    new SphereGeometry(radius * 1.07, 32, 32),
    new ShaderMaterial({
      uniforms: { tint: { value: new Color('#00ff41') } },
      transparent: true,
      depthWrite: false,
      side: BackSide,
      vertexShader: /* glsl */`
        varying vec3 vN;
        void main() {
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vN;
        uniform vec3 tint;
        void main() {
          float f = pow(1.0 - dot(vN, vec3(0.0,0.0,1.0)), 3.0);
          gl_FragColor = vec4(tint, f * 0.7);
        }`,
    })
  );
  root.add(atmo);

  // District beacons — vertical pillars marking each region
  const beacons = new Group();
  for (const d of DISTRICTS) {
    const dir = new Vector3(...d.direction).normalize();
    const base = dir.clone().multiplyScalar(radius);
    const beacon = new Mesh(
      new CylinderGeometry(0.25, 0.25, 14, 8, 1, true),
      new MeshBasicMaterial({ color: new Color(d.color), transparent: true, opacity: 0.85 })
    );
    beacon.position.copy(base.clone().addScaledVector(dir, 7));
    beacon.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
    beacon.userData.district = d.id;
    beacons.add(beacon);

    // small disc at the base
    const pad = new Mesh(
      new CylinderGeometry(2.5, 2.5, 0.1, 24),
      new MeshBasicMaterial({ color: new Color(d.color), transparent: true, opacity: 0.35 })
    );
    pad.position.copy(base.clone().addScaledVector(dir, 0.05));
    pad.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
    beacons.add(pad);
  }
  root.add(beacons);

  // Lighting — Matrix is dim
  scene.add(new AmbientLight(0x113322, 0.7));
  const sun = new DirectionalLight(0x66ff99, 0.55);
  sun.position.set(80, 120, 60);
  scene.add(sun);

  // Slow spin
  root.userData.update = (dt) => {
    root.rotation.y += dt * 0.005;
  };

  return { root, core, wire, beacons, radius };
}
