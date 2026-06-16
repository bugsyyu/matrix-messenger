# IAP v0.1 — Security Notes & Threat Model

> What follows is what I actually looked at and tested, not a marketing list.
> Vectors I patched are marked **MITIGATED**. Vectors I deliberately left in
> are marked **ACCEPTED** with the rationale. Vectors I haven't fully closed
> are marked **WEAK** so a buyer can decide whether to ship without them.

The reference implementation is in [`src/`](src/); evidence for each row
below is a passing test in [`test/`](test/) or a fuzz round in
[`test/fuzz.test.mjs`](test/fuzz.test.mjs).

---

## Trust boundaries

Three actors, four assets at risk:

| actor | controls | wants |
|---|---|---|
| **sender / receiver** (party A or B of a channel) | own private key; can sign anything | maximize own end-balance; defend against the other party's misbehavior |
| **arbiter** | clock + entry table; not a key holder | enforce the protocol; correctly resolve `request_close` / `challenge` / `settle` |
| **observer** | own `TrustBook` | reach a calibrated belief about a subject's reliability |

Assets at risk: **channel balance**, **trust score integrity**, **liveness**, **availability of the arbiter**.

---

## Attack vectors

| # | vector | status | evidence |
|---|---|---|---|
| 1 | **replay**: re-submit an already-applied transfer | **MITIGATED** | `Channel.apply` requires `seq === latest.seq + 1`; replay yields a seq-skip error. Tested in [`test/channel.test.mjs`](test/channel.test.mjs). |
| 2 | **seq skip**: jump from seq=N to seq=N+5 to fast-forward | **MITIGATED** | same `+1` check; tested. |
| 3 | **forged signature** (wrong bytes, right length) | **MITIGATED** | Ed25519 `verify` returns false; rejected at both `Channel.apply` and `Arbiter._validateClaim`. Tested in [`test/challenge.test.mjs`](test/challenge.test.mjs). |
| 4 | **stale close**: settle on an old (lower seq) signed state | **MITIGATED** | `Arbiter.requestClose` accepts any signed state; `challenge()` with higher seq replaces it. Tested: attacker submits seq=42 on a seq=100 history, defender challenges, payouts use seq=100 — attacker extracts zero extra value. |
| 4a | **stale close at challenge-window edge** (T-ε submission) | **MITIGATED** | each successful challenge halves remaining time (`challenge_reset_ms`, capped at 3 resets). DESIGN §2.1. |
| 5 | **forge a settle with no prior open** | **MITIGATED** | `Arbiter.settle` requires an entry in its closing table; entries only land via `requestClose`, which validates both signatures against the open channel's pubkeys. |
| 6 | **double-spend**: send two transfers with the same seq to two different recipients | **MITIGATED** | a channel is **bilateral** — only two parties have keys, and both sign every transfer. To "send to a third party" you'd need a third pubkey on the channel, which `Channel` doesn't accept. |
| 7 | **self-payment loop** to inflate sender balance | **MITIGATED** | `Channel` constructor throws on `partyA.agentId === partyB.agentId`. |
| 8 | **negative deposit**, **negative amount**, **negative balance** | **MITIGATED for deposit & balance** (`< 0` checks in constructor + `apply`); **PARTIAL for amount** — fixed during the audit, see §Patches below. |
| 9 | **amount = 0** transfer (spammy no-op to fatigue observer) | **ACCEPTED**, won't move balances; receiver can refuse to counter-sign if they consider it abuse. |
| 10 | **balance overflow** (sum > Number.MAX_SAFE_INTEGER) | **WEAK**: JS numbers go non-injective above 2^53. With micro-units this is one quadrillion units per channel — fine for our scale. Documented; mitigated only by amount cap in the SDK. To upgrade, switch state machine to BigInt. |
| 11 | **channel-id collision after server restart** | **MITIGATED** during the audit — switched from a process-global counter to `crypto.randomBytes(8).toString('hex')`. See §Patches. |
| 12 | **arbiter clock manipulation** (skewed system clock) | **ACCEPTED**: the arbiter is **the** time source for its channels; a Byzantine arbiter can already steal everything. Out of scope until we replace the in-process arbiter with an on-chain contract. |
| 13 | **DOS the arbiter** with many concurrent `requestClose` calls | **WEAK**: no rate limit. In-process arbiter is single-threaded so requests serialize; in a federated deploy, the contract is anti-DOS by gas pricing. |
| 14a | **Sybil swarm pollutes another observer's TrustBook** | **MITIGATED-by-design**: `TrustBook` is per-observer. `observe(observer, subject, ...)` only writes to `byObserver.get(observer)`. A million Sybils each running their own TrustBook cannot mutate *mine*. |
| 14b | **Sybil swarm fabricates a fake history that I then observe** | **WEAK — corrected after review**: an attacker controlling N pubkeys can stage N successful-looking channels among themselves; if I observe each one as `success`, my EWMA will push the target's score toward 1.0. The protocol cannot tell "100 honest users transacting once" from "1 attacker wearing 100 masks transacting with itself". Mitigations available but **not built in v0.1**: weight an observation by my trust in *the other counterparty too*, or require independent observers — both deserve their own eigentrust-style design pass. **Buyers using this in adversarial settings should not feed third-party-reported outcomes into `TrustBook.observe`; only feed outcomes you witnessed yourself.** |
| 15 | **observer self-observation** to game one's own score | **MITIGATED**: `TrustBook.observe` throws when `observer === subject`. |
| 16 | **outcome forgery**: observer reports `fail` for a transfer that actually settled | **WEAK**: the receiver is the only honest source of an outcome, and they can lie. The protocol's defense is that *anyone reading the score* should weight observations by their own trust in that observer. Not built; out of scope for v0.1. |
| 17 | **timestamp manipulation** in transfers | **ACCEPTED**: `ts` is in the signed body; lying about it changes the hash. It is not a balance-affecting field, so there is no incentive to fudge. Receivers may refuse to counter-sign if `ts` looks adversarial. |
| 18 | **forged signature with valid Ed25519 byte length** | **MITIGATED**: tested with `'00'.repeat(64)` — `Arbiter._validateClaim` returns `claim has bad signature from <id>`. |
| 19 | **race: simultaneous request_close from both sides** | **MITIGATED**: `requestClose` throws on `entries.has(id)`; second caller gets `already closing`. Both sides can still `challenge` afterward. |
| 20 | **negotiated downgrade** (force `arbiter.windowMs = 0` via config) | **ACCEPTED**: config is supplied at instantiation; both parties can read the arbiter's config and refuse to deposit. Out of scope as a wire-level concern. |

---

## Patches landed during this audit

- **#8 amount-direction fix**:
  `Channel.buildNext` now rejects `amount <= 0` *before* the sufficient-balance check. Previously a negative `amount` would pass the `curBal[sender] < amount` check (since `curBal >= 0 > negative`) and silently transfer from recipient to sender. Caught by review, not fuzz, but added a fuzz round and a unit test.
- **#11 channel-id collision fix**:
  switched from `let _nonce = 0; const newNonce = () => _nonce++;` to a 64-bit random nonce. Old behaviour collided after process restart because the same `(partyA, partyB, 0)` URN would be regenerated and `Arbiter.entries` would still hold the old (settled) entry forever.
- **#14 Sybil row split**:
  the first SECURITY.md draft glossed `Sybil swarm` as a single MITIGATED row. Splitting it produced 14a (per-observer storage, which IS protected) and 14b (counterparty-history fabrication, which IS NOT protected by `TrustBook` and never was). Row 14b is a real `WEAK`, not by-design mitigation. Discovered during external review, not fuzz; the fuzz harness never asks "is this score *justified*?", only "is the score in [0,1]?", so this class of attack is invisible to the current harness by construction.

Both code patches (#8, #11) have unit tests **and** are part of the random search in `test/fuzz.test.mjs`. The doc fix (#14) does not change code — it changes the buyer's mental model, which is itself part of the security envelope.

---

## Out of scope (declared, not hand-waved)

- on-chain anchoring (DESIGN §4)
- HTLC routing across channels (DESIGN §4)
- privacy / zk (DESIGN §4)
- federated trust aggregation (#14 above)
- censorship-resistant settlement (single arbiter is a single point of failure by construction)

---

## Reproducing the audit

```bash
npm run test:payment    # 50+ unit assertions across ontology / channel / challenge / trust
node payment-protocol/test/fuzz.test.mjs               # 5 000 rounds, default seed
SEED=<integer> node payment-protocol/test/fuzz.test.mjs   # reproduce a finding
```

Fuzz finds nothing → exit 0 + summary printed.
Fuzz finds a divergence → prints the seed, the round number, the operation that broke the invariant, and the failing state in JSON.

Validated over **15 000 rounds across 5 seeds** (1 / 42 / 1337 / 99999 / 0xDEADBEEF): 0 violations of invariants I1–I8.

### What this audit does NOT cover

- **Semantic Sybil** (#14b above). The fuzz harness asks "is the score in [0, 1]?" not "is the score *justified*?". A run where I am fed 100 self-dealing transfers among Sybils and I report all as success will pass every invariant in the fuzz harness while my belief about the subject becomes wildly wrong. This is a property the *caller* of `observe()` must defend — see the v0.1 buyer guidance in row 14b.
- **On-chain settlement integrity**. The in-process arbiter is by definition trusted; an audit of a real on-chain replacement is out of scope until that contract exists.
- **Cryptographic primitives**. We rely on Node's `webcrypto` Ed25519. If Node's implementation is broken, this protocol is broken; we do not re-derive their guarantees.
- **Side-channel / timing leaks**. We compare signatures with `subtle.verify` (constant-time by Node's promise) but balance arithmetic is not constant-time, so a co-tenant with cycle-counter access on a shared VM can in principle infer transaction patterns. Not addressed.
