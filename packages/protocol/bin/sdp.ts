// Command-line access to the compact SDP codec, for tests and debugging.
//
//   node bin/sdp.ts compact < full.sdp     -> base64 compact form
//   node bin/sdp.ts expand  < compact.b64  -> full SDP
//   node bin/sdp.ts size    < full.sdp     -> bytes of statement JSON for a sealed offer

import { readFileSync } from "node:fs";
import {
  compactFromSdp, decodeCompactSdp, encodeCompactSdp, fromBase64, toBase64, sdpFromCompact,
  newIdentity, newHousehold, seal, encodeMessage, MsgType, randomBytes, statementSize,
} from "../src/index.ts";

const input = readFileSync(0, "utf8");
const cmd = process.argv[2];
if (cmd === "compact") {
  process.stdout.write(toBase64(encodeCompactSdp(compactFromSdp(input))) + "\n");
} else if (cmd === "expand") {
  process.stdout.write(sdpFromCompact(decodeCompactSdp(fromBase64(input.trim()))));
} else if (cmd === "size") {
  const body = encodeMessage({ type: MsgType.Offer, callId: randomBytes(8), seq: 0, ts: 0, sdp: compactFromSdp(input) });
  process.stdout.write(`${statementSize(seal(body, newIdentity(), newHousehold().boxPub))}\n`);
} else {
  process.stderr.write("usage: sdp.ts compact|expand|size < input\n");
  process.exit(2);
}
