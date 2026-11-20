import { test } from "node:test";
import assert from "node:assert/strict";
import { blake2b } from "@noble/hashes/blake2.js";
import { verify, sign } from "@scure/sr25519";
import { INDEX_MAGIC, chainCode, keysFromEntropy } from "../src/account.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const AB = new Uint8Array(16).fill(0xab);

// Vectors from the App's tests and TrUAPI (product_account/tests.rs), collected in docs/restore-spec.md.
test("chain codes and index magic", () => {
  assert.equal(hex(chainCode("chat")), "1063686174" + "00".repeat(27));
  assert.equal(hex(chainCode("peopl.paseo")), "2c70656f706c2e706173656f" + "00".repeat(20));
  assert.equal(hex(INDEX_MAGIC), "12e86013736c5498f050b03cdc16957dff0e422fb92ca77ec3ab168f");
});

test("root, identity and chat key match the App's vectors (entropy AB×16)", () => {
  assert.equal(hex(keysFromEntropy(AB).rootPublic), "0062ba8ae929ea64bc2ad6f21359e96a29e236a41d376d1c5ba76491da94fc72");
  assert.equal(hex(keysFromEntropy(AB, "dot").identityPublic), "a0b73b355b11feb718f5080d32f12b33fa41fe9f1a3336e3e1fbe639dfea3907");
  assert.equal(hex(keysFromEntropy(AB, "paseo").identityPublic), "0c700a85ca5cdfd1e98c2a03dc00d80899447edaa719671ad48afe386e784e72");
  const k = keysFromEntropy(AB);
  assert.equal(hex(k.chatPriv), "e9a4ba42ad134d0a8294286faccc0fb7a5ea5e8ad44138c49f6c51a9e64ca680");
  assert.equal(hex(k.chatPub), "fd5d29bfc104b18ab472c663eb71660b58c0a6976e04637ec68cbdd5132f7277");
});

test("chat key for entropy 00..1f, and the identity secret signs", () => {
  const e = Uint8Array.from({ length: 32 }, (_, i) => i);
  const k = keysFromEntropy(e);
  assert.equal(hex(k.chatPub), "d08180828082ba4a715b474c2a029026b6cdddbcc7dad5c235724a3ad4058607");
  const msg = blake2b(new Uint8Array([1, 2, 3]));
  assert.ok(verify(msg, sign(k.identitySecret, msg), k.identityPublic));
});
