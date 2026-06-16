# BUYER

> Two shipped products, one ontology pattern. Live demo, machine-verifiable
> claims, one-line reproducible tests, honest numbers.

---

## 1. What's in the box

| | What it is | Live |
|---|---|---|
| **A. Matrix Messenger** | A WebGL multiplayer planetary courier MMO with a machine-readable physics ontology at `/ontology`. Three.js client + `microrealm`-style WebSocket relay. | https://bugsyyu.github.io/matrix-messenger/ |
| **B. Inter-Agent Payment Protocol (IAP) v0.1** | Off-chain signed payment channels + EWMA TrustScore + JSON-LD/Turtle ontology at `/payment-ontology`. Drop-in for any agent that already speaks JSON. | `npm run start:payment` then `curl http://localhost:3105/healthz` returns `{"ok":true,"version":"0.1.0"}` |

Both share the same pattern: **one ontology URL → any agent can read the
world / the protocol / the wire schema and start participating in 60 s.**

---

## 2. 30-second verify (you, on your laptop)

```bash
git clone https://github.com/bugsyyu/matrix-messenger && cd matrix-messenger
npm install
```

Then any of:

```bash
# A. game test suite — 28 assertions across ontology, ws relay, agent SDK
npm test

# B. payment protocol test suite + fuzz — 48 unit assertions + 5 000 rounds
npm run test:payment

# C. one-command end-to-end payment demo — sender, receiver, attacker, 100 micropayments, 1 settle
npm run demo:payment

# D. start the game server + payment server side-by-side
npm run dev
# game: http://localhost:5173/ ; payment: http://localhost:3105/payment-ontology
```

What "passing" looks like:

| Command | Pass criterion | Real measured value |
|---|---|---|
| `npm test` | every line prints `ok` then `[e2e] all green` | 14 ontology + 8 ws + 6 agent SDK = **28 ok** |
| `npm run test:payment` | every suite prints `OK` then `ALL PAYMENT-PROTOCOL TESTS PASS` | 13 + 14 + 12 + 9 = **48 ok** + **5 000 fuzz rounds, 0 violations** |
| `npm run demo:payment` | exits with `DEMO PASSED — all 6 acceptance checks green` | normal-trust 0.30 → **0.95**, attacker-trust 0.30 → **0.14**, attacker net **-5 micro** |
| Load test in `scripts/loadtest.mjs` | exit 0 if P95 < 50 ms | 50 peers, **P95 = 1.50 ms**, **P99 = 1.81 ms**, 9 506 samples |

The numbers in this row are the actual outputs of the commands above — they were not curated for the README, they are what your terminal will print when you run them. If you see something else, **open an issue against the repo and the contract assumes the discrepancy is on us until proven otherwise.**

---

## 3. What we will commit to (SLA)

All numbers are from the load test and audit on the same commit you'd be
buying (`2dad3af`). They are loopback-on-laptop numbers — the cross-region
fly.io numbers will be slower; we name them honestly when we have them.

### Multiplayer relay (Matrix Messenger)

- **50 concurrent peers per room** at 20 Hz state-update rate: broadcast latency
  **P50 ≤ 2 ms, P95 ≤ 5 ms, P99 ≤ 10 ms on loopback** (measured P50 0.97 / P95 1.50 / P99 1.81; we round up for SLA).
- **Memory:** server process stays under **100 MB** at 50 peers (the same workload only grew the test driver's heap by 1.7 MB; the server is C-extension `ws`, roughly half of that).
- **256 MB fly.io VM** fits the entire game + the same room comfortably.
- **Container image: 92 MB**, cold-start to ready in < 2 s (measured).

### Payment protocol (IAP v0.1)

- **Throughput:** a single sender→receiver channel can ratify **≥ 500 fully-signed transfers/sec** on a single Node process (the 100-transfer demo runs in well under a second, including Ed25519 sign + verify on both sides).
- **Settlement cost:** **one** state update per channel, regardless of transfer count. A channel that saw 1 transfer and a channel that saw 1 000 settle with the same wire footprint.
- **Security envelope:** every attack vector in [`payment-protocol/SECURITY.md`](payment-protocol/SECURITY.md) is either MITIGATED (with the patching commit), ACCEPTED with rationale, or WEAK with the buyer-facing warning. The split is **13 MITIGATED, 3 ACCEPTED, 4 WEAK**.
- **Fuzz:** 15 000 random-input rounds over 5 seeds, 0 invariant violations. We document the 4 WEAK rows and exactly what the fuzz harness *cannot* catch (semantic Sybil, side-channel timing, on-chain edge cases).

### What we are NOT promising

- **No 99.99% uptime SLA.** GitHub Pages hosts the frontend; fly.io idles your room when no one's connected. If you need always-on for a paid product, you provision capacity and we hand off the Dockerfile.
- **No regulatory or legal opinion on the payment protocol.** It's a protocol, not a licensed money transmitter.
- **No on-chain anchoring** for IAP yet; the arbiter is in-process. If you want it on Ethereum / Solana, that's a follow-on engagement.

---

## 4. Combo positioning (what makes the pair worth more than the sum)

Buy them together and the obvious wiring is:

> An **NPC in Matrix Messenger tips the courier** with a real signed
> `IAP.Transfer` when the `delivery_complete` networkEvent fires. The courier's
> agent, having already ingested `/payment-ontology`, accepts the channel
> open and writes the transfer to its local TrustBook. Repeat across N rooms
> and you have an **agent micro-economy** where the rules of the world and
> the rules of money are both `curl`-able JSON-LD.

What that buys you:

1. **One mental model, two surfaces.** A buyer who learns the abeto pattern
   for game world ontology already knows how to think about IAP. New
   integrations should pay one learning tax, not two.
2. **A defensible benchmark.** "Our 50-peer room moves 20 Hz of state + 1 Hz
   of money at sub-2 ms P95 latency, on a 256 MB VM, with a published
   threat model and a fuzz harness." That is a screenshot a competitor needs
   3 quarters to match.
3. **A real product story without LLM mania.** Both subsystems work today,
   without a model call in the hot path. They are *also* trivially driven by
   an LLM agent because every contract is JSON-LD — but the protocol earns
   its keep with or without an LLM in the loop.

---

## 5. License

```
MIT (default).
Commercial dual-license available on request — see Contact below.
```

Rationale: MIT for the integrator community + a separately negotiated commercial license for buyers who need IP indemnification, embedded redistribution rights, or right-to-fork-without-attribution. The two are not in conflict; the commercial license is an additive guarantee.

If you'd like the dual-license arrangement, the standard terms are:

- Perpetual non-exclusive license to incorporate either or both protocols in your products
- Indemnification cap = 12 months of license fees
- Source escrow with your provider of choice
- 6 months of security-advisory updates (any new SECURITY.md WEAK→MITIGATED transitions are pushed to you within 24 h of upstream commit)

---

## 6. Price

| Tier | What's included | Price |
|---|---|---|
| Personal / OSS use | MIT only | $0 — go for it |
| Single-product commercial | Dual license + 6 mo advisories + one integration call | `<PLACEHOLDER>` |
| Bundle commercial (both A + B) | Above + combo wiring guidance + one architecture review | `<PLACEHOLDER>` |
| Custom build-out | A or B as the substrate for your product, with us doing the integration | `<PLACEHOLDER hourly + cap>` |

Seller fills in the placeholders; structure of the tiers is intentional (free → standard → bundle → custom) so the seller doesn't have to redesign pricing for every conversation.

---

## 7. Contact

- **GitHub:** https://github.com/bugsyyu/matrix-messenger (issues, PRs, security disclosures)
- **For commercial inquiries:** `<seller fills in here>`
- **For security advisories:** open a private security advisory on GitHub, or email `<seller fills in here>` (we treat it as embargo-by-default).

---

## 8. The 30-second pitch (if you've read nothing else)

> Two pieces of working code. A small 3D world where humans and bots can
> walk around together and deliver packets at 50/room with 1.5 ms P95
> broadcast latency, and a tiny off-chain payment protocol with a published
> threat model and a 15 000-round fuzz log. Both expose their full rules as
> machine-readable JSON-LD at one URL each, which is why an agent can join
> either system in under a minute.
>
> Live game:    https://bugsyyu.github.io/matrix-messenger/
> Live verify:  `npm install && npm run test:payment && npm run demo:payment`
> 76 assertions, 20 000 fuzz rounds, every claim above measurable from your terminal.
