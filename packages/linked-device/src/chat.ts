// The Polkadot App's chat transport, as a linked device reads it.
// docs/linked-device-spec.md §2; byte-compatible with @novasamatech/statement-store
// and @novasamatech/host-chat 0.12 (what Polkadot Desktop uses), plus Android's
// index-19 message, which host-chat 0.12 mis-declares.
//
// Two channels per contact B, seen from the owner A:
//
//   identity channel  K = X25519(A.chatPriv, B.chatPub)    (on-chain keys only)
//                     A→B topic SessionId(K, A.id, B.id), B→A topic SessionId(K, B.id, A.id)
//                     data = Enc(K)(StatementData.request)  — roster messages, e.g. deviceChatAccepted
//   main session      per sending device B': K = X25519(A.chatPriv, B'.encPub)
//                     B'→A topic SessionId(K, B'.stmt, A.id)
//                     data = Enc(K)(StatementData.multiRequest): one-shot key wrapped per recipient device
//
// Enc(S): key = HKDF-SHA256(S); nonce(12) ‖ ChaCha20-Poly1305.

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { Bytes, Enum, Option, Struct, Vector, _void, compact, str, u32, u64, u8, type CodecType } from "scale-ts";

const te = new TextEncoder();
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

export const khash = (key: Uint8Array, msg: Uint8Array) => blake2b(msg, { dkLen: 32, key });

/** SessionId(S, a, b) = khash(S, "session" ‖ a ‖ b ‖ "/" ‖ "/") — chat never uses pins. */
export const sessionId = (shared: Uint8Array, a: Uint8Array, b: Uint8Array) =>
  khash(shared, concat(te.encode("session"), a, b, te.encode("//")));
export const requestChannel = (topic: Uint8Array) => khash(topic, te.encode("request"));
export const responseChannel = (topic: Uint8Array) => khash(topic, te.encode("response"));

export function encryption(shared: Uint8Array) {
  const key = hkdf(sha256, shared, new Uint8Array(), new Uint8Array(), 32);
  return {
    encrypt(plain: Uint8Array): Uint8Array {
      const nonce = randomBytes(12);
      return concat(nonce, chacha20poly1305(key, nonce).encrypt(plain));
    },
    decrypt(sealed: Uint8Array): Uint8Array {
      return chacha20poly1305(key, sealed.subarray(0, 12)).decrypt(sealed.subarray(12));
    },
  };
}

const aeadRaw = (key: Uint8Array) => ({
  decrypt: (sealed: Uint8Array) => chacha20poly1305(key, sealed.subarray(0, 12)).decrypt(sealed.subarray(12)),
  encrypt(plain: Uint8Array) {
    const nonce = randomBytes(12);
    return concat(nonce, chacha20poly1305(key, nonce).encrypt(plain));
  },
});

// ---- StatementData (statement-store session/scale/statementData) ----------------

const Request = Struct({ requestId: str, data: Vector(Bytes()) });
const Response = Struct({ requestId: str, responseCode: u8 });
const RequestDeviceInfo = Struct({ statementAccountId: Bytes(32), encryptedKey: Bytes() });
export const StatementData = Enum({
  request: Request,
  response: Response,
  multiRequest: Struct({ encryptedRequest: Bytes(), devicesInfo: Vector(RequestDeviceInfo) }),
  multiResponse: Struct({ encryptedResponse: Bytes(), devicesInfo: Vector(RequestDeviceInfo) }),
});
export { Request as RequestCodec };

// ---- ChatMessage (host-chat codec/message + attachment) ---------------------------

const GeneralFileMeta = Struct({ mimeType: str, fileSize: u32 });
const FileMeta = Enum({
  general: GeneralFileMeta,
  image: Struct({ general: GeneralFileMeta, width: u32, height: u32, thumbnail: Option(Bytes()) }),
  video: Struct({ general: GeneralFileMeta, duration: u32, thumbnail: Option(Bytes()) }),
});
const FileVariant = Enum({
  p2pMixnet: Struct({
    identifier: Bytes(),
    claimTicket: Bytes(),
    nodeEndpoint: Enum({ wssUrl: Struct({ url: str }) }),
    meta: FileMeta,
  }),
});
const RichText = Struct({ text: Option(str), attachments: Option(Vector(FileVariant)) });

export const MessageContent = Enum({
  text: str, // 0
  token: Struct({ token: Bytes(), platform: u8 }), // 1
  send: Struct({ amount: compact, assetId: Option(str), blockHash: Bytes(32), extrinsicHash: Bytes(32) }), // 2
  contactAdded: _void, // 3
  reacted: Struct({ messageId: str, emoji: str }), // 4
  reactionRemoved: Struct({ messageId: str, emoji: str }), // 5
  _reserved6: _void, // 6
  reply: Struct({ messageId: str, ownContent: RichText }), // 7
  dataChannelOffer: Struct({ sdp: Bytes(), purpose: u8 }), // 8 (0 audio, 1 video)
  dataChannelAnswer: Struct({ offerMessageId: str, sdp: Bytes() }), // 9
  dataChannelIceCandidate: Struct({ offerMessageId: str, sdp: Bytes() }), // 10
  dataChannelClosed: Struct({ offerMessageId: str }), // 11
  edit: Struct({ messageId: str, newContent: RichText }), // 12
  leftChat: _void, // 13
  chatAccepted: Struct({ messageId: str }), // 14
  richText: RichText, // 15
  coinagePayment: Struct({ totalValue: compact, coinKeys: Vector(Bytes()) }), // 16
  deviceAdded: Struct({ statementAccountId: Bytes(), encryptionPublicKey: Bytes() }), // 17
  deviceRemoved: Struct({ statementAccountId: Bytes() }), // 18
  // 19: Android's compaction commit (host-chat 0.12 declares it _void, which mis-reads batches).
  compactionCommit: Struct({ claimIdentifier: Bytes(), claimTicket: Bytes(), node: Enum({ WssUrl: str }) }),
  deviceChatAccepted: Struct({
    requestId: str,
    device: Struct({ statementAccountId: Bytes(32), encryptionPublicKey: Bytes(32) }),
  }), // 20
});
export const ChatMessage = Struct({ messageId: str, timestamp: u64, versioned: Enum({ v1: MessageContent }) });
export type ChatMessageT = CodecType<typeof ChatMessage>;
export type Content = CodecType<typeof MessageContent>;

export interface DeviceKeys {
  stmt: Uint8Array;
  encPub: Uint8Array;
}

// ---- the identity channel ----------------------------------------------------------

export function identityChannel(own: { id: Uint8Array; chatPriv: Uint8Array }, peer: { id: Uint8Array; chatPub: Uint8Array }) {
  const shared = x25519.getSharedSecret(own.chatPriv, peer.chatPub);
  return {
    topicOut: sessionId(shared, own.id, peer.id),
    topicIn: sessionId(shared, peer.id, own.id),
    enc: encryption(shared),
  };
}

// ---- the main (multi-device) session -------------------------------------------------

/** The topic peer device B' writes to us on, and how to open what it writes. */
export function mainIncoming(
  own: { id: Uint8Array; chatPriv: Uint8Array; deviceStmt: Uint8Array; deviceEncPriv: Uint8Array },
  peerDevice: DeviceKeys,
) {
  const shared = x25519.getSharedSecret(own.chatPriv, peerDevice.encPub);
  const enc = encryption(shared);
  return {
    topic: sessionId(shared, peerDevice.stmt, own.id),
    /** Returns the request inside, if it was addressed to this device; null if not for us. */
    open(data: Uint8Array): CodecType<typeof StatementData> | { tag: "request"; value: CodecType<typeof Request> } | null {
      const sd = StatementData.dec(enc.decrypt(data));
      if (sd.tag !== "multiRequest" && sd.tag !== "multiResponse") return sd;
      const payload = sd.tag === "multiRequest" ? sd.value.encryptedRequest : sd.value.encryptedResponse;
      const entry = sd.value.devicesInfo.find((d) => Buffer.from(d.statementAccountId).equals(Buffer.from(own.deviceStmt)));
      if (!entry) return null;
      const oneShot = encryption(x25519.getSharedSecret(own.deviceEncPriv, peerDevice.encPub)).decrypt(entry.encryptedKey);
      const inner = aeadRaw(oneShot).decrypt(payload);
      return sd.tag === "multiRequest"
        ? { tag: "request", value: Request.dec(inner) }
        : { tag: "response", value: Response.dec(inner) };
    },
  };
}

export function decodeMessages(req: CodecType<typeof Request>): ChatMessageT[] {
  const out: ChatMessageT[] = [];
  for (const d of req.data) {
    try {
      out.push(ChatMessage.dec(d));
    } catch {
      // unknown or newer variant: skip this one message, keep the rest
    }
  }
  return out;
}

/** One-line description of a message, for logs. Never prints secrets. */
export function describe(m: ChatMessageT): string {
  const c = m.versioned.value;
  const hex = (b: Uint8Array) => "0x" + Buffer.from(b).toString("hex");
  switch (c.tag) {
    case "text":
      return `text "${c.value}"`;
    case "richText":
      return `richText "${c.value.text ?? ""}"${c.value.attachments ? ` +${c.value.attachments.length} file(s)` : ""}`;
    case "deviceAdded":
      return `deviceAdded stmt=${hex(c.value.statementAccountId)} enc=${hex(c.value.encryptionPublicKey)}`;
    case "deviceChatAccepted":
      return `deviceChatAccepted stmt=${hex(c.value.device.statementAccountId)} enc=${hex(c.value.device.encryptionPublicKey)}`;
    case "dataChannelOffer":
      return `CALL OFFER (${c.value.purpose === 0 ? "audio" : "video"}) id=${m.messageId} sdp=${c.value.sdp.length}B`;
    case "dataChannelAnswer":
      return `call answer for ${c.value.offerMessageId}`;
    case "dataChannelIceCandidate":
      return `ICE candidates for ${c.value.offerMessageId}`;
    case "dataChannelClosed":
      return `call closed ${c.value.offerMessageId}`;
    default:
      return c.tag;
  }
}
