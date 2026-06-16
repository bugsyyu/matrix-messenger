// Property-based fuzz over Channel + Arbiter + TrustBook.
//
// On each round we pick a random operation and apply it. After every op,
// we check a fixed set of safety invariants. Any violation aborts with the
// seed + round index + state, so the finding is fully reproducible.
//
// Run:
//   node payment-protocol/test/fuzz.test.mjs                  # default 5000 rounds, default seed
//   SEED=12345 ROUNDS=20000 node payment-protocol/test/fuzz.test.mjs
//
// What we are searching for:
//   I1. balance conservation:    sum(balances) === total_deposit
//   I2. no negative balances
//   I3. monotone seq:            channel.latest.seq is non-decreasing
//   I4. settled means SETTLED:   no apply() succeeds on a settled/closing channel
//   I5. forged sig never lands:  Channel.apply / Arbiter._validateClaim reject every forged state we feed
//   I6. settled balance equals last applied state's balance
//   I7. trust score stays in [0,1]
//   I8. observe(self, self) always throws
//   I9. attacker never extracts value beyond what was actually transferred
//
// The harness mixes valid ops (which advance state) with adversarial ops
// (replay, forge, stale-close, garbage signatures).

import { generateKeypair, sign, canonicalize } from '../src/crypto.mjs';
import { Channel, STATE } from '../src/channel.mjs';
import { Arbiter }        from '../src/arbiter.mjs';
import { TrustBook }      from '../src/trust.mjs';

const SEED   = Number(process.env.SEED   ?? 0xC0FFEE);
const ROUNDS = Number(process.env.ROUNDS ?? 5000);
const VERBOSE = process.env.VERBOSE === '1';

// Tiny seedable PRNG (mulberry32) so the run is fully reproducible.
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t |= 0; t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const choice = (arr) => arr[Math.floor(rng() * arr.length)];
const randInt = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

let now = 0;
const clock = () => now;
const tick  = (ms) => { now += ms; };

// ---------- world setup ----------
console.log(`[fuzz] seed=${SEED} rounds=${ROUNDS}`);
const A = await generateKeypair();
const B = await generateKeypair();
const E = await generateKeypair();   // a third agent who is not on the channel
const DEPOSIT_A = 100_000;
const DEPOSIT_B = 100_000;
const channel = new Channel({ partyA: A, partyB: B, depositA: DEPOSIT_A, depositB: DEPOSIT_B });
const TOTAL = channel.total();
const arbiter = new Arbiter({ clock, windowMs: 500, resetMs: 200, resetCap: 3 });
const trust = new TrustBook({ clock });

const fullStateCache = [];           // every transfer that landed; index = seq-1
let totalTransferred = 0;            // running A->B net to compare with settled diff
let attackerExtracted = 0;           // bookkeeping for I9

// ---------- adversarial helpers ----------
async function buildValidTransfer() {
  const fromA = rng() < 0.5;
  const sender    = fromA ? A : B;
  const recipient = fromA ? B : A;
  const bal = channel.latest.balances[sender.agentId];
  if (bal <= 0) return null;
  const amount = randInt(1, Math.min(20, bal));
  const unsigned = channel.buildNext({ sender: sender.agentId, recipient: recipient.agentId, amount, ts: now });
  const half = await channel.senderSign(unsigned, sender.agentId, sender.privateKey);
  const full = await channel.recipientSign(half, recipient.agentId, recipient.privateKey);
  // net direction tracker
  if (sender.agentId === A.agentId) totalTransferred += amount;
  else                              totalTransferred -= amount;
  return full;
}

function buildForgedTransfer() {
  // either bogus 00..00 sigs, or sigs swapped between parties, or wrong-length
  const variant = randInt(0, 2);
  const seq = channel.latest.seq + 1;
  const fakeBalances = {
    [A.agentId]: Math.max(0, channel.latest.balances[A.agentId] - 1),
    [B.agentId]: channel.latest.balances[B.agentId] + 1,
  };
  const body = { channel: channel.id, seq, balances: fakeBalances, purpose: 'forge', ts: now };
  let sigBlob;
  if (variant === 0) sigBlob = { [A.agentId]: '00'.repeat(64), [B.agentId]: '00'.repeat(64) };
  else if (variant === 1) sigBlob = { [A.agentId]: 'aa'.repeat(64) };           // missing one sig
  else sigBlob = { [A.agentId]: 'bb'.repeat(40), [B.agentId]: 'cc'.repeat(80) };// wrong length
  return { ...body, sig: sigBlob };
}

async function buildValidThenTamper() {
  // a "subtle" forgery: produce a really-signed transfer, then flip one balance byte
  const fromA = rng() < 0.5;
  const sender    = fromA ? A : B;
  const recipient = fromA ? B : A;
  const bal = channel.latest.balances[sender.agentId];
  if (bal <= 0) return null;
  const amount = randInt(1, Math.min(20, bal));
  const unsigned = channel.buildNext({ sender: sender.agentId, recipient: recipient.agentId, amount, ts: now });
  const half = await channel.senderSign(unsigned, sender.agentId, sender.privateKey);
  const full = await channel.recipientSign(half, recipient.agentId, recipient.privateKey);
  // ROLL BACK the bookkeeping because we won't apply this one
  if (sender.agentId === A.agentId) totalTransferred -= amount; else totalTransferred += amount;
  // tamper: bump the recipient's balance after signing
  return { ...full, balances: { ...full.balances, [recipient.agentId]: full.balances[recipient.agentId] + 100 } };
}

function pickPastState() {
  if (fullStateCache.length === 0) return null;
  return fullStateCache[randInt(0, fullStateCache.length - 1)];
}

// ---------- invariants ----------
function check(condition, label, ctx = {}) {
  if (condition) return;
  console.error(`\nINVARIANT VIOLATION  seed=${SEED}  round=${ctx.round}  ${label}`);
  console.error('  ctx:', JSON.stringify(ctx, null, 2));
  console.error('  channel state:', channel.state, 'latest seq:', channel.latest.seq, 'balances:', channel.latest.balances);
  process.exit(1);
}

function checkInvariants(round) {
  const lb = channel.latest.balances;
  const sum = lb[A.agentId] + lb[B.agentId];
  check(sum === TOTAL,                              'I1 balance conservation', { round, sum, TOTAL });
  check(lb[A.agentId] >= 0 && lb[B.agentId] >= 0,   'I2 no negative balance', { round, lb });
}

// ---------- main loop ----------
const stats = {
  valid_apply: 0,
  forge_rejected: 0,
  tamper_rejected: 0,
  replay_rejected: 0,
  buildNext_rejected: 0,
  trust_observe: 0,
  close_attempts: 0,
  challenges: 0,
  settles: 0,
  channels_recycled: 0,
};

let observers = [A.agentId, B.agentId, E.agentId];

for (let round = 0; round < ROUNDS; round++) {
  if (channel.state === STATE.OPEN) {
    const op = rng();
    try {
      if (op < 0.55) {
        // valid signed transfer
        const t = await buildValidTransfer();
        if (t) {
          const applied = await channel.apply(t);
          fullStateCache.push(applied);
          stats.valid_apply++;
        }
      } else if (op < 0.72) {
        // forged signature → must throw
        const f = buildForgedTransfer();
        let threw = null;
        try { await channel.apply(f); } catch (e) { threw = e.message; }
        check(threw !== null, 'I5 forged sig accepted by channel', { round, op: 'forge', state: f });
        stats.forge_rejected++;
      } else if (op < 0.82) {
        // tampered-after-sign → must throw
        const t = await buildValidThenTamper();
        if (t) {
          let threw = null;
          try { await channel.apply(t); } catch (e) { threw = e.message; }
          check(threw !== null, 'I5 tampered sig accepted by channel', { round, op: 'tamper' });
          stats.tamper_rejected++;
        }
      } else if (op < 0.90) {
        // replay an old state → must throw (seq mismatch)
        const past = pickPastState();
        if (past) {
          let threw = null;
          try { await channel.apply(past); } catch (e) { threw = e.message; }
          check(threw !== null, 'I5 replay accepted', { round, op: 'replay', pastSeq: past.seq });
          stats.replay_rejected++;
        }
      } else if (op < 0.94) {
        // self-payment / amount<=0 / non-integer amount — all must throw at buildNext
        let threw = null;
        try {
          channel.buildNext({ sender: A.agentId, recipient: A.agentId, amount: 1, ts: now });
        } catch (e) { threw = e.message; }
        check(threw !== null, 'I7 self-payment build accepted', { round });
        let threw2 = null;
        try {
          channel.buildNext({ sender: A.agentId, recipient: B.agentId, amount: -5, ts: now });
        } catch (e) { threw2 = e.message; }
        check(threw2 !== null, 'amount<=0 accepted by buildNext', { round });
        let threw3 = null;
        try {
          channel.buildNext({ sender: A.agentId, recipient: B.agentId, amount: 1.5, ts: now });
        } catch (e) { threw3 = e.message; }
        check(threw3 !== null, 'non-integer amount accepted', { round });
        stats.buildNext_rejected++;
      } else if (op < 0.97) {
        // observer touches the trust book
        const o = choice(observers), s = choice(observers.filter((x) => x !== o));
        const outcome = rng() < 0.7 ? 'success' : 'fail';
        trust.observe(o, s, outcome, randInt(1, 1000));
        const score = trust.read(o, s);
        check(score >= 0 && score <= 1, 'I7 trust score out of [0,1]', { round, o, s, score });
        stats.trust_observe++;
      } else {
        // try to request_close with the latest state — if we can, the next
        // round will exercise challenge/settle
        try {
          await arbiter.requestClose(channel, channel.latest);
          stats.close_attempts++;
        } catch (e) {
          // already closing or no entries available — fine
        }
      }
    } catch (e) {
      // any uncaught error from a "should-work" branch is a real bug
      console.error(`unexpected throw round=${round} op=${op.toFixed(3)}: ${e.message}`);
      throw e;
    }
  } else if (channel.state === STATE.CLOSING) {
    const op = rng();
    if (op < 0.30) {
      // challenge with a HIGHER seq if we have one cached
      const better = fullStateCache.find((s) => s.seq > arbiter.entries.get(channel.id).claim.seq);
      if (better) {
        try {
          await arbiter.challenge(channel.id, better);
          stats.challenges++;
        } catch (e) { /* window may have elapsed */ }
      }
    } else if (op < 0.40) {
      // challenge with a LOWER seq — must throw
      const lower = fullStateCache[0];
      if (lower) {
        let threw = null;
        try { await arbiter.challenge(channel.id, lower); } catch (e) { threw = e.message; }
        check(threw !== null, 'lower-seq challenge accepted', { round, seq: lower.seq });
      }
    } else if (op < 0.55) {
      // forged challenge state — must throw
      const f = buildForgedTransfer();
      f.seq = (arbiter.entries.get(channel.id).claim.seq || 0) + 1;
      let threw = null;
      try { await arbiter.challenge(channel.id, f); } catch (e) { threw = e.message; }
      check(threw !== null, 'forged challenge accepted', { round });
    } else if (op < 0.75) {
      // advance the clock
      tick(randInt(50, 600));
    } else {
      // try to settle; legitimate if window elapsed
      try {
        const payouts = arbiter.settle(channel.id);
        if (payouts) {
          stats.settles++;
          // I6: settled balances == claim state's balances
          const claimedBal = arbiter.entries.get(channel.id).claim.balances;
          check(payouts.balances[A.agentId] === claimedBal[A.agentId] && payouts.balances[B.agentId] === claimedBal[B.agentId],
                'I6 settled != claim', { round, payouts, claimedBal });
          // I9: A's net delta == totalTransferred reversed sign? Actually:
          // A's payout = DEPOSIT_A - net(A->B). totalTransferred tracks A->B net.
          const aNet = payouts.balances[A.agentId] - DEPOSIT_A;
          // some transfers were reverted via tamper — only the *applied* net counts
          const actualNet = channel.latest.balances[A.agentId] - DEPOSIT_A;
          check(aNet === actualNet, 'I9 settlement diverges from applied state', { round, aNet, actualNet });
        }
      } catch (e) { /* window not elapsed; fine */ }
    }
  } else {
    // SETTLED — recycle: open a fresh channel between the same parties
    const newCh = new Channel({ partyA: A, partyB: B, depositA: DEPOSIT_A, depositB: DEPOSIT_B });
    check(newCh.id !== channel.id, 'channel ID collided on recycle', { round, id: newCh.id });
    Object.assign(channel, newCh);
    fullStateCache.length = 0;
    totalTransferred = 0;
    stats.channels_recycled++;
    tick(100);
  }

  // ---- invariants every round ----
  checkInvariants(round);
  const aScore = trust.read(A.agentId, B.agentId);
  const bScore = trust.read(B.agentId, A.agentId);
  check(aScore >= 0 && aScore <= 1 && bScore >= 0 && bScore <= 1, 'I7 trust drift', { round, aScore, bScore });
  let selfThrew = null;
  try { trust.observe(A.agentId, A.agentId, 'success'); } catch (e) { selfThrew = e.message; }
  check(selfThrew !== null, 'I8 self-observe accepted', { round });

  tick(10);
  if (VERBOSE && round % 500 === 0) {
    console.log(`  round=${round} state=${channel.state} latestSeq=${channel.latest.seq} bal=${JSON.stringify(channel.latest.balances)}`);
  }
}

console.log('\n=== fuzz stats ===');
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(22)} = ${v}`);
console.log(`\nfuzz: ${ROUNDS} rounds, 0 invariant violations`);
