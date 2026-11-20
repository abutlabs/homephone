import { test } from "node:test";
import assert from "node:assert/strict";
import { x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { getPublicKey, secretFromSeed } from "@scure/sr25519";
import { decodeMessages, mainIncoming, requestChannel } from "../src/chat.ts";
import { chatMessage, mainOutgoing } from "../src/send.ts";
import { decodeStatement, verifiedSigner } from "../src/statement.ts";

const kp = () => { const priv = x25519.utils.randomSecretKey(); return { priv, pub: x25519.getPublicKey(priv) }; };

test("the caller's phone can open our answer", () => {
  // Us: linked device D of the house. Them: contact B, whose phone is device B'.
  const dSecret = secretFromSeed(randomBytes(32));
  const D = { stmt: getPublicKey(dSecret), enc: kp() };
  const B = { id: randomBytes(32), chat: kp() };
  const Bp = { stmt: B.id, enc: kp() }; // Android: the phone's statement account is the identity account

  const out = mainOutgoing({ deviceStmt: D.stmt, deviceStmtSecret: dSecret, deviceEncPriv: D.enc.priv }, { id: B.id, chatPub: B.chat.pub });
  const bytes = out.statement(
    [chatMessage({ tag: "dataChannelAnswer", value: { offerMessageId: "offer-1", sdp: new Uint8Array([7, 7]) } })],
    [{ stmt: Bp.stmt, encPub: Bp.enc.pub }],
  );
  const st = decodeStatement(bytes);
  assert.deepEqual(verifiedSigner(st), D.stmt, "signed by our device key");
  assert.deepEqual(st.channel, requestChannel(out.topic));
  assert.equal(st.expiry! >> 32n, 0xffffffffn);

  // B' side: incoming from our device D, keyed with B's chat key.
  const theirs = mainIncoming({ id: B.id, chatPriv: B.chat.priv, deviceStmt: Bp.stmt, deviceEncPriv: Bp.enc.priv }, { stmt: D.stmt, encPub: D.enc.pub });
  assert.deepEqual(theirs.topic, out.topic, "B' listens on the topic we write to");
  const opened = theirs.open(st.data!);
  assert.ok(opened && opened.tag === "request");
  const [m] = decodeMessages((opened as any).value);
  assert.equal(m!.versioned.value.tag, "dataChannelAnswer");
  assert.equal((m!.versioned.value.value as any).offerMessageId, "offer-1");
});
