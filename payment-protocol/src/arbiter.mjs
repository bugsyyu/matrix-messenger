// In-memory arbiter: tracks closing channels, runs the challenge window, settles.
//
// A real deployment swaps this for a smart contract or a federated set. The
// interface (request_close / challenge / settle) and on-wire shape are what
// matter; everything below could be a Solidity contract verbatim.
import { verify, canonicalize } from './crypto.mjs';
import { STATE } from './channel.mjs';
import { WORLD } from './ontology.mjs';

const PARAM = WORLD.channel_params;

export class Arbiter {
  /**
   * @param {object} opts
   * @param {() => number} [opts.clock]  injectable so tests can advance time
   * @param {number} [opts.windowMs]
   * @param {number} [opts.resetMs]
   * @param {number} [opts.resetCap]
   */
  constructor(opts = {}) {
    this.clock = opts.clock ?? (() => Date.now());
    this.windowMs = opts.windowMs ?? PARAM.challenge_window_ms;
    this.resetMs  = opts.resetMs  ?? PARAM.challenge_reset_ms;
    this.resetCap = opts.resetCap ?? PARAM.challenge_reset_cap;
    this.entries = new Map();     // channelId -> { channel, claim, deadline, resets, settled, payouts }
  }

  /**
   * `channel` here is the live Channel object (parties & pubkeys come from it).
   * `claim` is a fully-signed Transfer the closer claims is the latest state.
   */
  async requestClose(channel, claim) {
    if (this.entries.has(channel.id)) throw new Error('already closing');
    await this._validateClaim(channel, claim);
    channel.state = STATE.CLOSING;
    const deadline = this.clock() + this.windowMs;
    this.entries.set(channel.id, {
      channel, claim, deadline, resets: 0, settled: false, payouts: null,
    });
    return { channel: channel.id, deadline, claim: claim };
  }

  async challenge(channelId, newState) {
    const e = this.entries.get(channelId);
    if (!e) throw new Error('no closing entry');
    if (e.settled) throw new Error('already settled');
    if (this.clock() >= e.deadline) throw new Error('challenge window elapsed');
    if (newState.seq <= e.claim.seq) throw new Error(`challenge seq ${newState.seq} not > current ${e.claim.seq}`);
    await this._validateClaim(e.channel, newState);
    e.claim = newState;
    if (e.resets < this.resetCap) {
      // halve remaining time, but never extend it
      const remaining = e.deadline - this.clock();
      const halved = Math.max(this.resetMs, Math.floor(remaining / 2));
      e.deadline = this.clock() + halved;
      e.resets += 1;
    }
    return { channel: channelId, deadline: e.deadline, claim: newState, resets: e.resets };
  }

  settle(channelId) {
    const e = this.entries.get(channelId);
    if (!e) throw new Error('no closing entry');
    if (e.settled) return e.payouts;        // idempotent
    if (this.clock() < e.deadline) throw new Error('window not yet elapsed');
    const finalState = e.claim;
    e.channel.state = STATE.SETTLED;
    e.channel.latest = finalState;
    e.settled = true;
    e.payouts = { channel: channelId, finalSeq: finalState.seq, balances: finalState.balances };
    return e.payouts;
  }

  status(channelId) {
    const e = this.entries.get(channelId);
    if (!e) return null;
    return {
      channel: channelId,
      claim_seq: e.claim.seq,
      deadline: e.deadline,
      ms_remaining: Math.max(0, e.deadline - this.clock()),
      resets: e.resets,
      settled: e.settled,
    };
  }

  async _validateClaim(channel, claim) {
    if (claim.channel !== channel.id) throw new Error('channel id mismatch');
    if (typeof claim.seq !== 'number' || claim.seq < 0) throw new Error('bad seq');
    const ids = channel.agentIds();
    for (const id of ids) {
      if (claim.balances?.[id] === undefined) throw new Error(`missing balance for ${id}`);
      if (claim.balances[id] < 0) throw new Error(`negative balance for ${id}`);
    }
    const sum = ids.reduce((s, id) => s + claim.balances[id], 0);
    if (sum !== channel.total()) throw new Error('balance sum != deposits');

    const body = { channel: claim.channel, seq: claim.seq, balances: claim.balances, purpose: claim.purpose ?? '', ts: claim.ts ?? 0 };
    const msg = Buffer.from(canonicalize(body));
    const sigs = claim.sig || {};
    for (const id of ids) {
      const s = sigs[id];
      if (!s) throw new Error(`claim missing signature from ${id}`);
      const ok = await verify(channel.parties[id].pub, s, msg);
      if (!ok) throw new Error(`claim has bad signature from ${id}`);
    }
  }
}
