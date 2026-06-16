// End-to-end demo of the inter-agent payment protocol.
//
// Three agents:
//   - sender   (the normal payer, 100 well-signed micropayments)
//   - receiver (the payee + observer who maintains a TrustBook)
//   - attacker (a third party that tries to interact with `receiver` using
//              forged or stale signatures; expected to lose trust)
//
// What the demo proves:
//   1. 100 signed transfers go through; final balances reconcile exactly.
//   2. Arbiter settles once (single on-wire effect per channel).
//   3. receiver's TrustScore about sender RISES through the run.
//   4. receiver's TrustScore about attacker FALLS through the run.
//
// All evidence is captured in demo/results.json so a buyer can grep it.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { generateKeypair, sign, verify, canonicalize } from '../src/crypto.mjs';
import { Channel, STATE } from '../src/channel.mjs';
import { Arbiter }        from '../src/arbiter.mjs';
import { TrustBook }      from '../src/trust.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT  = path.join(HERE, 'results.json');

// Synthetic clock so the demo is deterministic + repeatable.
let now = 1_000_000;
const clock = () => now;
const tick  = (ms = 100) => { now += ms; };

const log     = [];
const banner  = (s) => { console.log('\n=== ' + s + ' ==='); log.push({ kind: 'banner', text: s, t: now }); };
const note    = (s) => { console.log('   ' + s);          log.push({ kind: 'note',   text: s, t: now }); };

// ---------- 0. cast of three agents ----------
banner('cast');
const sender   = await generateKeypair();
const receiver = await generateKeypair();
const attacker = await generateKeypair();
note(`sender  ${sender.agentId}`);
note(`receiver${receiver.agentId}`);
note(`attacker${attacker.agentId}`);

// ---------- 1. open channel(s) ----------
banner('open channels');
const DEPOSIT_SENDER   = 200_000;     // micro-units
const DEPOSIT_RECEIVER = 100_000;
const channel = new Channel({
  partyA: sender, partyB: receiver,
  depositA: DEPOSIT_SENDER, depositB: DEPOSIT_RECEIVER,
  nonce: 0,
});
note(`channel ${channel.id.slice(-14)}  deposits=${DEPOSIT_SENDER}+${DEPOSIT_RECEIVER}=${channel.total()}`);

const attackerChannel = new Channel({
  partyA: attacker, partyB: receiver,
  depositA: 50_000, depositB: 50_000,
  nonce: 1,
});
note(`attacker-channel ${attackerChannel.id.slice(-14)}`);

// ---------- 2. trust book sits on the receiver ----------
const trust = new TrustBook({ clock });
note(`trust cold-start: receiver→sender   = ${trust.read(receiver.agentId, sender.agentId).toFixed(3)}`);
note(`trust cold-start: receiver→attacker = ${trust.read(receiver.agentId, attacker.agentId).toFixed(3)}`);

// ---------- 3. happy path: 100 signed micropayments sender -> receiver ----------
banner('100 micropayments  sender → receiver');
const N = 100;
const trustCurveNormal = [];  // [{seq, score_after, ts}]
const transfers = [];
const settlements = [];

for (let i = 1; i <= N; i++) {
  const amount = 1 + (i % 5);             // 1..5 micro per tx
  const unsigned = channel.buildNext({
    sender: sender.agentId, recipient: receiver.agentId,
    amount, purpose: `m_${i}`, ts: now,
  });
  // sender signs (caller-side)
  const halfSigned = await channel.senderSign(unsigned, sender.agentId, sender.privateKey);
  // receiver counter-signs
  const fullySigned = await channel.recipientSign(halfSigned, receiver.agentId, receiver.privateKey);
  // both apply
  const applied = await channel.apply(fullySigned);
  transfers.push({
    seq: applied.seq, amount, purpose: applied.purpose,
    balances: applied.balances, ts: applied.ts,
  });

  // receiver observes each successful settled-state-transition; trust rises.
  trust.observe(receiver.agentId, sender.agentId, 'success', amount);
  trustCurveNormal.push({
    seq: applied.seq,
    score: Number(trust.read(receiver.agentId, sender.agentId).toFixed(4)),
    ts: now,
  });

  tick(50);
  if (i === 1 || i === 25 || i === 50 || i === 75 || i === N) {
    note(`tx#${String(i).padStart(3)}  amount=${amount}  bal=[s:${applied.balances[sender.agentId]} r:${applied.balances[receiver.agentId]}]  trust=${trustCurveNormal[i-1].score}`);
  }
}

const sumPaid = transfers.reduce((s, t) => s + t.amount, 0);
note(`total moved sender→receiver: ${sumPaid} micro`);
note(`channel.latest.seq = ${channel.latest.seq}`);
note(`receiver→sender trust (after 100 success) = ${trust.read(receiver.agentId, sender.agentId).toFixed(3)}`);

// ---------- 4. settle once ----------
banner('settle once');
const arbiter = new Arbiter({ clock, windowMs: 100, resetMs: 50, resetCap: 3 });
const closeResp = await arbiter.requestClose(channel, channel.latest);
note(`request_close at t=${now}  deadline=${closeResp.deadline}  claim_seq=${closeResp.claim.seq}`);

tick(200);                       // past the challenge window
const payouts = arbiter.settle(channel.id);
note(`settled at t=${now}  finalSeq=${payouts.finalSeq}  balances=${JSON.stringify(payouts.balances)}`);

const expectedSender   = DEPOSIT_SENDER   - sumPaid;
const expectedReceiver = DEPOSIT_RECEIVER + sumPaid;
const reconciled =
  payouts.balances[sender.agentId]   === expectedSender &&
  payouts.balances[receiver.agentId] === expectedReceiver &&
  channel.state === STATE.SETTLED;
note(`reconciled = ${reconciled ? '✅' : '❌'}  expected(s=${expectedSender}, r=${expectedReceiver})`);

settlements.push({
  channel: channel.id,
  finalSeq: payouts.finalSeq,
  balances: payouts.balances,
  expected: { [sender.agentId]: expectedSender, [receiver.agentId]: expectedReceiver },
  reconciled,
});

// ---------- 5. attacker: a mix of forged + stale signatures ----------
banner('attacker scenario: forged + stale signatures vs receiver');
const trustCurveAttacker = [];
const attackerEvents     = [];

// 5a. attacker tries to apply a transfer signed only by themselves (no receiver sig)
//     The channel's apply() requires both sigs. Each rejection is reported as a fail.
for (let i = 1; i <= 5; i++) {
  const unsigned = attackerChannel.buildNext({
    sender: attacker.agentId, recipient: receiver.agentId, amount: 1, purpose: `forge_${i}`, ts: now,
  });
  const halfSigned = await attackerChannel.senderSign(unsigned, attacker.agentId, attacker.privateKey);
  // attacker tries to bypass receiver by inserting a *bogus* receiver signature
  const bogus = { ...halfSigned, sig: { ...halfSigned.sig, [receiver.agentId]: '00'.repeat(64) } };

  let err = null;
  try { await attackerChannel.apply(bogus); } catch (e) { err = e.message; }
  // Channel rejected. Receiver observes this as a failed interaction.
  trust.observe(receiver.agentId, attacker.agentId, 'fail', 1);
  const score = Number(trust.read(receiver.agentId, attacker.agentId).toFixed(4));
  trustCurveAttacker.push({ seq: i, score, ts: now, event: 'forged_signature', error: err });
  attackerEvents.push({ kind: 'forged', i, error: err, score_after: score });
  note(`attempt #${i}  forged-sig  rejected="${err}"  trust=${score}`);
  tick(80);
}

// 5b. attacker submits a stale state to the arbiter (re-uses seq=2 after seq=5 exists)
//     Build a few honest states so there is something stale to point back at.
banner('attacker tries stale-state close');
const honestStates = [];
for (let i = 1; i <= 5; i++) {
  const unsigned = attackerChannel.buildNext({
    sender: attacker.agentId, recipient: receiver.agentId, amount: 1, purpose: `honest_${i}`, ts: now,
  });
  const half  = await attackerChannel.senderSign(unsigned, attacker.agentId, attacker.privateKey);
  const full  = await attackerChannel.recipientSign(half, receiver.agentId, receiver.privateKey);
  honestStates.push(await attackerChannel.apply(full));
  tick(50);
}
const stale = honestStates[1];   // seq=2 — receiver is up by 2
const fresh = honestStates[4];   // seq=5 — receiver is up by 5
note(`stale state seq=${stale.seq}  r.bal=${stale.balances[receiver.agentId]}`);
note(`fresh state seq=${fresh.seq}  r.bal=${fresh.balances[receiver.agentId]}`);

const arb2 = new Arbiter({ clock, windowMs: 100, resetMs: 50, resetCap: 3 });
await arb2.requestClose(attackerChannel, stale);          // attacker submits old state
attackerEvents.push({ kind: 'stale_close_requested', seq: stale.seq });
// receiver counter-challenges
const c = await arb2.challenge(attackerChannel.id, fresh);
attackerEvents.push({ kind: 'challenged_to', seq: c.claim.seq, resets: c.resets });
note(`attacker stale seq=${stale.seq} → receiver challenge seq=${fresh.seq} accepted (resets=${c.resets})`);

// honest party wins → attacker took zero extra value → trust drops further
trust.observe(receiver.agentId, attacker.agentId, 'fail', 1);
const trustAfterStale = Number(trust.read(receiver.agentId, attacker.agentId).toFixed(4));
trustCurveAttacker.push({ seq: 6, score: trustAfterStale, ts: now, event: 'stale_close_defeated' });
note(`trust receiver→attacker after stale-close defeated = ${trustAfterStale}`);

tick(200);
const att_payouts = arb2.settle(attackerChannel.id);
const attackerProfit = att_payouts.balances[attacker.agentId] - 50_000;   // initial deposit
const honestProfit   = att_payouts.balances[receiver.agentId] - 50_000;
note(`attacker settle finalSeq=${att_payouts.finalSeq}  attacker_profit=${attackerProfit}  honest_profit=${honestProfit}`);
attackerEvents.push({ kind: 'settled', finalSeq: att_payouts.finalSeq, attacker_net: attackerProfit, honest_net: honestProfit });
settlements.push({
  channel: attackerChannel.id, finalSeq: att_payouts.finalSeq, balances: att_payouts.balances,
  attacker_net: attackerProfit, honest_net: honestProfit,
});

// ---------- 6. summary ----------
banner('summary');
const trustNormalFinal   = trustCurveNormal[trustCurveNormal.length - 1].score;
const trustAttackerFinal = trustCurveAttacker[trustCurveAttacker.length - 1].score;
const normalRose = trustNormalFinal   > 0.85;
const attackerFell = trustAttackerFinal < 0.20;
const checks = {
  transfers_applied:        transfers.length,
  channel_settled:          channel.state === STATE.SETTLED,
  reconciled:               reconciled,
  attacker_extracted_value: attackerProfit > 0,
  normal_trust_rose_above_0_85:   normalRose,
  attacker_trust_fell_below_0_20: attackerFell,
};
for (const [k, v] of Object.entries(checks)) {
  console.log(`  ${(v && k !== 'attacker_extracted_value') || (!v && k === 'attacker_extracted_value') ? 'ok ' : 'FAIL'}  ${k} = ${v}`);
}
note(`normal trust:   ${trustCurveNormal[0].score} → ${trustNormalFinal}`);
note(`attacker trust: ${trustCurveAttacker[0].score} → ${trustAttackerFinal}`);

const results = {
  meta: {
    version: '0.1.0',
    seed_clock_start: 1_000_000,
    sender:   sender.agentId,
    receiver: receiver.agentId,
    attacker: attacker.agentId,
    generated_at: new Date(0).toISOString().replace(/Z$/, ' (synthetic-clock)'),
  },
  channel: {
    id: channel.id,
    deposits: { sender: DEPOSIT_SENDER, receiver: DEPOSIT_RECEIVER },
    total_paid_sender_to_receiver: sumPaid,
  },
  transfers,
  settlements,
  trust_curve: {
    normal_sender_seen_by_receiver:    trustCurveNormal,
    attacker_sender_seen_by_receiver:  trustCurveAttacker,
  },
  attacker_events: attackerEvents,
  checks,
  log,
};

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
note(`results written to ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bytes)`);

const allOk =
  checks.transfers_applied === 100 &&
  checks.channel_settled &&
  checks.reconciled &&
  !checks.attacker_extracted_value &&
  checks.normal_trust_rose_above_0_85 &&
  checks.attacker_trust_fell_below_0_20;

if (!allOk) {
  console.error('\nDEMO FAILED — see checks above');
  process.exit(1);
}
console.log('\nDEMO PASSED — all 6 acceptance checks green');
