// Sending chat messages to a contact as a linked device (main session, multi-device).
// docs/linked-device-spec.md §2.4a "Outgoing" and §2.2.
//
//   K       = X25519(D.encPriv, B.chatPub)          (B decrypts with X25519(B.chatPriv, D.encPub))
//   topic   = SessionId(K, D.stmt, B.id)
//   request = AeadRaw(oneShot)(Request{requestId, data: [ChatMessage...]})
//   keys    = per B device R: Enc(X25519(D.encPriv, R.encPub))(oneShot)
//   data    = Enc(K)(StatementData.multiRequest{request, keys})
//   statement: channel = RequestChannel(topic), topic1 = topic, expiry = never-expire | priority,
//              signed by D.stmt. The store keeps one statement per (signer, channel), so each
//              new batch replaces the last: our 2-statement allowance is never exceeded.

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import {
  ChatMessage, RequestCodec, StatementData, encryption, requestChannel, sessionId, type Content, type DeviceKeys,
} from "./chat.ts";
import { encodeStatement, signStatement, type Statement } from "./statement.ts";

const PRIORITY_EPOCH = 1763164800; // 2025-11-15T00:00:00Z (statement-store allocator)
let lastPriority = 0;

/** expiry = (0xFFFFFFFF << 32) | priority, priority strictly increasing. */
export function nextExpiry(nowMs = Date.now()): bigint {
  lastPriority = Math.max(lastPriority + 1, Math.floor(nowMs / 1000) - PRIORITY_EPOCH);
  return (0xffffffffn << 32n) | BigInt(lastPriority);
}

/** Raise the floor after the node says our priority is too low (min_expiry from the rejection). */
export function bumpPriority(minExpiry: bigint): void {
  lastPriority = Math.max(lastPriority, Number(minExpiry & 0xffffffffn));
}

const ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
export function nanoid(size = 21): string {
  const bytes = randomBytes(size);
  let id = "";
  for (let i = 0; i < size; i++) id += ALPHABET[bytes[i]! & 63];
  return id;
}

export interface OwnDevice {
  deviceStmt: Uint8Array;
  deviceStmtSecret: Uint8Array; // 64-byte sr25519 secret
  deviceEncPriv: Uint8Array;
}

export function chatMessage(content: Content, messageId: string = crypto.randomUUID()): Uint8Array {
  return ChatMessage.enc({ messageId, timestamp: BigInt(Date.now()), versioned: { tag: "v1", value: content } });
}

export function mainOutgoing(own: OwnDevice, peer: { id: Uint8Array; chatPub: Uint8Array }) {
  const shared = x25519.getSharedSecret(own.deviceEncPriv, peer.chatPub);
  const topic = sessionId(shared, own.deviceStmt, peer.id);
  const enc = encryption(shared);
  return {
    topic,
    /** A signed statement carrying `messages` to every device in `recipients`. */
    statement(messages: Uint8Array[], recipients: DeviceKeys[]): Uint8Array {
      if (recipients.length === 0) throw new Error("no recipient devices");
      const oneShot = randomBytes(32);
      const nonce = randomBytes(12);
      const plain = RequestCodec.enc({ requestId: nanoid(), data: messages });
      const encryptedRequest = new Uint8Array([...nonce, ...chacha20poly1305(oneShot, nonce).encrypt(plain)]);
      const devicesInfo = recipients.map((r) => ({
        statementAccountId: r.stmt,
        encryptedKey: encryption(x25519.getSharedSecret(own.deviceEncPriv, r.encPub)).encrypt(oneShot),
      }));
      const data = enc.encrypt(StatementData.enc({ tag: "multiRequest", value: { encryptedRequest, devicesInfo } }));
      const st: Statement = { expiry: nextExpiry(), channel: requestChannel(topic), topics: [topic], data };
      return encodeStatement(signStatement(st, own.deviceStmtSecret, own.deviceStmt));
    },
  };
}
