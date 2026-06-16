// Attacker scenario:
//   1. A & B exchange 100 transfers (final seq=100, A paid B 100).
//   2. B (attacker) tries to settle with seq=42 (a state when B's balance was still 58).
//   3. A challenges within the window with the seq=100 signed state.
//   4. After window, settle must use seq=100 state. B can NOT extract more than
//      what was actually transferred. Test asserts loudly if attacker wins.
import { generateKeypair } from '../src/crypto.mjs';
import { Channel, STATE } from '../src/channel.mjs';
import { Arbiter } from '../src/arbiter.mjs';

const fails = [];
const ok   = (m) => console.log('ok  ', m);
const fail = (m) => { fails.push(m); console.error('FAIL', m); };

let now = 0;
const clock = () => now;

const A = await generateKeypair();
const B = await generateKeypair();
const DEPOSIT = 100_000;
const channel = new Channel({ partyA: A, partyB: B, depositA: DEPOSIT, depositB: DEPOSIT, nonce: 0 });

const states = [];                  // keep every fully-signed state for the attack
const N = 100;
for (let i = 1; i <= N; i++) {
  const unsigned = channel.buildNext({ sender: A.agentId, recipient: B.agentId, amount: 1, ts: now });
  const half = await channel.senderSign(unsigned, A.agentId, A.privateKey);
  const full = await channel.recipientSign(half, B.agentId, B.privateKey);
  states.push(await channel.apply(full));
  now += 1;
}
ok(`prepared ${N} signed states, latest seq=${states[N-1].seq}`);

// ---- attacker (B) request_close with an old (seq=42) state ----
const stale = states[41];           // seq=42  (A paid 42, B had +42)
const fresh = states[N - 1];        // seq=100 (A paid 100, B had +100)
const arbiter = new Arbiter({ clock, windowMs: 100, resetMs: 50, resetCap: 3 });

// IMPORTANT: stale must still be a fully-signed state — it is, B signed it back when it happened.
const claim = await arbiter.requestClose(channel, stale);
ok(`attacker B request_close with stale seq=${stale.seq} balance(B)=${stale.balances[B.agentId]}`);
if (claim.claim.seq === 42) ok('arbiter accepts stale (valid signature)'); else fail('arbiter should accept signed state');

// ---- A challenges with fresh seq=100 state ----
const before = arbiter.status(channel.id);
const cresp = await arbiter.challenge(channel.id, fresh);
const after  = arbiter.status(channel.id);
ok(`A challenge accepted: new claim seq=${cresp.claim.seq}, resets=${cresp.resets}`);
if (cresp.claim.seq === 100) ok('claim replaced by seq=100'); else fail('claim should be 100');
if (after.deadline <= before.deadline) ok(`deadline halved: ${before.deadline} -> ${after.deadline}`);
else fail('deadline should not extend');

// Attacker tries to re-submit the stale state — must fail (seq not strictly greater)
let dup = null;
try { await arbiter.challenge(channel.id, stale); } catch (e) { dup = e.message; }
if (dup) ok(`attacker re-submit stale rejected: ${dup}`); else fail('stale re-submit should fail');

// Premature settle must fail
let early = null;
try { arbiter.settle(channel.id); } catch (e) { early = e.message; }
if (early) ok(`early settle rejected: ${early}`); else fail('early settle should be rejected');

// Wait window out and settle
now = after.deadline + 1;
const payouts = arbiter.settle(channel.id);
if (payouts.finalSeq === 100) ok(`settle uses seq=100, attacker lost`);
else fail(`attacker would have won: finalSeq=${payouts.finalSeq}`);
if (payouts.balances[B.agentId] === DEPOSIT + N) ok(`B payout = deposit + ${N} (only what was actually paid)`);
else fail(`B payout should be ${DEPOSIT + N}, got ${payouts.balances[B.agentId]}`);

// Crisp safety statement
const attackerProfit = payouts.balances[B.agentId] - (DEPOSIT + N);
if (attackerProfit === 0) ok(`attacker extracted ZERO extra value (exactly the honest amount)`);
else fail(`SECURITY: attacker extracted ${attackerProfit} extra units`);

// ---- second scenario: forged claim on a FRESH channel cannot be opened ----
const A2 = await generateKeypair(), B2 = await generateKeypair();
const ch2 = new Channel({ partyA: A2, partyB: B2, depositA: DEPOSIT, depositB: DEPOSIT, nonce: 1 });
const arb2 = new Arbiter({ clock, windowMs: 100 });
const forged = {
  channel: ch2.id,
  seq: 999,
  balances: { [A2.agentId]: 0, [B2.agentId]: DEPOSIT * 2 },
  purpose: 'forged',
  ts: 0,
  sig: { [A2.agentId]: '00'.repeat(64), [B2.agentId]: '00'.repeat(64) },
};
let forgedErr = null;
try { await arb2.requestClose(ch2, forged); } catch (e) { forgedErr = e.message; }
if (forgedErr && /bad signature/.test(forgedErr)) ok(`forged signature rejected by arbiter: ${forgedErr}`);
else fail(`forged claim should be rejected for bad signature; got: ${forgedErr}`);

if (fails.length) { console.error('\n' + fails.length + ' failures'); process.exit(1); }
console.log('\nchallenge defense OK (attacker cannot rewind, cannot forge)');
