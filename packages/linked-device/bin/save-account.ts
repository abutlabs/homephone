// Save the house account's recovery phrase for the Pi, without echoing it.
//
//   node packages/linked-device/bin/save-account.ts [--out .secrets/house-account.json] [--session .secrets/house-device.json]
//
// Prompts for the phrase (hidden), checks it's a valid recovery phrase, derives
// the account's identity and chat key, and, if a paired session exists, checks
// that they match that session's owner. Writes the phrase to --out with
// owner-only permissions. Testnet accounts only.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { x25519 } from "@noble/curves/ed25519.js";
import { keysFromPhrase } from "../src/account.ts";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: ".secrets/house-account.json" },
    session: { type: "string", default: ".secrets/house-device.json" },
    tld: { type: "string", default: "dot" },
  },
});

async function hiddenPrompt(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }
  stdin.setRawMode(true);
  stdin.resume();
  let input = "";
  return new Promise((resolve) => {
    stdin.on("data", (buf: Buffer) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (ch === "\u0003") process.exit(130); // Ctrl-C
        if (ch === "\u007f") input = input.slice(0, -1);
        else input += ch;
      }
    });
  });
}

const phrase = (await hiddenPrompt("House account recovery phrase (hidden): ")).trim().toLowerCase().split(/\s+/).join(" ");
let keys;
try {
  keys = keysFromPhrase(phrase, values.tld);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const hex = (b: Uint8Array) => "0x" + Buffer.from(b).toString("hex");
console.log(`identity account: ${hex(keys.identityPublic)}`);
console.log(`chat key:         ${hex(keys.chatPub)}`);

if (existsSync(values.session!)) {
  const s = JSON.parse(readFileSync(values.session!, "utf8"));
  const idOk = s.owner.identityAccountId === hex(keys.identityPublic);
  const chatOk = hex(x25519.getPublicKey(Uint8Array.from(Buffer.from(s.owner.identityChatPrivateKey.slice(2), "hex")))) === hex(keys.chatPub);
  console.log(`matches the paired house account: identity ${idOk ? "yes" : "NO"}, chat key ${chatOk ? "yes" : "NO"}`);
  if (!idOk || !chatOk) {
    console.error("Not saved: this phrase belongs to a different account.");
    process.exit(1);
  }
}

mkdirSync(dirname(values.out!), { recursive: true, mode: 0o700 });
writeFileSync(values.out!, JSON.stringify({ note: "House account recovery phrase (testnet). Never commit.", tld: values.tld, phrase }, null, 2) + "\n", { mode: 0o600 });
console.log(`saved to ${values.out}`);
