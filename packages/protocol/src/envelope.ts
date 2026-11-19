// Sealed, signed envelopes.
//
//   envelope  = version(1) | ephemeralPub(32) | XChaCha20-Poly1305(key, nonce=0, inner)
//   inner     = senderKeyId(8) | signature(64) | body
//   key       = BLAKE2b-256("homephone/v1/seal" | x25519(eph, recipient) | ephPub | recipientPub)
//   signature = Ed25519(sender, "homephone/v1/msg" | recipientPub | body)
//
// A fresh ephemeral key per message makes every key unique, so a zero nonce is
// safe and doesn't need to be sent. The signature covers the recipient's key,
// so a message can't be replayed to a different household or person.
// Outsiders see only random bytes: not who is calling, nor whom.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "./bytes.ts";
import { keyId, type CallIdentity, type PublicIdentity } from "./keys.ts";

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_OVERHEAD = 1 + 32 + 16 + 8 + 64;

const SEAL = utf8ToBytes("homephone/v1/seal");
const MSG = utf8ToBytes("homephone/v1/msg");
const ZERO_NONCE = new Uint8Array(24);

function sealKey(shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  return blake2b(concatBytes(SEAL, shared, ephPub, recipientPub), { dkLen: 32 });
}

export function seal(body: Uint8Array, sender: CallIdentity, recipientBoxPub: Uint8Array): Uint8Array {
  const ephSecret = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephSecret);
  const key = sealKey(x25519.getSharedSecret(ephSecret, recipientBoxPub), ephPub, recipientBoxPub);
  const sig = ed25519.sign(concatBytes(MSG, recipientBoxPub, body), sender.signSecret);
  const inner = concatBytes(keyId(sender.signPub), sig, body);
  const ct = xchacha20poly1305(key, ZERO_NONCE).encrypt(inner);
  return concatBytes(Uint8Array.of(ENVELOPE_VERSION), ephPub, ct);
}

export interface Opened {
  sender: PublicIdentity;
  body: Uint8Array;
}

/** Look up a sender by key id (hex). Unknown senders return undefined. */
export type SenderLookup = (keyIdHex: string) => PublicIdentity | undefined;

/**
 * Decrypts and verifies an envelope addressed to `recipient`. Returns null for
 * anything that isn't for us, is damaged, or comes from someone we don't know.
 * Callers drop those silently: an unknown caller never makes a phone ring.
 */
export function open(
  data: Uint8Array,
  recipient: { boxPub: Uint8Array; boxSecret: Uint8Array },
  lookup: SenderLookup,
): Opened | null {
  if (data.length < ENVELOPE_OVERHEAD || data[0] !== ENVELOPE_VERSION) return null;
  const ephPub = data.subarray(1, 33);
  let inner: Uint8Array;
  try {
    const key = sealKey(x25519.getSharedSecret(recipient.boxSecret, ephPub), ephPub, recipient.boxPub);
    inner = xchacha20poly1305(key, ZERO_NONCE).decrypt(data.subarray(33));
  } catch {
    return null;
  }
  const sender = lookup(bytesToHex(inner.subarray(0, 8)));
  if (!sender) return null;
  const sig = inner.subarray(8, 72);
  const body = inner.slice(72);
  let ok = false;
  try {
    ok = ed25519.verify(sig, concatBytes(MSG, recipient.boxPub, body), sender.signPub);
  } catch {
    ok = false;
  }
  return ok ? { sender, body } : null;
}
