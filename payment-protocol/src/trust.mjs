// Observer-side TrustScore: EWMA with time decay toward cold_start.
// See DESIGN §3 for the math + rationale.
import { WORLD } from './ontology.mjs';

const P = WORLD.trust_params;

const clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

export class TrustBook {
  /**
   * @param {object} opts
   * @param {() => number} [opts.clock]
   * @param {number} [opts.coldStart]
   * @param {number} [opts.alpha]
   * @param {number} [opts.weightCap]
   * @param {number} [opts.decayGraceMs]
   * @param {number} [opts.decayHalflifeMs]
   */
  constructor(opts = {}) {
    this.clock          = opts.clock ?? (() => Date.now());
    this.coldStart      = opts.coldStart      ?? P.cold_start;
    this.alpha          = opts.alpha          ?? P.alpha;
    this.weightCap      = opts.weightCap      ?? P.weight_cap;
    this.decayGraceMs   = opts.decayGraceMs   ?? P.decay_grace_ms;
    this.decayHalflifeMs= opts.decayHalflifeMs?? P.decay_halflife_ms;
    this.observed = new Set();        // (subject) we've seen
    this.byObserver = new Map();      // observer -> Map(subject -> {score, ts, n_succ, n_fail})
  }

  _entry(observer, subject) {
    let m = this.byObserver.get(observer);
    if (!m) { m = new Map(); this.byObserver.set(observer, m); }
    let e = m.get(subject);
    if (!e) {
      e = { score: this.coldStart, ts: this.clock(), n_succ: 0, n_fail: 0 };
      m.set(subject, e);
    }
    return e;
  }

  /**
   * Update observer's trust about subject given a transfer outcome.
   * @param {string} observer  agentId
   * @param {string} subject   agentId
   * @param {'success'|'fail'} outcome
   * @param {number} [valueMicro]  optional weight via amount
   */
  observe(observer, subject, outcome, valueMicro = 1) {
    if (observer === subject) throw new Error('cannot observe self');
    const e = this._entry(observer, subject);
    // bring `e.score` up to the present by applying decay before mixing in news
    e.score = this._decayed(e.score, e.ts);
    e.ts = this.clock();

    // base strength = ±2.5 so a single sigmoid maps to ~0.92 / ~0.08, then
    // weight (log-scaled by tx value, capped) further amplifies it.
    const weight = clip(1 + Math.log10(Math.max(1, valueMicro)) / 2, 1, this.weightCap);
    const base   = 2.5;
    const delta  = (outcome === 'success' ? +1 : -1) * base * weight;
    const evidence = sigmoid(delta);
    e.score = clip(e.score * (1 - this.alpha) + this.alpha * evidence);

    if (outcome === 'success') e.n_succ += 1; else e.n_fail += 1;
    return e.score;
  }

  /** Read with time decay applied. Non-mutating. */
  read(observer, subject) {
    const m = this.byObserver.get(observer);
    if (!m) return this.coldStart;
    const e = m.get(subject);
    if (!e) return this.coldStart;
    return this._decayed(e.score, e.ts);
  }

  details(observer, subject) {
    const m = this.byObserver.get(observer);
    if (!m) return { score: this.coldStart, n_succ: 0, n_fail: 0, age_ms: 0, cold: true };
    const e = m.get(subject);
    if (!e) return { score: this.coldStart, n_succ: 0, n_fail: 0, age_ms: 0, cold: true };
    return {
      score: this._decayed(e.score, e.ts),
      raw_score: e.score,
      n_succ: e.n_succ,
      n_fail: e.n_fail,
      age_ms: this.clock() - e.ts,
      cold: false,
    };
  }

  _decayed(score, lastTs) {
    const age = this.clock() - lastTs;
    if (age <= this.decayGraceMs) return score;
    // exponential decay of (score - coldStart) with given halflife
    const overflow = age - this.decayGraceMs;
    const factor = Math.pow(0.5, overflow / this.decayHalflifeMs);
    return this.coldStart + (score - this.coldStart) * factor;
  }
}
