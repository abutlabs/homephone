import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newIdentity, newHousehold, keyIdHex, seal, open, encodeMessage, decodeMessage, MsgType,
  compactFromSdp, sdpFromCompact, encodeCompactSdp, decodeCompactSdp, statementSize, STATEMENT_MAX_BYTES, randomBytes,
} from "../src/index.ts";

const CHROME_OFFER = [
  "v=0", "o=- 123 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "a=group:BUNDLE 0", "a=msid-semantic: WMS",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126", "c=IN IP4 0.0.0.0", "a=rtcp:9 IN IP4 0.0.0.0",
  "a=candidate:1 1 udp 2122260223 192.168.1.20 54400 typ host generation 0",
  "a=candidate:2 1 udp 2122262783 2a02:a46d:1:2::5 54401 typ host generation 0",
  "a=candidate:3 1 udp 2122194687 4a8f1c2e-1b3d-4e5f-8a9b-0c1d2e3f4a5b.local 54402 typ host",
  "a=candidate:4 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active",
  "a=candidate:5 1 udp 1686052607 84.12.34.56 54400 typ srflx raddr 192.168.1.20 rport 54400",
  "a=candidate:6 1 udp 41885439 3.4.5.6 3478 typ relay raddr 84.12.34.56 rport 54400",
  "a=candidate:1 2 udp 2122260222 192.168.1.20 54403 typ host",
  "a=ice-ufrag:Xk3q", "a=ice-pwd:asd88fgpdd777uzjYhagZg4a", "a=ice-options:trickle",
  "a=fingerprint:sha-256 " + Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":"),
  "a=setup:actpass", "a=mid:0", "a=sendrecv", "a=rtcp-mux",
  "a=rtpmap:111 opus/48000/2", "a=fmtp:111 minptime=10;useinbandfec=1", "a=rtpmap:0 PCMU/8000", "",
].join("\r\n");

test("offer fits a statement, round-trips, and only the right household can read it", () => {
  const caller = newIdentity();
  const home = newHousehold();
  const compact = compactFromSdp(CHROME_OFFER);
  assert.equal(compact.payloadType, 111);
  assert.deepEqual(compact.candidates.map((c) => c.type + " " + c.address), [
    "host 192.168.1.20", "srflx 84.12.34.56", "relay 3.4.5.6",
    "host 4a8f1c2e-1b3d-4e5f-8a9b-0c1d2e3f4a5b.local", "host 2a02:a46d:1:2::5",
  ]);
  const msg = { type: MsgType.Offer, callId: randomBytes(8), seq: 0, ts: 1_800_000_000, sdp: compact } as const;
  const env = seal(encodeMessage(msg), caller, home.boxPub);
  const size = statementSize(env);
  console.log("offer envelope", env.length, "bytes; statement JSON", size, "bytes");
  assert.ok(size <= STATEMENT_MAX_BYTES);

  const lookup = (id: string) => (id === keyIdHex(caller.signPub) ? caller : undefined);
  const opened = open(env, home, lookup);
  assert.ok(opened);
  const back = decodeMessage(opened.body);
  assert.equal(back.type, MsgType.Offer);
  const sdp = sdpFromCompact((back as any).sdp);
  assert.deepEqual(encodeCompactSdp(compactFromSdp(sdp)), encodeCompactSdp(compact));
  assert.deepEqual(decodeCompactSdp(encodeCompactSdp(compact)), compact);

  assert.equal(open(env, newHousehold(), lookup), null, "other household can't read");
  assert.equal(open(env, home, () => undefined), null, "unknown caller is dropped");
  const tampered = env.slice(); tampered[60] ^= 1;
  assert.equal(open(tampered, home, lookup), null, "tampering detected");
});
