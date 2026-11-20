// The Polkadot App's call-setup format: `MinimalSetup`.
//
// A call offer or answer in the App's chat carries SCALE(MinimalSetup), not SDP
// text: the session id and version, ICE ufrag and password, the DTLS sha-256
// fingerprint and the first ICE candidates. The receiver rebuilds a fixed SDP
// template for one data channel. Audio is added later by renegotiating over
// that data channel (see data-channel.ts).
//
// Byte-for-byte parity with Polkadot Desktop
// (src/shared/peer-channel/signaling.ts, sdpCoder.ts, iceCandidate.ts) and
// Android (tools/media-connection/.../SdpCoder.kt). docs/linked-device-spec.md §3.2.

import { Bytes, Enum, Struct, Vector, _void, compact, i32, str, u16, type CodecType } from "scale-ts";

const TransportType = Enum({ TCP: _void, UDP: _void });
const IpAddress = Enum({ Ipv4: Bytes(4), Ipv6: Bytes(16) }); // Ipv6 = 8 little-endian u16
const CandidateType = Enum({ HOST: _void, SRFLX: _void, RELAY: _void, PRFLX: _void });

export const MinimalCandidateCodec = Struct({
  foundation: str,
  priority: i32,
  transportType: TransportType,
  address: IpAddress,
  port: u16,
  candidateType: CandidateType,
});
export const MinimalCandidatesCodec = Vector(MinimalCandidateCodec);

export const MinimalSetupCodec = Struct({
  sdpType: Enum({ OFFER: _void, ANSWER: _void }),
  sessionId: compact,
  sessionVersion: compact,
  iceUFrag: str,
  icePwd: str,
  fingerprint: Bytes(),
  candidates: Vector(MinimalCandidateCodec),
});

export type MinimalCandidate = CodecType<typeof MinimalCandidateCodec>;
export type MinimalSetup = CodecType<typeof MinimalSetupCodec>;

// ---- candidates ----------------------------------------------------------

function ipv6ToLeBytes(addr: string): Uint8Array | null {
  const cleaned = addr.split("%")[0] ?? addr;
  let head: string[];
  let tail: string[] = [];
  if (cleaned.includes("::")) {
    const [h, t] = cleaned.split("::");
    head = h ? h.split(":") : [];
    tail = t ? t.split(":") : [];
    if (head.length + tail.length > 8) return null;
  } else {
    head = cleaned.split(":");
    if (head.length !== 8) return null;
  }
  const parts = [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const h = parts[i] ?? "";
    if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
    const v = parseInt(h, 16);
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return out;
}

function leBytesToIpv6(b: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) parts.push(((b[i * 2] ?? 0) | ((b[i * 2 + 1] ?? 0) << 8)).toString(16));
  return parts.join(":");
}

/** Parses one `candidate:...` line (with or without the `a=` prefix). Returns null for mDNS and others the App drops. */
export function candidateFromLine(line: string): MinimalCandidate | null {
  const f = line.replace(/^a=/, "").replace(/^candidate:/, "").trim().split(/\s+/);
  // foundation component transport priority address port "typ" type ...
  if (f.length < 8 || f[6] !== "typ") return null;
  const proto = f[2]!.toLowerCase();
  if (proto !== "udp" && proto !== "tcp") return null;
  const addr = f[4]!;
  let address: MinimalCandidate["address"];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) {
    const parts = addr.split(".").map(Number);
    if (parts.some((n) => n > 255)) return null;
    address = { tag: "Ipv4", value: Uint8Array.from(parts) };
  } else if (addr.includes(":")) {
    const v = ipv6ToLeBytes(addr);
    if (!v) return null;
    address = { tag: "Ipv6", value: v };
  } else return null;
  const type = ({ host: "HOST", srflx: "SRFLX", relay: "RELAY", prflx: "PRFLX" } as const)[
    f[7]!.toLowerCase() as "host"
  ];
  if (!type) return null;
  const priority = Number(f[3]);
  const port = Number(f[5]);
  if (!Number.isInteger(priority) || priority < 0 || priority > 0x7fffffff) return null;
  if (!Number.isInteger(port) || port < 0 || port > 65535) return null;
  return {
    foundation: f[0]!,
    priority,
    transportType: { tag: proto === "udp" ? "UDP" : "TCP", value: undefined },
    address,
    port,
    candidateType: { tag: type, value: undefined },
  };
}

/** `candidate:...` text as Desktop rebuilds it (component 1, sdpMid "0"). */
export function candidateToLine(m: MinimalCandidate): string {
  const proto = m.transportType.tag === "UDP" ? "udp" : "tcp";
  const addr = m.address.tag === "Ipv4" ? Array.from(m.address.value).join(".") : leBytesToIpv6(m.address.value);
  return `candidate:${m.foundation} 1 ${proto} ${m.priority} ${addr} ${m.port} typ ${m.candidateType.tag.toLowerCase()}`;
}

// ---- SDP <-> MinimalSetup ------------------------------------------------

/**
 * Encodes a local offer or answer. Unlike Desktop's encoder (which takes the
 * last `a=fingerprint` line), this picks the sha-256 line explicitly: aiortc
 * emits sha-256, sha-384 and sha-512, and the receiver always labels the bytes
 * sha-256. Inline `a=candidate` lines are included as the first batch.
 */
export function encodeMinimalSetup(localSdp: string): Uint8Array {
  let ufrag = "";
  let pwd = "";
  let fpHex = "";
  let setup = "actpass";
  let sessionId = 0n;
  let sessionVersion = 0n;
  const candidates: MinimalCandidate[] = [];
  for (const raw of localSdp.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("a=ice-ufrag:")) ufrag ||= line.slice(12);
    else if (line.startsWith("a=ice-pwd:")) pwd ||= line.slice(10);
    else if (line.toLowerCase().startsWith("a=fingerprint:sha-256 ")) fpHex ||= line.slice(22);
    else if (line.startsWith("a=setup:")) setup = line.slice(8);
    else if (line.startsWith("a=candidate:")) {
      const c = candidateFromLine(line);
      if (c) candidates.push(c);
    } else if (line.startsWith("o=")) {
      const parts = line.slice(2).split(" ").filter(Boolean);
      sessionId = BigInt(parts[1] ?? 0);
      sessionVersion = BigInt(parts[2] ?? 0);
    }
  }
  const clean = fpHex.replace(/[:\s]/g, "");
  if (!ufrag || !pwd || clean.length !== 64) throw new Error("SDP is missing ICE credentials or a sha-256 fingerprint");
  const fingerprint = new Uint8Array(32);
  for (let i = 0; i < 32; i++) fingerprint[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return MinimalSetupCodec.enc({
    sdpType: { tag: setup === "actpass" ? "OFFER" : "ANSWER", value: undefined },
    sessionId,
    sessionVersion,
    iceUFrag: ufrag,
    icePwd: pwd,
    fingerprint,
    candidates,
  });
}

export interface DecodedSetup {
  type: "offer" | "answer";
  /** Desktop's exact template (no candidates), for setRemoteDescription. */
  sdp: string;
  /** The same SDP with the first candidates inlined, which suits aiortc. */
  sdpWithCandidates: string;
  candidates: string[];
}

export function decodeMinimalSetup(bytes: Uint8Array): DecodedSetup {
  const s = MinimalSetupCodec.dec(bytes);
  const fp = Array.from(s.fingerprint, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  const sdp =
    `v=0\r\n` +
    `o=- ${s.sessionId.toString()} ${s.sessionVersion.toString()} IN IP4 0.0.0.0\r\n` +
    `s=-\r\n` +
    `t=0 0\r\n` +
    `m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n` +
    `c=IN IP4 0.0.0.0\r\n` +
    `a=ice-ufrag:${s.iceUFrag}\r\n` +
    `a=ice-pwd:${s.icePwd}\r\n` +
    `a=fingerprint:sha-256 ${fp}\r\n` +
    `a=setup:${s.sdpType.tag === "OFFER" ? "actpass" : "active"}\r\n` +
    `a=mid:0\r\n` +
    `a=sctp-port:5000\r\n`;
  const candidates = s.candidates.map(candidateToLine);
  const sdpWithCandidates = sdp + candidates.map((c) => `a=${c}\r\n`).join("");
  return { type: s.sdpType.tag === "OFFER" ? "offer" : "answer", sdp, sdpWithCandidates, candidates };
}

export function encodeCandidates(lines: string[]): Uint8Array {
  return MinimalCandidatesCodec.enc(lines.map(candidateFromLine).filter((c): c is MinimalCandidate => c !== null));
}

export function decodeCandidates(bytes: Uint8Array): string[] {
  return MinimalCandidatesCodec.dec(bytes).map(candidateToLine);
}
