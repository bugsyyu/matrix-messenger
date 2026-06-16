// Phase 1 #1 — real radial gravity (G·M/r²) + semi-implicit Euler.
//
// Three required assertions (per ROADMAP):
//   A. Single-planet free fall from height h matches analytic t = sqrt(2h / g_surface)
//      within 5 %.
//   B. Player held at the midpoint of two equal-mass planets feels ≤ 0.1 % of
//      the surface acceleration of either planet (the gravity sum cancels).
//   C. Acceleration decays as 1/r²: doubling distance => 1/4 the acceleration.
//
// Plus a 4th smoke check (not in the original 3 but cheap evidence the integrator
// is symplectic): a circular orbit's energy drift stays bounded over 1000 steps.
import { Vector3 } from 'three';
import { gravityAt, dominantPlanet, SphereWalker } from '../src/systems/sphere-physics.js';

const fails = [];
const ok   = (m) => console.log('ok  ', m);
const fail = (m) => { fails.push(m); console.error('FAIL', m); };

const G = 0.28;
const M = 250_000;
const R = 50;
const g_surface = G * M / (R * R);              // = 28.0 m/s² by construction

// ---------- A. analytic free fall (small h so g-variation negligible) ----------
//
// Note: t = sqrt(2h/g) only holds when g is constant during the fall. In a
// real radial 1/r² field, g at altitude h is G·M/(R+h)² which is *smaller*
// than g_surface, so the real fall time is *longer* than the constant-g
// formula predicts. We therefore use h << R (h/R ≈ 1%) so g-variation
// across the fall is < 2 %, and the 5 % tolerance comfortably catches both
// integrator error and the residual g-variation.
{
  const h = 0.5;                                // 1 % of R = 50  ⇒  g varies ~2 %
  const planets = [{ id: 'p', mass: M, radius: R, position: [0, 0, 0] }];
  const startY = R + h;
  const pos = new Vector3(0, startY, 0);
  const vel = new Vector3(0, 0, 0);
  const accel = new Vector3();
  const dt = 0.0005;
  let t = 0;
  while (pos.y > R) {
    gravityAt(pos, planets, G, accel);
    vel.addScaledVector(accel, dt);             // semi-implicit Euler
    pos.addScaledVector(vel, dt);
    t += dt;
    if (t > 10) { fail('A: fall did not complete in 10s'); break; }
  }
  if (pos.y < R) {
    const overshoot = R - pos.y;
    const stepDy = Math.abs(vel.y) * dt;
    if (stepDy > 0) t -= dt * (overshoot / stepDy);
  }
  const tAnalytic = Math.sqrt(2 * h / g_surface);
  const err = Math.abs(t - tAnalytic) / tAnalytic;
  if (err < 0.05) ok(`A: free fall t=${t.toFixed(5)}s vs constant-g analytic ${tAnalytic.toFixed(5)}s (err ${(err*100).toFixed(2)}%)`);
  else            fail(`A: free fall error ${(err*100).toFixed(2)}% > 5%`);
}

// ---------- B. midpoint between two equal-mass planets ----------
{
  const sep = 400;                              // 400 m apart
  const planets = [
    { id: 'a', mass: M, radius: R, position: [-sep/2, 0, 0] },
    { id: 'b', mass: M, radius: R, position: [ sep/2, 0, 0] },
  ];
  const accel = gravityAt(new Vector3(0, 0, 0), planets, G);
  const mag = accel.length();
  // each planet at distance sep/2 contributes |a_i| = G·M/(sep/2)²
  // by symmetry they cancel; what's left is integrator/float noise
  const oneSideMag = G * M / ((sep/2) ** 2);
  const ratio = mag / oneSideMag;
  if (ratio < 0.001) ok(`B: midpoint net |a| = ${mag.toExponential(3)} m/s² vs single-side ${oneSideMag.toFixed(4)} (ratio ${(ratio*100).toExponential(2)} %)`);
  else               fail(`B: midpoint net |a| ratio ${ratio} > 0.001`);

  // sanity: shift 1 m toward A — should now point toward A (negative x)
  const shifted = gravityAt(new Vector3(-1, 0, 0), planets, G);
  if (shifted.x < 0) ok(`B': 1m toward A, net a.x = ${shifted.x.toFixed(3)} m/s² (points toward A as expected)`);
  else               fail(`B': shifted accel should point toward A but x=${shifted.x}`);
}

// ---------- C. r² decay ----------
{
  const planets = [{ id: 'p', mass: M, radius: R, position: [0, 0, 0] }];
  // measure |a| at r and at 2r, both well outside the radius
  const r1 = 200, r2 = 400;
  const a1 = gravityAt(new Vector3(r1, 0, 0), planets, G).length();
  const a2 = gravityAt(new Vector3(r2, 0, 0), planets, G).length();
  const ratio = a1 / a2;                         // should be 4
  const err = Math.abs(ratio - 4) / 4;
  if (err < 0.001) ok(`C: a(r)/a(2r) = ${ratio.toFixed(4)} (expected 4.0; err ${(err*100).toExponential(2)} %)`);
  else             fail(`C: r² decay broken, ratio=${ratio} expected 4`);
}

// ---------- D. integrator energy bound over 1000 steps ----------
// Symplectic integrators must keep total energy bounded — energy may oscillate
// but cannot drift monotonically (unlike forward Euler).
{
  const planets = [{ id: 'p', mass: M, radius: R, position: [0, 0, 0] }];
  // place a test particle in a circular orbit at r=200
  const r0 = 200;
  const vCirc = Math.sqrt(G * M / r0);          // sqrt(GM/r)
  const pos = new Vector3(r0, 0, 0);
  const vel = new Vector3(0, 0, vCirc);
  const accel = new Vector3();
  const dt = 0.01;
  const N = 1000;
  const energy = (p, v) => 0.5 * v.lengthSq() - G * M / p.length();
  const E0 = energy(pos, vel);
  let Emin = E0, Emax = E0;
  for (let i = 0; i < N; i++) {
    gravityAt(pos, planets, G, accel);
    vel.addScaledVector(accel, dt);             // semi-implicit Euler
    pos.addScaledVector(vel, dt);
    const E = energy(pos, vel);
    if (E < Emin) Emin = E;
    if (E > Emax) Emax = E;
  }
  // total energy is negative (bound orbit); drift = (Emax - Emin) / |E0|
  const drift = (Emax - Emin) / Math.abs(E0);
  if (drift < 0.05) ok(`D: 1000-step orbit energy band = ${(drift*100).toFixed(3)} % of |E0| (symplectic-good)`);
  else              fail(`D: energy band ${(drift*100).toFixed(3)} % > 5% — integrator non-symplectic`);
}

// ---------- E. SphereWalker self-test: lands on planet, grounded ----------
{
  const planets = [{ id: 'p', mass: M, radius: R, position: [0, 0, 0] }];
  const w = new SphereWalker({ planets, gConst: G });
  // drop the walker from height 2 m above surface, no input
  w.position.set(0, R + 2, 0);
  w.velocity.set(0, 0, 0);
  for (let i = 0; i < 1000; i++) {
    w.step({ forward: 0, strafe: 0, yaw: 0, jump: false }, 0.01);
    if (w.grounded) break;
  }
  if (w.grounded) ok(`E: SphereWalker dropped 2m, grounded after fall (position |r|=${w.position.length().toFixed(3)} vs R=${R})`);
  else            fail('E: SphereWalker never grounded after 10s fall');

  const domNow = dominantPlanet(w.position, planets, G);
  if (domNow && domNow.id === 'p') ok(`E': dominant planet at landed pos = ${domNow.id}`);
  else                              fail('E\': dominant planet wrong');
}

if (fails.length) {
  console.error(`\n${fails.length} failure(s)`);
  process.exit(1);
}
console.log('\nphysics.test.mjs OK — semi-implicit Euler + G·M/r² + multi-body summation all green');
