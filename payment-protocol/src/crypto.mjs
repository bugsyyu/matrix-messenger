// ed25519 sign / verify on top of Node's webcrypto.
// Agent identity = sha256(publicKey)[:16] hex, deterministic and short.
import crypto from 'node:crypto';

const subtle = crypto.webcrypto.subtle;

export async function generateKeypair() {
  const pair = await subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const pubRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const privPkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
  const agentId = agentIdFromPub(pubRaw);
  return {
    agentId,
    publicKey: bufToHex(pubRaw),
    privateKey: bufToHex(privPkcs8),
    _keyObj: pair,
  };
}

export function agentIdFromPub(pubBytes) {
  const h = crypto.createHash('sha256').update(pubBytes).digest();
  return h.slice(0, 8).toString('hex');           // 16 hex chars = 8 bytes
}

export async function importPub(hex) {
  return subtle.importKey('raw', hexToBuf(hex), 'Ed25519', true, ['verify']);
}

export async function importPriv(hex) {
  return subtle.importKey('pkcs8', hexToBuf(hex), 'Ed25519', true, ['sign']);
}

export async function sign(privateKeyHex, messageBytes) {
  const k = await importPriv(privateKeyHex);
  const s = new Uint8Array(await subtle.sign('Ed25519', k, messageBytes));
  return bufToHex(s);
}

export async function verify(publicKeyHex, signatureHex, messageBytes) {
  const k = await importPub(publicKeyHex);
  return subtle.verify('Ed25519', k, hexToBuf(signatureHex), messageBytes);
}

// Canonical, deterministic serialization for signing. Order keys so two
// parties always sign the exact same bytes.
export function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

export function hashState(stateObj) {
  return crypto.createHash('sha256').update(canonicalize(stateObj)).digest('hex');
}

export function bufToHex(b) {
  return Buffer.from(b).toString('hex');
}
export function hexToBuf(h) {
  return new Uint8Array(Buffer.from(h, 'hex'));
}
