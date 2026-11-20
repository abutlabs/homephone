import { test } from "node:test";
import assert from "node:assert/strict";
import { x25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { getPublicKey, secretFromSeed } from "@scure/sr25519";
import {
  _wire, aeadKey, decodeDeeplink, newDeviceIdentity, pairingDeeplink, pairingTopic, readPairingAnswer, seal,
} from "../src/pairing.ts";
import { decodeStatement, encodeStatement, signStatement, verifiedSigner } from "../src/statement.ts";

test("deeplink carries the V2 proposal: tag 0x01, keys, then metadata", () => {
  const d = newDeviceIdentity();
  const link = pairingDeeplink(d, { name: "Homephone", version: "0.1.0" });
  assert.match(link, /^polkadotapp:\/\/pair\?handshake=01[0-9a-f]+$/);
  const hex = link.split("=")[1]!;
  assert.equal(hex.slice(2, 66), Buffer.from(d.stmtPublic).toString("hex"));
  assert.equal(hex.slice(66, 130), Buffer.from(d.encPublic).toString("hex"));
  // metadata: Vec of 2 -> 08; HostName (01) "Homephone" (len 9 -> 24); HostVersion (02) "0.1.0" (len 5 -> 14)
  assert.equal(hex.slice(130), "08" + "01" + "24" + Buffer.from("Homephone").toString("hex") + "02" + "14" + Buffer.from("0.1.0").toString("hex"));
  const p = decodeDeeplink(link);
  assert.equal(p.tag, "V2");
});

function phoneAnswer(device: ReturnType<typeof newDeviceIdentity>, response: Parameters<typeof _wire.EncryptedResponse.enc>[0]) {
  const phoneSecret = secretFromSeed(randomBytes(32));
  const eph = x25519.utils.randomSecretKey();
  const sealed = seal(aeadKey(eph, device.encPublic), _wire.EncryptedResponse.enc(response));
  const data = _wire.VersionedResponse.enc({ tag: "V2", value: { encryptedMessage: sealed, publicKey: x25519.getPublicKey(eph) } });
  const st = signStatement({ topics: [pairingTopic(device)], expiry: 123n, data }, phoneSecret, getPublicKey(phoneSecret));
  return { bytes: encodeStatement(st), phonePublic: getPublicKey(phoneSecret) };
}

test("reads the phone's Pending and Success answers", () => {
  const device = newDeviceIdentity();
  const pending = phoneAnswer(device, { tag: "Pending", value: { tag: "AllowanceAllocation", value: undefined } });
  assert.deepEqual(readPairingAnswer(pending.bytes, device), { kind: "pending" });

  const fields = Object.fromEntries(
    ["identityAccountId", "rootAccountId", "identityChatPrivateKey", "ssoEncPubKey", "deviceEncPubKey", "rootEntropySource"]
      .map((k) => [k, randomBytes(32)]),
  ) as any;
  const ok = phoneAnswer(device, { tag: "Success", value: fields });
  const answer = readPairingAnswer(ok.bytes, device);
  assert.ok(answer && answer.kind === "success");
  assert.deepEqual(answer.success.identityChatPrivateKey, fields.identityChatPrivateKey);
  assert.deepEqual(answer.success.phoneStatementAccount, ok.phonePublic);
});

test("ignores answers for another device, and tampered or unsigned statements", () => {
  const device = newDeviceIdentity();
  const other = newDeviceIdentity();
  const msg = phoneAnswer(other, { tag: "Failed", value: "no" });
  assert.equal(readPairingAnswer(msg.bytes, device), null);
  const mine = phoneAnswer(device, { tag: "Failed", value: "user declined" });
  assert.deepEqual(readPairingAnswer(mine.bytes, device), { kind: "failed", reason: "user declined" });
  const tampered = mine.bytes.slice();
  tampered[tampered.length - 1] ^= 1;
  assert.equal(readPairingAnswer(tampered, device), null);
  const st = decodeStatement(mine.bytes);
  assert.ok(verifiedSigner(st));
  assert.equal(readPairingAnswer(encodeStatement({ ...st, proof: undefined }), device), null);
});
