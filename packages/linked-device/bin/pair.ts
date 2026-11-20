// Pair this machine with your Polkadot App as a linked device.
//
//   node packages/linked-device/bin/pair.ts [--name Homephone] [--out .secrets/linked-device.json]
//
// Shows a QR code (scan it in the App under Connected Devices) and the same
// link as text (tap it on the phone itself). Waits for the phone's encrypted
// answer on the People chain, then saves the session keys to --out with
// owner-only permissions. Devnet only for now.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
// @ts-expect-error: no types published
import qrcode from "qrcode-terminal";
import { newDeviceIdentity, pairingDeeplink, pairingTopic, readPairingAnswer } from "../src/pairing.ts";
import { PeopleRpc, fromHex, toHex } from "../src/people-rpc.ts";

const { values } = parseArgs({
  options: {
    name: { type: "string", default: "Homephone" },
    out: { type: "string", default: ".secrets/linked-device.json" },
    link: { type: "string", default: ".secrets/pairing-link.txt" },
    timeout: { type: "string", default: "600" },
  },
});

const device = newDeviceIdentity();
const link = pairingDeeplink(device, { name: values.name!, version: "0.1.0", platformType: "Linux" });
const topic = toHex(pairingTopic(device));

mkdirSync(dirname(values.link!), { recursive: true, mode: 0o700 });
writeFileSync(values.link!, link + "\n", { mode: 0o600 });

console.log(`\nPair "${values.name}" with your Polkadot App (devnet): Settings → Connected Devices.\n`);
qrcode.generate(link, { small: true });
console.log(`\nOr tap this link on the phone (also saved to ${values.link}):\n${link}\n`);
console.log(`Waiting for the phone's answer on topic ${topic.slice(0, 18)}…`);

const rpc = await PeopleRpc.connect();
let done = false;
const timer = setTimeout(() => {
  if (!done) {
    console.error("Timed out waiting for the phone. Run again to get a fresh code.");
    rpc.close();
    process.exit(1);
  }
}, Number(values.timeout) * 1000);

await rpc.subscribe({ matchAll: [topic] }, (hex) => {
  if (done) return;
  const answer = readPairingAnswer(fromHex(hex), device);
  if (!answer) return;
  if (answer.kind === "pending") {
    console.log("Phone approved; it is allocating this device's Statement Store allowance…");
    return;
  }
  done = true;
  clearTimeout(timer);
  if (answer.kind === "failed") {
    console.error(`The phone declined: ${answer.reason}`);
    rpc.close();
    process.exit(1);
  }
  const s = answer.success;
  const hexOf = (b: Uint8Array) => toHex(b);
  const record = {
    note: "Homephone linked-device session (devnet). Contains the owner's chat key: keep private, never commit.",
    created: new Date().toISOString(),
    hostName: values.name,
    device: {
      stmtSecret: hexOf(device.stmtSecret),
      stmtPublic: hexOf(device.stmtPublic),
      encSecret: hexOf(device.encSecret),
      encPublic: hexOf(device.encPublic),
    },
    owner: {
      identityAccountId: hexOf(s.identityAccountId),
      rootAccountId: hexOf(s.rootAccountId),
      identityChatPrivateKey: hexOf(s.identityChatPrivateKey),
      ssoEncPubKey: hexOf(s.ssoEncPubKey),
      rootEntropySource: hexOf(s.rootEntropySource),
    },
    phone: { statementAccount: hexOf(s.phoneStatementAccount), deviceEncPubKey: hexOf(s.deviceEncPubKey) },
  };
  mkdirSync(dirname(values.out!), { recursive: true, mode: 0o700 });
  writeFileSync(values.out!, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  console.log(`\nPaired. Owner identity ${hexOf(s.identityAccountId)}; session saved to ${values.out}.`);
  rpc.close();
  process.exit(0);
});
