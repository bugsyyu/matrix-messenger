# Inter-Agent Payment Protocol — DESIGN

> Mirror of the abeto ontology pattern: publish a machine-readable schema at a
> single URL, let any agent ingest it and start transacting in under a minute.
> Three concerns: **identity & state shape (ontology)**, **value transfer
> (off-chain channel)**, **decisions about whom to trust (TrustScore)**.

This document is a **before-code design draft**. Each section names the
choice, the runners-up, and what would make me reopen the decision.

---

## 1. Ontology

### Entities

```
Agent            urn:iap:agent:<id>            — anything that signs requests
Account          urn:iap:account:<agent>/<asset>   — balance bucket per asset
PaymentChannel   urn:iap:channel:<a>/<b>/<nonce>  — bilateral, asset-scoped
Transfer         urn:iap:transfer:<channel>/<seq> — one signed state update
Settlement       urn:iap:settlement:<channel>     — terminal on-chain effect
TrustScore       urn:iap:trust:<observer>/<subject>   — observer's belief
```

### Why these five and not, say, "Wallet" or "Invoice"

- **Wallet** is a UI concern, not a protocol object — folded into Agent.
- **Invoice** is one specific *workflow* on top of Transfer (request-to-pay) — modeled as a `purpose` field on Transfer, not its own class. Re-promote if multiple invoice variants emerge.
- **Asset** stays a string `asset_id` for now (e.g. `USDC`, `XLM`, `tokens`) — promote to a class if we ever need cross-asset routing.

### Relations (RDF-style triples)

```
Agent          mm:owns                Account
Account        mm:participatesIn      PaymentChannel
PaymentChannel mm:between             Agent, Agent           (binary)
PaymentChannel mm:hasState            Transfer               (latest wins)
Transfer       mm:signedBy            Agent                  (both sides)
Settlement     mm:closes              PaymentChannel
TrustScore     mm:observedBy          Agent
TrustScore     mm:about               Agent
TrustScore     mm:basedOn             Transfer*              (witness set)
```

### Action vocabulary (what agents can *do*)

| action       | precondition          | postcondition       | who can call |
|--------------|----------------------|--------------------|--------------|
| `open`       | both agents online    | channel `OPEN`     | either party (both must co-sign deposit) |
| `pay`        | channel `OPEN`        | new `Transfer` appended, both balances updated | counterparty receives, signs back |
| `request_close` | channel `OPEN`     | channel `CLOSING`  | either party |
| `challenge`  | channel `CLOSING` and challenger holds higher-nonce state | replaces tentative state | either party, within window |
| `settle`     | challenge window elapsed | channel `SETTLED` + balances paid | anyone (idempotent) |
| `observe`    | none                  | TrustScore update on the observer side | observer only |

This is the *full* surface area an agent SDK needs to expose.

### Publishing format

- `/payment-ontology` — JSON-LD (W3C RDF; one fetch, agent imports as-is)
- `/payment-ontology.ttl` — Turtle (human-friendlier, same triples)
- `/payment-sdk.js` — drop-in ES module with the wire calls bound to the schema, mirroring abeto's `/agent-sdk.js` pattern

---

## 2. Off-chain channel — settlement model

**Decision: bilateral channel + signed state + N-second challenge window (Lightning-lite).**

### Why not the alternatives

| approach | pro | con | why we don't pick |
|---|---|---|---|
| (a) **unilateral declare** | 1-round, offline-friendly, ~30 LOC | malicious broadcaster picks an old state where their balance was higher → free money | A trust-establishing protocol that itself enables theft is self-defeating. |
| (b) **mandatory co-sign close** | mathematically un-cheatable | counterparty goes offline → funds locked forever | Liveness assumption too strong for an *agent* market where bots disappear, run out of compute credits, get killed by their owner. |
| (c) **challenge window + arbiter** ⭐ | industry standard (Lightning, Raiden); robust under offline | needs a clock and a referee | We're picking this. Demo uses an in-process referee + 5 s window (real chain would use ~24 h). |

### Cynefin / method-family for this choice

- **Cynefin domain: complicated**, not complex. Lightning Network is a well-known solved pattern at production scale; we're scaling it down, not exploring.
- **method_family: divide_and_conquer[functional]**. Three clean responsibilities (channel state machine / settle handler / challenge handler), each a 50-line module. No emergent inter-component dynamics; interfaces are stable.

### Wire shape of a single transfer

```jsonc
// signed by *both* parties, latest signed Transfer is the live state
{
  "channel":  "urn:iap:channel:agentA/agentB/0",
  "seq":      42,                  // strictly increasing per channel
  "balances": { "agentA": 9550, "agentB": 450 },   // in micro-units, always sums to deposit
  "purpose":  "delivery_redpill_qf3",   // optional, free-form
  "ts":       "2026-06-16T20:30:00Z",
  "sig_a":    "<ed25519(sender state)>",
  "sig_b":    "<ed25519(recipient ack)>"
}
```

### Settlement state machine

```
OPEN  --request_close-->  CLOSING(claim=<last-known state>)
         |
         | challenge(state' with seq' > seq):  claim := state'
         |  (resets timer? — see §2.1)
         v
         (window expires)
        --settle--> SETTLED  (balances paid out, channel frozen)
```

### §2.1 Open sub-decision: does challenge **reset** the timer?

- Reset → safer against attacker spamming late states, longer worst-case close.
- No reset → faster close, but if attacker can sit on a higher state and submit at T-ε, defender has no time to react.
- **Pick: reset to half-window on each successful challenge**, capped at 3 resets. Bounded delay, but no zero-time gotcha. Reopen if metrics show legitimate challenges happening in normal flow (they shouldn't — both sides sign as they go).

---

## 3. TrustScore — observer-side belief

### Model

```
score(observer, subject) ∈ [0, 1]      (0 = avoid, 1 = trust fully)
score_0 = 0.30                          (cold-start: cautiously open)

on observed transfer outcome o ∈ {success, fail}:
   delta = (o == success ? +1 : -1) * weight(transfer)
   score ← clip01( score * (1 - α) + α * sigmoid(delta) )
   last_update = now

on read at time t:
   age = t - last_update
   if age > τ:  score ← score * exp(-(age - τ) / λ) + score_0 * (1 - exp(...))
```

- **α = 0.18** — single transfer moves the score noticeably but not catastrophically (a one-off failure is forgivable, a streak isn't).
- **weight** scales with transfer value, capped at 5× so a whale tx can't outweigh history.
- **τ = 1 h**, **λ = 24 h** — fresh history matters; absent history reverts toward neutral over a day.
- **success / fail outcomes are reported by the recipient**, but **signed transfers** are the witness set: a fail report against a transfer the recipient also signed = inconsistent, dropped.

### Why EWMA + decay and not, say, Bayesian beta priors

- **Beta(α, β)** is mathematically cleaner and is what big systems use (Uber driver rating, eBay), but it has no time-decay; an agent that was great in 2024 and went rogue in 2026 looks the same. We'd have to add a sliding-window forget, at which point we're approximating EWMA anyway.
- **EWMA + decay** is two parameters, fits in 6 lines, easy to test, and is honest about its weakness: it can't tell "5 wins + 1 loss out of 6" apart from "50 wins + 10 losses out of 60". For our scale (1k–10k transactions per agent pair) this conflation is acceptable.

### Reopen conditions

- If agents start gaming the score by faking transfer outcomes → add a settlement-required witness rule (only settled channels feed scores).
- If we see cold-start manipulation (new agents spammed to look like first-time interactions) → introduce an `account_age` prior weight.
- If observation rate becomes adversarial (1000s of bots reporting on one victim) → switch to a federated / Sybil-resistant scheme (eigentrust).

---

## 4. What we explicitly are *not* building

- **Cross-channel routing** (Lightning HTLC). Out of scope; two-party is enough to prove the pattern.
- **On-chain anchoring.** The "referee" is an in-process arbiter, persisted to JSON. A real deploy would replace it with a smart contract; the wire format above already has everything that contract would need.
- **Asset conversion / FX.** One asset per channel.
- **Privacy** (zk proofs, ring signatures). All states are visible to both parties + the arbiter, which is enough for a trust-building substrate.

---

## 5. Layout

```
payment-protocol/
├── DESIGN.md                      (this file)
├── src/
│   ├── ontology.mjs               WORLD object + JSON-LD + Turtle + SDK source
│   ├── crypto.mjs                 ed25519 sign/verify (Node webcrypto)
│   ├── channel.mjs                state machine, signing rules
│   ├── arbiter.mjs                in-memory referee with challenge window
│   ├── trust.mjs                  EWMA + decay scorer
│   └── server.mjs                 small http: /payment-ontology(.ttl) + /payment-sdk.js
└── test/
    ├── ontology.test.mjs          surface assertions
    ├── channel.test.mjs           100 micropayments → 1 settlement, balances reconcile
    ├── challenge.test.mjs         attacker submits old state, honest party wins
    └── trust.test.mjs             score moves through realistic histories
```

---

## 6. Success criteria (real, falsifiable)

1. Ontology fetch + parse + introspect: ≥ 14 assertions over the three formats.
2. A signs 100 transfers to B (each +1 unit), B signs back, only the final state is settled. Final balances ≡ deposits ± 100. Bit-for-bit reconciliation, asserted at the unit-test level.
3. Attacker (one of A/B) tries to settle at seq=42 when current is seq=100. Honest party challenges within the window; settlement uses seq=100. Test must fail loudly if the attacker can ever extract value beyond what was actually transferred.
4. TrustScore: an agent with 50 successes / 0 failures has score > 0.85 ; same agent after 5 consecutive failures < 0.50 ; idle for 48 simulated hours decays toward 0.30 ± 0.05.

Each is an explicit test with no flake budget.
