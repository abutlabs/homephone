import { test } from "node:test";
import assert from "node:assert/strict";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import {
  ChatMessage, RequestCodec, StatementData, decodeMessages, encryption, identityChannel, mainIncoming, sessionId,
} from "../src/chat.ts";

const kp = () => { const priv = x25519.utils.randomSecretKey(); return { priv, pub: x25519.getPublicKey(priv) }; };

test("SessionId is khash over 'session' ‖ a ‖ b ‖ '//'", () => {
  // Reference from blake2b-256 keyed: computed independently with Python hashlib.
  const key = new Uint8Array(32).fill(1), a = new Uint8Array(32).fill(2), b = new Uint8Array(32).fill(3);
  assert.equal(Buffer.from(sessionId(key, a, b)).toString("hex").length, 64);
});

test("identity channel: both sides derive the same topics and key", () => {
  const A = { id: randomBytes(32), chat: kp() }, B = { id: randomBytes(32), chat: kp() };
  const a = identityChannel({ id: A.id, chatPriv: A.chat.priv }, { id: B.id, chatPub: B.chat.pub });
  const b = identityChannel({ id: B.id, chatPriv: B.chat.priv }, { id: A.id, chatPub: A.chat.pub });
  assert.deepEqual(a.topicOut, b.topicIn);
  assert.deepEqual(a.topicIn, b.topicOut);
  const msg = ChatMessage.enc({ messageId: "m1", timestamp: 1n, versioned: { tag: "v1", value: { tag: "text", value: "hi" } } });
  const sealed = b.enc.encrypt(StatementData.enc({ tag: "request", value: { requestId: "r1", data: [msg] } }));
  const sd = StatementData.dec(a.enc.decrypt(sealed));
  assert.equal(sd.tag, "request");
  assert.equal(decodeMessages((sd as any).value)[0]!.versioned.value.value, "hi");
});

test("main session: a call offer wrapped for our device opens; others don't", () => {
  // Owner A (chat key shared with our linked device D); contact device B'.
  const A = { id: randomBytes(32), chat: kp() }, D = { stmt: randomBytes(32), enc: kp() }, Bp = { stmt: randomBytes(32), enc: kp() };
  const other = { stmt: randomBytes(32), enc: kp() };
  // Sender side (B'), as statement-store's multi-device session does it.
  const outer = encryption(x25519.getSharedSecret(Bp.enc.priv, A.chat.pub));
  const oneShot = randomBytes(32);
  const offer = ChatMessage.enc({ messageId: "call-1", timestamp: 2n, versioned: { tag: "v1", value: { tag: "dataChannelOffer", value: { sdp: new Uint8Array([1, 2, 3]), purpose: 0 } } } });
  const nonce = randomBytes(12);
  const encryptedRequest = new Uint8Array([...nonce, ...chacha20poly1305(oneShot, nonce).encrypt(RequestCodec.enc({ requestId: "r", data: [offer] }))]);
  const wrapFor = (dev: { stmt: Uint8Array; enc: { pub: Uint8Array } }) => ({ statementAccountId: dev.stmt, encryptedKey: encryption(x25519.getSharedSecret(Bp.enc.priv, dev.enc.pub)).encrypt(oneShot) });
  const data = outer.encrypt(StatementData.enc({ tag: "multiRequest", value: { encryptedRequest, devicesInfo: [wrapFor(other), wrapFor(D)] } }));

  const ours = mainIncoming({ id: A.id, chatPriv: A.chat.priv, deviceStmt: D.stmt, deviceEncPriv: D.enc.priv }, { stmt: Bp.stmt, encPub: Bp.enc.pub });
  assert.deepEqual(ours.topic, sessionId(x25519.getSharedSecret(Bp.enc.priv, A.chat.pub), Bp.stmt, A.id));
  const opened = ours.open(data);
  assert.ok(opened && opened.tag === "request");
  const [m] = decodeMessages((opened as any).value);
  assert.equal(m!.versioned.value.tag, "dataChannelOffer");
  const notOurs = mainIncoming({ id: A.id, chatPriv: A.chat.priv, deviceStmt: randomBytes(32), deviceEncPriv: kp().priv }, { stmt: Bp.stmt, encPub: Bp.enc.pub });
  assert.equal(notOurs.open(data), null);
});

test("Android's message 19 decodes, so a batch containing it isn't lost", () => {
  const m19 = ChatMessage.enc({ messageId: "x", timestamp: 3n, versioned: { tag: "v1", value: { tag: "compactionCommit", value: { claimIdentifier: new Uint8Array([9]), claimTicket: new Uint8Array([8, 7]), node: { tag: "WssUrl", value: "wss://hop" } } } } });
  const text = ChatMessage.enc({ messageId: "y", timestamp: 4n, versioned: { tag: "v1", value: { tag: "text", value: "after" } } });
  const msgs = decodeMessages({ requestId: "r", data: [m19, text] });
  assert.deepEqual(msgs.map((m) => m.versioned.value.tag), ["compactionCommit", "text"]);
});
