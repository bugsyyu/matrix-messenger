// 100 micropayments A -> B; both sign each one; one settlement; balances reconcile exactly.
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
ok(`generated keypairs: A=${A.agentId.slice(0,6)} B=${B.agentId.slice(0,6)}`);

const DEPOSIT_A = 100_000;        // micro-units
const DEPOSIT_B = 100_000;
const channel = new Channel({ partyA: A, partyB: B, depositA: DEPOSIT_A, depositB: DEPOSIT_B, nonce: 0 });
ok(`channel opened id=${channel.id.slice(-12)} total=${channel.total()}`);

const N = 100;
let lastSigned = null;
for (let i = 1; i <= N; i++) {
  const unsigned = channel.buildNext({ sender: A.agentId, recipient: B.agentId, amount: 1, purpose: `tx_${i}`, ts: now });
  const halfSigned = await channel.senderSign(unsigned, A.agentId, A.privateKey);
  const fullySigned = await channel.recipientSign(halfSigned, B.agentId, B.privateKey);
  lastSigned = await channel.apply(fullySigned);
  now += 1;
}
ok(`applied ${N} signed transfers`);

// Balances after 100 single-unit payments A->B
const after = channel.latest.balances;
if (after[A.agentId] === DEPOSIT_A - N) ok(`A balance = ${after[A.agentId]} (deposit - N)`);
else fail(`A balance ${after[A.agentId]} != expected ${DEPOSIT_A - N}`);
if (after[B.agentId] === DEPOSIT_B + N) ok(`B balance = ${after[B.agentId]} (deposit + N)`);
else fail(`B balance ${after[B.agentId]} != expected ${DEPOSIT_B + N}`);
if (after[A.agentId] + after[B.agentId] === DEPOSIT_A + DEPOSIT_B) ok('balance sum invariant held');
else fail('sum drift');

// Replay protection: trying to re-apply the same seq must fail
let replayErr = null;
try { await channel.apply(lastSigned); } catch (e) { replayErr = e.message; }
if (replayErr) ok(`replay rejected: ${replayErr}`); else fail('replay should have been rejected');

// Skip / out-of-order: jump to seq+5 must fail
let skipErr = null;
const skipUnsigned = { ...lastSigned, seq: lastSigned.seq + 5 };
try { await channel.apply(skipUnsigned); } catch (e) { skipErr = e.message; }
if (skipErr) ok(`seq skip rejected: ${skipErr}`); else fail('skip should have been rejected');

// ---- settle path: one party request_close, no challenge, window elapses ----
const arbiter = new Arbiter({ clock, windowMs: 100, resetMs: 50, resetCap: 3 });
const reqResp = await arbiter.requestClose(channel, lastSigned);
ok(`close requested deadline=${reqResp.deadline} (now=${now})`);
if (channel.state === STATE.CLOSING) ok('channel state = CLOSING');
else fail(`expected CLOSING got ${channel.state}`);

// premature settle must fail
let earlySettle = null;
try { arbiter.settle(channel.id); } catch (e) { earlySettle = e.message; }
if (earlySettle) ok(`early settle rejected: ${earlySettle}`); else fail('early settle should have been rejected');

now += 200;     // past window
const payouts = arbiter.settle(channel.id);
if (channel.state === STATE.SETTLED) ok('channel state = SETTLED');
else fail(`expected SETTLED got ${channel.state}`);
if (payouts.balances[A.agentId] === DEPOSIT_A - N && payouts.balances[B.agentId] === DEPOSIT_B + N) {
  ok(`payout balances reconcile: A=${payouts.balances[A.agentId]} B=${payouts.balances[B.agentId]}`);
} else {
  fail(`payout mismatch: ${JSON.stringify(payouts.balances)}`);
}
const idempotent = arbiter.settle(channel.id);
if (idempotent && idempotent.finalSeq === payouts.finalSeq) ok('settle is idempotent');
else fail('settle not idempotent');

if (fails.length) { console.error('\n' + fails.length + ' failures'); process.exit(1); }
console.log('\nchannel happy path OK (100 micropayments -> 1 settlement, balances exact)');
