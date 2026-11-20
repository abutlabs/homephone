// Substrate Statement Store statements, as the Polkadot App's chat uses them.
//
//   Statement = Vec<Field>, fields in strictly ascending index order
//   0 proof  1 decryptionKey[32]  2 expiry u64  3 channel[32]  4..7 topic1..4[32]  8 data Bytes
//
// Signing covers the encoding *without* the proof field and *without* the Vec's
// length prefix; the proof (index 0) is then inserted first.
// docs/linked-device-spec.md §2.2; @novasamatech/sdk-statement codec.ts / signer.ts.

import { Bytes, Enum, Struct, Vector, u64, type CodecType } from "scale-ts";
import { sign, verify } from "@scure/sr25519";

const Proof = Enum({
  sr25519: Struct({ signature: Bytes(64), signer: Bytes(32) }),
  ed25519: Struct({ signature: Bytes(64), signer: Bytes(32) }),
  ecdsa: Struct({ signature: Bytes(65), signer: Bytes(33) }),
  onChain: Struct({ who: Bytes(32), blockHash: Bytes(32), event: u64 }),
});

const Field = Enum({
  proof: Proof,
  decryptionKey: Bytes(32),
  expiry: u64,
  channel: Bytes(32),
  topic1: Bytes(32),
  topic2: Bytes(32),
  topic3: Bytes(32),
  topic4: Bytes(32),
  data: Bytes(),
});
const Fields = Vector(Field);
const FIELD_ORDER = ["proof", "decryptionKey", "expiry", "channel", "topic1", "topic2", "topic3", "topic4", "data"];

type FieldValue = CodecType<typeof Field>;
export type StatementProof = CodecType<typeof Proof>;

export interface Statement {
  proof?: StatementProof;
  decryptionKey?: Uint8Array;
  expiry?: bigint;
  channel?: Uint8Array;
  topics: Uint8Array[];
  data?: Uint8Array;
}

const TOPIC_TAGS = ["topic1", "topic2", "topic3", "topic4"] as const;

function toFields(s: Statement, withProof: boolean): FieldValue[] {
  const out: FieldValue[] = [];
  if (withProof && s.proof) out.push({ tag: "proof", value: s.proof });
  if (s.decryptionKey) out.push({ tag: "decryptionKey", value: s.decryptionKey });
  if (s.expiry !== undefined) out.push({ tag: "expiry", value: s.expiry });
  if (s.channel) out.push({ tag: "channel", value: s.channel });
  if (s.topics.length > 4) throw new Error("at most 4 topics");
  s.topics.forEach((t, i) => out.push({ tag: TOPIC_TAGS[i]!, value: t }));
  if (s.data) out.push({ tag: "data", value: s.data });
  return out;
}

export function encodeStatement(s: Statement): Uint8Array {
  return Fields.enc(toFields(s, true));
}

export function decodeStatement(bytes: Uint8Array): Statement {
  const s: Statement = { topics: [] };
  let last = -1;
  for (const f of Fields.dec(bytes)) {
    const index = FIELD_ORDER.indexOf(f.tag);
    if (index <= last) throw new Error("statement fields out of order");
    last = index;
    if (f.tag === "proof") s.proof = f.value;
    else if (f.tag === "decryptionKey") s.decryptionKey = f.value;
    else if (f.tag === "expiry") s.expiry = f.value;
    else if (f.tag === "channel") s.channel = f.value;
    else if (f.tag === "data") s.data = f.value;
    else s.topics.push(f.value);
  }
  return s;
}

/** The bytes a statement's proof signs: all fields but the proof, without the Vec length prefix. */
export function signingPayload(s: Statement): Uint8Array {
  return toFields(s, false).reduce<Uint8Array>((acc, f) => {
    const enc = Field.enc(f);
    const out = new Uint8Array(acc.length + enc.length);
    out.set(acc);
    out.set(enc, acc.length);
    return out;
  }, new Uint8Array());
}

/** Signs with a 64-byte sr25519 secret (the @scure/sr25519 / schnorrkel Ed25519-expanded form). */
export function signStatement(s: Statement, secret: Uint8Array, publicKey: Uint8Array): Statement {
  const signature = sign(secret, signingPayload(s));
  return { ...s, proof: { tag: "sr25519", value: { signature, signer: publicKey } } };
}

/** Returns the signer if the statement carries a valid sr25519 proof, else null. */
export function verifiedSigner(s: Statement): Uint8Array | null {
  if (s.proof?.tag !== "sr25519") return null;
  const { signature, signer } = s.proof.value;
  try {
    return verify(signingPayload(s), signature, signer) ? signer : null;
  } catch {
    return null;
  }
}
