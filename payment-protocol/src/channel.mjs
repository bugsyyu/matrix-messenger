// Bilateral payment channel state machine.
//
// Lifecycle:  OPEN  -- request_close -->  CLOSING  -- (window) -->  SETTLED
//             ^                              |
//             |                              `-- challenge (new state) --> claim replaced
//
// Each Transfer is a fully signed snapshot { seq, balances }. Both parties keep
// the latest fully-signed snapshot they've seen; whichever has the higher seq
// wins on settlement.
import { sign, verify, canonicalize, hashState } from './crypto.mjs';
import { WORLD } from './ontology.mjs';

const PARAM = WORLD.channel_params;

export const STATE = Object.freeze({
  OPEN:     'OPEN',
  CLOSING:  'CLOSING',
  SETTLED:  'SETTLED',
});

let _nonce = 0;
const newNonce = () => _nonce++;

export class Channel {
  constructor({ partyA, partyB, depositA, depositB, asset = 'micro', nonce }) {
    if (partyA.agentId === partyB.agentId) throw new Error('cannot open channel with self');
    if (depositA < 0 || depositB < 0) throw new Error('negative deposit');
    this.id = `urn:iap:channel:${partyA.agentId}/${partyB.agentId}/${nonce ?? newNonce()}`;
    this.asset = asset;
    this.parties = {
      [partyA.agentId]: { pub: partyA.publicKey, deposit: depositA },
      [partyB.agentId]: { pub: partyB.publicKey, deposit: depositB },
    };
    this.state = STATE.OPEN;
    this.latest = {                 // initial state: deposits intact, seq=0
      channel: this.id,
      seq: 0,
      balances: { [partyA.agentId]: depositA, [partyB.agentId]: depositB },
      purpose: 'open',
      ts: 0,
      sig: {},                      // will be filled by both at open
    };
    this.history = [];              // every transfer we've ratified (debug)
  }

  total() {
    return Object.values(this.parties).reduce((s, p) => s + p.deposit, 0);
  }

  agentIds() {
    return Object.keys(this.parties);
  }

  /**
   * Build the unsigned body of the next transfer (caller-side helper).
   * Caller signs it, recipient counter-signs, then both call `apply(signed)`.
   */
  buildNext({ sender, recipient, amount, purpose = '', ts = 0 }) {
    if (this.state !== STATE.OPEN) throw new Error(`channel not open (state=${this.state})`);
    const a = this.parties[sender], b = this.parties[recipient];
    if (!a || !b) throw new Error('unknown party on channel');
    const curBal = this.latest.balances;
    if (curBal[sender] < amount) throw new Error(`sender insufficient: have ${curBal[sender]}, need ${amount}`);
    const balances = {
      [sender]:    curBal[sender]    - amount,
      [recipient]: curBal[recipient] + amount,
    };
    const sum = balances[sender] + balances[recipient];
    if (sum !== this.total()) throw new Error(`balance sum mismatch: ${sum} != ${this.total()}`);
    return {
      channel: this.id,
      seq: this.latest.seq + 1,
      balances,
      purpose,
      ts,
    };
  }

  /**
   * Apply a transfer that already has signatures from BOTH parties.
   * Throws if seq is not exactly latest+1 or signatures fail.
   */
  async apply(signed) {
    if (this.state !== STATE.OPEN) throw new Error(`apply on non-open channel (state=${this.state})`);
    if (signed.seq !== this.latest.seq + 1) {
      throw new Error(`seq skip: expected ${this.latest.seq + 1}, got ${signed.seq}`);
    }
    if (signed.channel !== this.id) throw new Error('channel id mismatch');

    await this._verifyBothSigs(signed);

    // additional bookkeeping: balance sums conserved, no negative, both parties present
    const ids = this.agentIds();
    for (const id of ids) {
      if (signed.balances[id] === undefined) throw new Error(`missing balance for ${id}`);
      if (signed.balances[id] < 0) throw new Error(`negative balance for ${id}`);
    }
    const sum = ids.reduce((s, id) => s + signed.balances[id], 0);
    if (sum !== this.total()) throw new Error(`balance sum changed: ${sum} != ${this.total()}`);

    this.latest = signed;
    this.history.push(signed);
    return signed;
  }

  async _verifyBothSigs(signed) {
    const body = { channel: signed.channel, seq: signed.seq, balances: signed.balances, purpose: signed.purpose, ts: signed.ts };
    const msg = Buffer.from(canonicalize(body));
    const sigs = signed.sig || {};
    const ids = this.agentIds();
    for (const id of ids) {
      const s = sigs[id];
      if (!s) throw new Error(`missing signature from ${id}`);
      const ok = await verify(this.parties[id].pub, s, msg);
      if (!ok) throw new Error(`bad signature from ${id}`);
    }
  }

  /**
   * Convenience: build + sign by sender (caller does it), returns half-signed
   * envelope to send to recipient.
   */
  async senderSign(unsigned, sender, senderPrivHex) {
    const body = { channel: unsigned.channel, seq: unsigned.seq, balances: unsigned.balances, purpose: unsigned.purpose, ts: unsigned.ts };
    const msg = Buffer.from(canonicalize(body));
    const sig = await sign(senderPrivHex, msg);
    return { ...body, sig: { [sender]: sig } };
  }

  async recipientSign(halfSigned, recipient, recipientPrivHex) {
    const body = { channel: halfSigned.channel, seq: halfSigned.seq, balances: halfSigned.balances, purpose: halfSigned.purpose, ts: halfSigned.ts };
    const msg = Buffer.from(canonicalize(body));
    const sig = await sign(recipientPrivHex, msg);
    return { ...body, sig: { ...halfSigned.sig, [recipient]: sig } };
  }

  hash() {
    return hashState(this.latest);
  }
}
