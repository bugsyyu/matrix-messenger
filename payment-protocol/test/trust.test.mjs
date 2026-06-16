// TrustScore behavior under realistic histories.
// Per DESIGN §6 acceptance:
//   - 50 successes / 0 failures  -> score > 0.85
//   - then 5 consecutive failures -> score < 0.50
//   - 48h idle                     -> decays toward cold_start (0.30 ± 0.05)
import { TrustBook } from '../src/trust.mjs';

const fails = [];
const ok   = (m) => console.log('ok  ', m);
const fail = (m) => { fails.push(m); console.error('FAIL', m); };

let now = 0;
const tb = new TrustBook({
  clock: () => now,
  // identical to defaults but pinned here so the test is hermetic
  coldStart: 0.30, alpha: 0.18, weightCap: 5,
  decayGraceMs: 3_600_000, decayHalflifeMs: 86_400_000,
});

const observer = 'obs', good = 'good', bad = 'bad';

// cold-start
const initial = tb.read(observer, good);
if (Math.abs(initial - 0.30) < 1e-9) ok(`cold-start read = ${initial}`);
else fail(`cold-start should be 0.30, got ${initial}`);

// 50 successes
for (let i = 0; i < 50; i++) { tb.observe(observer, good, 'success', 1); now += 60_000; }
const afterGood = tb.read(observer, good);
console.log(`  score after 50 success: ${afterGood.toFixed(3)}`);
if (afterGood > 0.85) ok(`50 successes -> score ${afterGood.toFixed(3)} > 0.85`);
else fail(`expected > 0.85, got ${afterGood.toFixed(3)}`);

const det = tb.details(observer, good);
if (det.n_succ === 50 && det.n_fail === 0) ok(`counts ok: succ=${det.n_succ} fail=${det.n_fail}`);
else fail(`counts: ${JSON.stringify(det)}`);

// 5 consecutive failures
for (let i = 0; i < 5; i++) { tb.observe(observer, good, 'fail', 1); now += 60_000; }
const afterFail = tb.read(observer, good);
console.log(`  score after 5 fail (post 50 succ): ${afterFail.toFixed(3)}`);
if (afterFail < 0.50) ok(`5 failures collapse score to ${afterFail.toFixed(3)} < 0.50`);
else fail(`expected < 0.50, got ${afterFail.toFixed(3)}`);

// 48h idle decays toward cold_start
const beforeDecay = afterFail;
now += 48 * 3_600_000;
const afterDecay = tb.read(observer, good);
console.log(`  score after 48h idle: ${afterDecay.toFixed(3)}`);
if (Math.abs(afterDecay - 0.30) < 0.05) ok(`48h decay -> ${afterDecay.toFixed(3)} within 0.05 of 0.30`);
else fail(`48h decay should be near 0.30, got ${afterDecay.toFixed(3)}`);
if (afterDecay > beforeDecay) ok(`decay moved score UP from ${beforeDecay.toFixed(3)} to ${afterDecay.toFixed(3)} (because pre-decay was below cold_start)`);
// could also be moving down — either direction toward 0.30 is correct

// Negative path: a brand-new "bad" agent gets pummeled
now += 1000;
for (let i = 0; i < 10; i++) { tb.observe(observer, bad, 'fail', 1); now += 60_000; }
const badScore = tb.read(observer, bad);
console.log(`  score for new bad agent after 10 fail: ${badScore.toFixed(3)}`);
if (badScore < 0.20) ok(`10 failures from cold start -> ${badScore.toFixed(3)} < 0.20`);
else fail(`expected < 0.20, got ${badScore.toFixed(3)}`);

// Weight: a single high-value success outweighs noise more than a $1 one
const tb2 = new TrustBook({ clock: () => now, coldStart: 0.30, alpha: 0.18, weightCap: 5 });
const smallScore = tb2.observe('o', 'u_small', 'success', 1);
const bigScore   = tb2.observe('o', 'u_big',   'success', 1_000_000);
console.log(`  small-tx delta: ${(smallScore - 0.30).toFixed(3)}  big-tx delta: ${(bigScore - 0.30).toFixed(3)}`);
if (bigScore > smallScore) ok(`big-value tx pushes score harder (${bigScore.toFixed(3)} > ${smallScore.toFixed(3)})`);
else fail(`weighting failed`);

// Self-observation must reject
let selfErr = null;
try { tb.observe('x', 'x', 'success', 1); } catch (e) { selfErr = e.message; }
if (selfErr) ok(`self-observation rejected: ${selfErr}`); else fail('self-obs should reject');

// Decay floor: very-long-idle score reverts ALL the way (within tiny epsilon)
const tbDecay = new TrustBook({ clock: () => 0, coldStart: 0.30, alpha: 0.18, decayGraceMs: 0, decayHalflifeMs: 1_000 });
tbDecay.observe('o', 's', 'success', 1);
const fresh = tbDecay.read('o', 's');
tbDecay.clock = () => 1_000_000;     // millions of half-lives
const decayed = tbDecay.read('o', 's');
console.log(`  fresh=${fresh.toFixed(3)}  long-idle=${decayed.toFixed(6)}`);
if (Math.abs(decayed - 0.30) < 1e-6) ok(`very-long idle reverts to cold_start exactly: ${decayed.toFixed(6)}`);
else fail(`long idle didn't revert: ${decayed}`);

if (fails.length) { console.error('\n' + fails.length + ' failures'); process.exit(1); }
console.log('\ntrust score behavior OK across history paths');
