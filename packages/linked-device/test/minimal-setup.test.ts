import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCandidates, decodeMinimalSetup, encodeCandidates, encodeMinimalSetup } from "../src/minimal-setup.ts";

const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");

// aiortc-style answer: three fingerprints, sha-256 first; one IPv4 and one IPv6 host candidate.
const ANSWER = [
  "v=0", "o=- 5 2 IN IP4 0.0.0.0", "s=-", "t=0 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "c=IN IP4 0.0.0.0",
  "a=candidate:1 1 udp 2122260223 192.168.1.20 54400 typ host",
  "a=candidate:2 1 udp 2122260222 2001:db8::1 54401 typ host",
  "a=candidate:3 1 udp 2122194687 abcd1234-0000-4000-8000-000000000000.local 54402 typ host",
  "a=ice-ufrag:ab", "a=ice-pwd:cd",
  `a=fingerprint:sha-256 ${FP}`, "a=fingerprint:sha-384 00", "a=fingerprint:sha-512 FF",
  "a=setup:active", "a=mid:0", "a=sctp-port:5000", "",
].join("\r\n");

test("MinimalSetup bytes match the SCALE layout in the spec", () => {
  const bytes = encodeMinimalSetup(ANSWER);
  const hex = Buffer.from(bytes).toString("hex");
  const expected =
    "01" + // sdpType ANSWER
    "14" + // sessionId compact(5)
    "08" + // sessionVersion compact(2)
    "08" + "6162" + // "ab"
    "08" + "6364" + // "cd"
    "80" + Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("hex") + // Bytes(): compact(32) + sha-256 only
    "08" + // two candidates (the mDNS one is dropped, as the App does)
    "04" + "31" + "ff1e7f7e" + "01" + "00" + "c0a80114" + "80d4" + "00" + // 1, 2122260223 LE, UDP, Ipv4, port 54400 LE, HOST
    "04" + "32" + "fe1e7f7e" + "01" + "01" + "0120b80d000000000000000000000100" + "81d4" + "00"; // IPv6 as 8 LE u16
  assert.equal(hex, expected);
});

test("decode rebuilds Desktop's template, with candidates inlined for aiortc", () => {
  const d = decodeMinimalSetup(encodeMinimalSetup(ANSWER));
  assert.equal(d.type, "answer");
  assert.equal(d.sdp, [
    "v=0", "o=- 5 2 IN IP4 0.0.0.0", "s=-", "t=0 0",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "c=IN IP4 0.0.0.0",
    "a=ice-ufrag:ab", "a=ice-pwd:cd", `a=fingerprint:sha-256 ${FP}`,
    "a=setup:active", "a=mid:0", "a=sctp-port:5000", "",
  ].join("\r\n"));
  assert.deepEqual(d.candidates, [
    "candidate:1 1 udp 2122260223 192.168.1.20 54400 typ host",
    "candidate:2 1 udp 2122260222 2001:db8:0:0:0:0:0:1 54401 typ host",
  ]);
  assert.ok(d.sdpWithCandidates.endsWith("a=candidate:2 1 udp 2122260222 2001:db8:0:0:0:0:0:1 54401 typ host\r\n"));
});

test("trickle candidates round-trip as a bare Vec", () => {
  const lines = ["candidate:9 1 udp 1686052607 84.12.34.56 3478 typ srflx", "candidate:8 1 tcp 1518280447 10.0.0.2 9 typ host"];
  assert.deepEqual(decodeCandidates(encodeCandidates(lines)), lines);
});
