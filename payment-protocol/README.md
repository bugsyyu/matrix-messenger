# Inter-Agent Payment Protocol (IAP)

Machine-readable ontology + signed off-chain channels + observer-side trust
score. Designed so any agent can fetch one URL and start transacting.

## One-command demo

```bash
npm run demo:payment
```

A sender opens a 200 000-micro / 100 000-micro channel with a receiver, sends
**100 signed micropayments**, settles once through the arbiter, and the
receiver's `TrustBook` watches both a normal sender and an attacker.

```
=== summary ===
  ok   transfers_applied = 100
  ok   channel_settled = true
  ok   reconciled = true
  ok   attacker_extracted_value = false
  ok   normal_trust_rose_above_0_85 = true
  ok   attacker_trust_fell_below_0_20 = true
   normal trust:   0.4164 → 0.9496
   attacker trust: 0.2597 → 0.144
   results written to payment-protocol/demo/results.json
```

Full transcript (100 transfers, 2 settlements, both trust curves) lands in
[`demo/results.json`](demo/results.json) — open it for the bit-level evidence.

## Tests

```bash
npm run test:payment        # 50 assertions: 13 ontology + 14 channel + 12 challenge + 11 trust
```

## What's in here

| File | Purpose |
|---|---|
| `DESIGN.md` | Design draft. 6 sections. Channel-close 3-way trade-off + EWMA trust rationale + explicit reopen conditions. |
| `src/ontology.mjs` | 6 classes / 9 relations / 6 actions. JSON-LD + Turtle generators. |
| `src/crypto.mjs` | Ed25519 sign/verify via Node `webcrypto` + canonical JSON. |
| `src/channel.mjs` | Bilateral channel state machine. Build → sender-sign → recipient-sign → apply. |
| `src/arbiter.mjs` | In-memory referee. `request_close` / `challenge` / `settle` with bounded reset window. |
| `src/trust.mjs` | EWMA + time-decay TrustBook. |
| `src/server.mjs` | HTTP endpoints: `/payment-ontology`, `/payment-ontology.ttl`, `/payment-sdk.js`, `/healthz`. |
| `demo/client.mjs` | The one-command demo. |
| `demo/results.json` | Sample run output (regenerated on every `npm run demo:payment`). |
| `test/` | The 50-assertion suite. |

## Wire shape of one transfer

```jsonc
{
  "channel":  "urn:iap:channel:<senderId>/<receiverId>/<nonce>",
  "seq":      42,                            // strictly +1 per channel
  "balances": { "<senderId>": 9550, "<receiverId>": 450 },
  "purpose":  "delivery_redpill_qf3",         // optional
  "ts":       1781636103000,
  "sig":      { "<senderId>": "<hex>", "<receiverId>": "<hex>" }
}
```

Latest fully-signed snapshot wins on settlement; the challenge window lets
the honest party replace a stale claim with a higher-seq one. See DESIGN §2.

## Status

v0.1. Not deployed on-chain yet — the arbiter is in-process and persisted to
JSON. The wire format above already carries everything a Solidity contract
would need; swapping `arbiter.mjs` for a contract is a single-file change.

Not built (yet, by design):

- Cross-channel HTLC routing
- On-chain anchoring
- Asset conversion / FX
- Privacy (zk proofs / ring sigs)
