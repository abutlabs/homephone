// CLI for the App's MinimalSetup codec, used by the Python tests.
//
//   node bin/minimal-setup.ts encode < local.sdp   -> hex SCALE(MinimalSetup)
//   node bin/minimal-setup.ts decode < setup.hex   -> rebuilt SDP, candidates inlined

import { readFileSync } from "node:fs";
import { decodeMinimalSetup, encodeMinimalSetup } from "../src/minimal-setup.ts";

const input = readFileSync(0, "utf8");
const cmd = process.argv[2];
if (cmd === "encode") {
  process.stdout.write(Buffer.from(encodeMinimalSetup(input)).toString("hex") + "\n");
} else if (cmd === "decode") {
  process.stdout.write(decodeMinimalSetup(Uint8Array.from(Buffer.from(input.trim(), "hex"))).sdpWithCandidates);
} else {
  process.stderr.write("usage: minimal-setup.ts encode|decode < input\n");
  process.exit(2);
}
