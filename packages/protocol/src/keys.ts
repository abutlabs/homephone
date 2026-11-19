// Call keys.
//
// Every endpoint (a Pi, or a person's Homephone in the Polkadot App) has its own
// call identity: an Ed25519 key to sign call messages and an X25519 key to
// receive encrypted ones. Both come from one 32-byte seed.
//
// We don't sign rings with the Polkadot product account: inside the App every
// signature from that account is an approval prompt on the owner's phone. The
// product account certifies the call identity once, when someone joins a
// household (milestone 3).
//
// A household has its own X25519 key. Its devices hold the private half, so a
// ring sent to the household can be read by every phone in the house.

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, concatBytes, randomBytes, utf8ToBytes } from "./bytes.ts";

/** What others need to know about an endpoint. Safe to share. */
export interface PublicIdentity {
  signPub: Uint8Array; // Ed25519, 32 bytes
  boxPub: Uint8Array; // X25519, 32 bytes
}

/** An endpoint's own keys. Keep the seed secret. */
export interface CallIdentity extends PublicIdentity {
  seed: Uint8Array;
  signSecret: Uint8Array;
  boxSecret: Uint8Array;
}

/** A household's inbox key. Every device in the household holds the secret. */
export interface HouseholdKey {
  boxPub: Uint8Array;
  boxSecret: Uint8Array;
}

function derive(label: string, seed: Uint8Array): Uint8Array {
  return blake2b(concatBytes(utf8ToBytes(`homephone/v1/${label}`), seed), { dkLen: 32 });
}

export function identityFromSeed(seed: Uint8Array): CallIdentity {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  const signSecret = derive("sign", seed);
  const boxSecret = derive("box", seed);
  return {
    seed,
    signSecret,
    boxSecret,
    signPub: ed25519.getPublicKey(signSecret),
    boxPub: x25519.getPublicKey(boxSecret),
  };
}

export function newIdentity(): CallIdentity {
  return identityFromSeed(randomBytes(32));
}

export function householdFromSeed(seed: Uint8Array): HouseholdKey {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  const boxSecret = derive("household", seed);
  return { boxSecret, boxPub: x25519.getPublicKey(boxSecret) };
}

export function newHousehold(): HouseholdKey {
  return householdFromSeed(randomBytes(32));
}

/** 8-byte id for a signing key. Messages carry this instead of the full key. */
export function keyId(signPub: Uint8Array): Uint8Array {
  return blake2b(concatBytes(utf8ToBytes("homephone/v1/keyid"), signPub), { dkLen: 8 });
}

export function keyIdHex(signPub: Uint8Array): string {
  return bytesToHex(keyId(signPub));
}

export function publicOf(id: PublicIdentity): PublicIdentity {
  return { signPub: id.signPub, boxPub: id.boxPub };
}
