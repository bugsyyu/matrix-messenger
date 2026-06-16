# ROADMAP — v0.2 incremental deepening

> Why this exists: previous proposals ("Matrix-grade ecosystem, 50–100k LOC, RL + economy + crypto + stock market in one push") were rejected as wishful. This is the honest version. 3 phases, each phase scoped to what is **measurably done**, each subsequent phase planned **only after the previous phase's real data is in**. No upfront commitment past phase 1.

## Phase 1 — physical depth + one of each ecosystem axis (1 week budget)

Concrete deliverables. Each lands as its own commit with a real test or
observable artifact. **If phase 1 doesn't complete in 1 week, work stops and
a blocker report goes in here, not a sweep of "almost done".**

| # | Deliverable | Definition of done | How verified |
|---|---|---|---|
| 1 | **Real radial gravity** `g = G·M/r²` in `client/src/systems/sphere-physics.js`, replacing hardcoded `gravity = 28`. New world fields: `G`, per-planet `mass`. | A free-fall from height h above a single planet matches `t = sqrt(2h / g_surface)` to within 5 %. | Unit test in `client/test/physics.test.mjs` running the integrator and comparing to closed form. |
| 2 | **2 planets** with independent `mass`, `radius`, `position`. Net gravity = `Σ G·M_i / |r-c_i|²`. | Player held at midpoint of the line between equal-mass planets experiences ≤ 0.1 % net acceleration; player held closer to planet A experiences net acceleration toward A. | Same test file, two scenarios. |
| 3 | **Boundary switch (emergent)** — no `if (dist > X) swap_planet`. Dominant attractor flips because the `r²` weights flip; the player's "up" axis (`-normalize(force)`) reorients smoothly. | Playwright captures a 10 s flight: player leaves planet A surface, mid-flight `up` direction continuously rotates from "anti-A" through arbitrary intermediate to "anti-B"; landing on B works without code change. | `research/visual/08-switch.png` (mid-flight) + `09-landed-B.png`. |
| 4 | **One NPC type with utility AI**. 2 stats (`hunger`, `energy`) decay over sim time; 3 actions (`idle`, `eat`, `sleep`); each tick pick the max-utility action. Observable decision log. | Stat traces over a 5 min sim show hunger oscillates between thresholds (NPC eats when hungry, doesn't eat when sated); decision log lists ≥ 30 action switches with non-degenerate distribution. | `server/test/npc-utility.test.mjs` runs the sim headless and asserts on the trace. JSON dump in `docs/sim/npc-trace.json`. |
| 5 | **1 commodity supply/demand** ("berry"). NPC produces at rate `r_p`, player harvest at rate `r_d`. Price `p_t = p_0 · (S_baseline / S_t)^elasticity`. Tick-history persisted. | A 10 min sim with `r_d > r_p` shows price strictly increasing toward a documented ceiling; with `r_d < r_p` price strictly decreasing toward floor. | `server/test/economy.test.mjs` + `docs/sim/economy.json` with the time series. |
| 6 | **Server-authoritative pickup** for quest sources. First WebSocket message claiming pickup wins; loser receives `pickup_denied` and rolls back client prediction. | E2E test: two clients enter trigger radius within 50 ms; exactly one gets `pickup_granted`, the other gets `pickup_denied`. Repeated 100 times: no duplicate pickups, no zero pickups. | New `server/test/pickup-race.test.mjs`. |
| 7 (doc) | **BUYER.md latency honesty**. Add the line caught in review: "P95 1.5 ms is server-side budget; real-user-felt latency = this + their network RTT/2 (~10–20 ms intra-region, 80–150 ms cross-ocean)." | The sentence is in the file. | grep. |

### Phase 1 budget caveats (honest)

- 7 items, 1 week = ~1 day each. Items 1–3 are the only ones likely to bleed time (real physics + integrator numerical stability).
- I have **no GPU**, no Python torch env preconfigured, no Redis daemon, no Postgres. Phase 1 stays in Node only — Python / Redis / DB land in phase 2 if at all.
- I cannot make `fly deploy` happen without an account; the live URL stays GitHub Pages (single-player). Multiplayer demonstration of items 4–6 will be via two `node` peers connecting to a `node server` on `localhost`.

## Phase 2 — what *might* land, decided only after phase 1 data

The big-system list (RL / GOAP / stock / crypto / multi-NPC schedules / persistence) is **not committed**. Picking among them requires phase 1's real numbers (how much CPU budget remains in the sim tick, how stable the physics integrator is across many bodies, how much the server-authoritative refactor cost in latency).

A plausible phase 2 picks **at most two** of:

- **(2a) GOAP planner** on top of utility AI (real planning, 1–3 step lookahead). Real risk: planner explodes search space; ~3 days.
- **(2b) 5 NPCs with daily schedules** driven by sim clock. Real risk: O(N²) NPC interactions; ~2 days.
- **(2c) 3-commodity economy** with cross-elasticity. Real risk: numerical stability of the price PDE; ~3 days.
- **(2d) Persistence** (SQLite). Real risk: schema migration during dev churn; ~2 days.

If phase 1 reveals the sim tick is already saturated, phase 2 is **performance + observability**, not new features.

## Phase 3 — speculative, no commitment

The aspirational systems (real RL training loop, stock market with 5 tickers, crypto-coin tied to IAP channels) are **technically feasible** but each is its own real engineering effort. They land in phase 3 *if* phase 2 confirms the substrate can carry them. RL specifically requires real training time and a real GPU; I cannot promise a non-flat reward curve in a fixed schedule.

## What is explicitly NOT being attempted

- "Matrix-grade" world-class polish (art, audio design, voice acting)
- Multi-region authoritative server with rollback netcode
- 100-player live load test against a real public endpoint (we have no public endpoint; load test stays loopback per BUYER.md SLA)
- Decentralized arbiter for IAP (still in-process per SECURITY.md)

## How this stays honest

- Each phase-1 deliverable has a **measurable definition of done** above. "Almost done" doesn't count.
- If a deliverable misses, a blocker note lands here within the same commit as the partial work.
- No phase 2 work begins until phase 1 is either fully green or formally truncated with reasons.
