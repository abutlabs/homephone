// Pairing the Pi with the owner's Polkadot App, as a linked device.
//
// This is the App's "SSO pairing v2", the same handshake Polkadot Desktop uses
// (truapi host_logic/sso/pairing.rs; docs/linked-device-spec.md §1.2):
//
// 1. We make a device identity: an sr25519 statement key D.stmt and an X25519
//    key D.enc.
// 2. We show `polkadotapp://pair?handshake=<hex>`, where the hex is
//    SCALE(VersionedHandshakeProposal::V2{device{stmt, encPub}, metadata}).
//    The owner scans it, or taps it on the phone, under Connected Devices.
// 3. The phone posts encrypted answers on topic1 = blake2b256(key=D.stmt, D.encPub ‖ "topic"):
//    data = 0x01 ‖ Bytes(nonce12 ‖ ChaCha20-Poly1305 ct) ‖ ephemeralPub[32]
//    key  = HKDF-SHA256(ikm = X25519(D.encPriv, ephemeralPub), salt = ∅, info = ∅)
// 4. The plaintext is Pending(AllowanceAllocation), then Success{identity
//    account, root account, the owner's chat key, ...} or Failed(reason).
//
// The phone also pays the device's Statement Store allowance (one slot).

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { getPublicKey, secretFromSeed } from "@scure/sr25519";
import { Bytes, Enum, Struct, Tuple, Vector, _void, str } from "scale-ts";
import { decodeStatement, verifiedSigner } from "./statement.ts";

// ---- wire types (pairing/v2.rs) ---------------------------------------------

const MetadataKey = Enum({
  Custom: str,
  HostName: _void,
  HostVersion: _void,
  HostIcon: _void,
  PlatformType: _void,
  PlatformVersion: _void,
});

const ProposalV2 = Struct({
  device: Struct({ statementAccountId: Bytes(32), encryptionPublicKey: Bytes(32) }),
  metadata: Vector(Tuple(MetadataKey, str)),
});

// VersionedHandshakeProposal / Response put V2 at index 1.
const VersionedProposal = Enum({ V1: _void, V2: ProposalV2 });
const VersionedResponse = Enum({
  V1: _void,
  V2: Struct({ encryptedMessage: Bytes(), publicKey: Bytes(32) }),
});

const EncryptedResponse = Enum({
  Pending: Enum({ AllowanceAllocation: _void }),
  Success: Struct({
    identityAccountId: Bytes(32),
    rootAccountId: Bytes(32),
    identityChatPrivateKey: Bytes(32),
    ssoEncPubKey: Bytes(32),
    deviceEncPubKey: Bytes(32),
    rootEntropySource: Bytes(32),
  }),
  Failed: str,
});

// ---- device identity -------------------------------------------------------------

export interface DeviceIdentity {
  stmtSecret: Uint8Array; // 64-byte sr25519 secret (Ed25519-expanded, schnorrkel/@scure form)
  stmtPublic: Uint8Array; // D.stmt
  encSecret: Uint8Array; // D.encPriv
  encPublic: Uint8Array; // D.encPub
}

export function newDeviceIdentity(): DeviceIdentity {
  const stmtSecret = secretFromSeed(randomBytes(32));
  const encSecret = x25519.utils.randomSecretKey();
  return {
    stmtSecret,
    stmtPublic: getPublicKey(stmtSecret),
    encSecret,
    encPublic: x25519.getPublicKey(encSecret),
  };
}

export interface HostInfo {
  name: string;
  version?: string;
  platformType?: string;
}

export function pairingDeeplink(device: DeviceIdentity, host: HostInfo, scheme = "polkadotapp"): string {
  const metadata: [CodecTypeKey, string][] = [[{ tag: "HostName", value: undefined }, host.name]];
  if (host.version) metadata.push([{ tag: "HostVersion", value: undefined }, host.version]);
  if (host.platformType) metadata.push([{ tag: "PlatformType", value: undefined }, host.platformType]);
  const bytes = VersionedProposal.enc({
    tag: "V2",
    value: {
      device: { statementAccountId: device.stmtPublic, encryptionPublicKey: device.encPublic },
      metadata,
    },
  });
  return `${scheme}://pair?handshake=${Buffer.from(bytes).toString("hex")}`;
}
type CodecTypeKey = Parameters<typeof MetadataKey.enc>[0];

export function decodeDeeplink(link: string) {
  const hex = link.includes("?handshake=") ? link.split("?handshake=")[1]! : link;
  return VersionedProposal.dec(Uint8Array.from(Buffer.from(hex.trim(), "hex")));
}

/** topic1 = BLAKE2b-256 keyed by D.stmt over D.encPub ‖ "topic". */
export function pairingTopic(device: Pick<DeviceIdentity, "stmtPublic" | "encPublic">): Uint8Array {
  const msg = new Uint8Array([...device.encPublic, ...new TextEncoder().encode("topic")]);
  return blake2b(msg, { key: device.stmtPublic, dkLen: 32 });
}

// ---- answers -----------------------------------------------------------------------

export interface PairingSuccess {
  identityAccountId: Uint8Array; // A.id: the owner's chat identity account
  rootAccountId: Uint8Array;
  identityChatPrivateKey: Uint8Array; // A.chatPriv: the owner's chat key (keep secret)
  ssoEncPubKey: Uint8Array;
  deviceEncPubKey: Uint8Array; // the phone's device encryption key
  rootEntropySource: Uint8Array;
  phoneStatementAccount: Uint8Array; // who signed the answer: the phone's statement account
}

export type PairingAnswer =
  | { kind: "pending" }
  | { kind: "success"; success: PairingSuccess }
  | { kind: "failed"; reason: string };

export function aeadKey(ownSecret: Uint8Array, peerPublic: Uint8Array): Uint8Array {
  return hkdf(sha256, x25519.getSharedSecret(ownSecret, peerPublic), new Uint8Array(), new Uint8Array(), 32);
}

export function openSealed(key: Uint8Array, sealed: Uint8Array): Uint8Array {
  if (sealed.length < 12 + 16) throw new Error("ciphertext too short");
  return chacha20poly1305(key, sealed.subarray(0, 12)).decrypt(sealed.subarray(12));
}

export function seal(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const nonce = randomBytes(12);
  return new Uint8Array([...nonce, ...chacha20poly1305(key, nonce).encrypt(plaintext)]);
}

/**
 * Reads one statement from the pairing topic. Returns null for anything that
 * isn't a valid, signed answer for this device (the topic is public).
 */
export function readPairingAnswer(statementBytes: Uint8Array, device: DeviceIdentity): PairingAnswer | null {
  let st;
  try {
    st = decodeStatement(statementBytes);
  } catch {
    return null;
  }
  const signer = verifiedSigner(st);
  if (!signer || !st.data) return null;
  try {
    const resp = VersionedResponse.dec(st.data);
    if (resp.tag !== "V2") return null;
    const plain = openSealed(aeadKey(device.encSecret, resp.value.publicKey), resp.value.encryptedMessage);
    const answer = EncryptedResponse.dec(plain);
    if (answer.tag === "Pending") return { kind: "pending" };
    if (answer.tag === "Failed") return { kind: "failed", reason: answer.value };
    return { kind: "success", success: { ...answer.value, phoneStatementAccount: signer } };
  } catch {
    return null;
  }
}

// Exposed for tests that play the phone's side.
export const _wire = { VersionedResponse, EncryptedResponse };
