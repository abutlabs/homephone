// Restoring a Polkadot App account's keys from its recovery phrase.
//
// The App's derivations, as read from the Android source and TrUAPI
// (docs/restore-spec.md; checked against their test vectors in test/account.test.ts):
//
//   entropy     = BIP-39 entropy of the phrase (16 bytes for 12 words)
//   mini-secret = PBKDF2-HMAC-SHA512(entropy, "mnemonic", 2048)[0..32]      (substrate-bip39, no password)
//   root        = sr25519 from the mini-secret                                  (= pairing's root_account_id)
//   identity    = root //product //peopl.<tld> /<index_bytes(0)>               (hard, hard, soft)
//                 index_bytes(i) = u32le(i) ‖ blake2b256("product-account-index")[0..28]
//                 <tld> = the People chain's NetworkSuffix ("dot" on devnet)
//   chat key    = X25519 secret kh(kh(entropy, key "ecdh"), key cc("chat"))   (kh = keyed BLAKE2b-256)
//
// The identity account owns the username, holds the permanent Lite-personhood
// Statement Store allowance (50 statements / 500 KiB) and can sign any statement.

import { blake2b } from "@noble/hashes/blake2.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKD, getPublicKey, secretFromSeed } from "@scure/sr25519";

const te = new TextEncoder();

/** Substrate junction chain code: string -> SCALE str, 0x-hex -> raw bytes; zero-padded to 32 (blake2b if longer). */
export function chainCode(junction: string): Uint8Array {
  let bytes: Uint8Array;
  if (/^0x([0-9a-fA-F]{2})*$/.test(junction)) bytes = Uint8Array.from(Buffer.from(junction.slice(2), "hex"));
  else if (/^\d+$/.test(junction)) {
    bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(junction), true);
  } else {
    const s = te.encode(junction);
    if (s.length >= 64) throw new Error("junction too long for this helper");
    bytes = new Uint8Array([s.length << 2, ...s]); // SCALE compact length (single-byte mode)
  }
  if (bytes.length > 32) return blake2b(bytes, { dkLen: 32 });
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
}

export const INDEX_MAGIC = blake2b(te.encode("product-account-index"), { dkLen: 32 }).slice(0, 28);

export function indexBytes(i: number): Uint8Array {
  const out = new Uint8Array(32);
  new DataView(out.buffer).setUint32(0, i, true);
  out.set(INDEX_MAGIC, 4);
  return out;
}

const kh = (msg: Uint8Array, key: Uint8Array) => blake2b(msg, { dkLen: 32, key });

export interface AccountKeys {
  entropy: Uint8Array;
  rootSecret: Uint8Array;
  rootPublic: Uint8Array;
  identitySecret: Uint8Array; // 64-byte sr25519 secret (@scure / schnorrkel Ed25519-expanded form)
  identityPublic: Uint8Array;
  chatPriv: Uint8Array; // unclamped 32 bytes, as the App stores and sends it
  chatPub: Uint8Array;
}

export function keysFromEntropy(entropy: Uint8Array, tld = "dot"): AccountKeys {
  const mini = pbkdf2(sha512, entropy, te.encode("mnemonic"), { c: 2048, dkLen: 64 }).slice(0, 32);
  const rootSecret = secretFromSeed(mini);
  let s = HDKD.secretHard(rootSecret, chainCode("product"));
  s = HDKD.secretHard(s, chainCode(`peopl.${tld}`));
  const identitySecret = HDKD.secretSoft(s, indexBytes(0));
  const chatPriv = kh(kh(entropy, te.encode("ecdh")), chainCode("chat"));
  return {
    entropy,
    rootSecret,
    rootPublic: getPublicKey(rootSecret),
    identitySecret,
    identityPublic: getPublicKey(identitySecret),
    chatPriv,
    chatPub: x25519.getPublicKey(chatPriv),
  };
}

export function keysFromPhrase(phrase: string, tld = "dot"): AccountKeys {
  const words = phrase.trim().toLowerCase().split(/\s+/).join(" ");
  if (!validateMnemonic(words, wordlist)) throw new Error("not a valid BIP-39 recovery phrase");
  return keysFromEntropy(mnemonicToEntropy(words, wordlist), tld);
}
