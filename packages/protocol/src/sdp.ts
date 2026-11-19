// Compact SDP for audio-only calls.
//
// A full WebRTC SDP is 1-3 KB; a Statement Store message is 512 bytes. Both
// ends here build the same kind of call (one Opus audio stream, bundled, with
// rtcp-mux), so only a few fields actually differ between calls:
//
//   payload type, mid, ICE ufrag and password, the DTLS sha-256 fingerprint,
//   the DTLS role, and the gathered ICE candidates.
//
// We send just those (about 60-120 bytes) and rebuild a standard SDP on the
// other side. See https://webrtchacks.com/the-minimum-viable-sdp/. Candidates are
// gathered in full before sending (no trickle ICE), which is what aiortc does.

import { ProtocolError, Reader, Writer, bytesToHex, hexToBytes } from "./bytes.ts";

export type CandidateType = "host" | "srflx" | "relay";
export type DtlsSetup = "actpass" | "active" | "passive";

export interface Candidate {
  type: CandidateType;
  /** IPv4, IPv6, or a browser mDNS name (`<uuid>.local`). */
  address: string;
  port: number;
}

export interface CompactSdp {
  payloadType: number;
  mid: string;
  ufrag: string;
  pwd: string;
  fingerprint: Uint8Array; // sha-256, 32 bytes
  setup: DtlsSetup;
  candidates: Candidate[];
}

export const MAX_CANDIDATES = 6;

const TYPES: CandidateType[] = ["host", "srflx", "relay"];
const SETUPS: DtlsSetup[] = ["actpass", "active", "passive"];
const FAMILY_V4 = 0;
const FAMILY_V6 = 1;
const FAMILY_MDNS = 2;
const MDNS_RE = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

// ---- parsing a full SDP -------------------------------------------------

function attr(lines: string[], name: string): string | undefined {
  const prefix = `a=${name}:`;
  return lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim();
}

function family(address: string): number | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return FAMILY_V4;
  if (MDNS_RE.test(address)) return FAMILY_MDNS;
  if (address.includes(":") && !address.includes("%")) return FAMILY_V6;
  return null;
}

/** Extracts the fields we need from a local offer or answer. */
export function compactFromSdp(sdp: string): CompactSdp {
  const lines = sdp.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const mStarts = lines.flatMap((l, i) => (l.startsWith("m=") ? [i] : []));
  if (mStarts.length !== 1 || !lines[mStarts[0]!]!.startsWith("m=audio")) {
    throw new ProtocolError("expected exactly one audio m-section");
  }
  const session = lines.slice(0, mStarts[0]);
  const media = lines.slice(mStarts[0]);

  const opus = media.find((l) => /^a=rtpmap:\d+ opus\/48000\/2$/i.test(l));
  if (!opus) throw new ProtocolError("no Opus codec in SDP");
  const payloadType = Number(opus.slice("a=rtpmap:".length).split(" ")[0]);

  const pick = (name: string) => attr(media, name) ?? attr(session, name);
  const ufrag = pick("ice-ufrag");
  const pwd = pick("ice-pwd");
  const fp = media
    .concat(session)
    .find((l) => l.toLowerCase().startsWith("a=fingerprint:sha-256 "));
  const setup = pick("setup") as DtlsSetup | undefined;
  const mid = attr(media, "mid") ?? "0";
  if (!ufrag || !pwd || !fp || !setup || !SETUPS.includes(setup)) {
    throw new ProtocolError("SDP is missing ICE or DTLS fields");
  }
  const fingerprint = hexToBytes(fp.split(" ")[1]!.replaceAll(":", ""));
  if (fingerprint.length !== 32) throw new ProtocolError("bad sha-256 fingerprint");

  const candidates: Candidate[] = [];
  for (const line of media) {
    if (!line.startsWith("a=candidate:")) continue;
    const f = line.slice("a=candidate:".length).split(/\s+/);
    // foundation component transport priority address port "typ" type ...
    if (f.length < 8 || f[1] !== "1" || f[2]!.toLowerCase() !== "udp" || f[6] !== "typ") continue;
    const type = f[7] as CandidateType;
    if (!TYPES.includes(type) || family(f[4]!) === null) continue;
    const port = Number(f[5]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    candidates.push({ type, address: f[4]!, port });
  }
  return { payloadType, mid, ufrag, pwd, fingerprint, setup, candidates: chooseCandidates(candidates) };
}

/** Keeps the most useful candidates within MAX_CANDIDATES: IPv4 first, then mDNS, then IPv6. */
function chooseCandidates(all: Candidate[]): Candidate[] {
  const rank = (c: Candidate) => {
    const fam = family(c.address);
    return fam === FAMILY_V4 ? 0 : fam === FAMILY_MDNS ? 1 : 2;
  };
  const seen = new Set<string>();
  return all
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c)
    .filter((c) => {
      const k = `${c.type} ${c.address} ${c.port}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_CANDIDATES);
}

// ---- binary encoding ----------------------------------------------------

function ipv6ToBytes(address: string): Uint8Array {
  const [head, tail] = address.split("::") as [string, string | undefined];
  const parse = (s: string) => (s ? s.split(":") : []);
  let groups = parse(head);
  if (tail !== undefined) {
    const t = parse(tail);
    groups = [...groups, ...Array(8 - groups.length - t.length).fill("0"), ...t];
  }
  if (groups.length !== 8) throw new ProtocolError(`bad IPv6 address: ${address}`);
  const out = new Uint8Array(16);
  groups.forEach((g, i) => {
    const v = parseInt(g, 16);
    if (!/^[0-9a-f]{1,4}$/i.test(g) || Number.isNaN(v)) throw new ProtocolError(`bad IPv6 address: ${address}`);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 0xff;
  });
  return out;
}

function ipv6FromBytes(b: Uint8Array): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((b[i]! << 8) | b[i + 1]!).toString(16));
  // RFC 5952: shorten the longest run of two or more zero groups to "::".
  let best = -1;
  let bestLen = 1;
  for (let i = 0; i < 8; ) {
    let j = i;
    while (j < 8 && groups[j] === "0") j++;
    if (j - i > bestLen) [best, bestLen] = [i, j - i];
    i = j > i ? j : i + 1;
  }
  if (best < 0) return groups.join(":");
  return `${groups.slice(0, best).join(":")}::${groups.slice(best + bestLen).join(":")}`;
}

export function encodeCompactSdp(s: CompactSdp): Uint8Array {
  if (s.candidates.length > MAX_CANDIDATES) throw new ProtocolError("too many candidates");
  const w = new Writer()
    .u8(s.payloadType)
    .str(s.mid)
    .str(s.ufrag)
    .str(s.pwd)
    .bytes(s.fingerprint)
    .u8(SETUPS.indexOf(s.setup))
    .u8(s.candidates.length);
  for (const c of s.candidates) {
    const fam = family(c.address);
    if (fam === null) throw new ProtocolError(`bad candidate address: ${c.address}`);
    w.u8((TYPES.indexOf(c.type) << 4) | fam);
    if (fam === FAMILY_V4) w.bytes(Uint8Array.from(c.address.split(".").map(Number)));
    else if (fam === FAMILY_V6) w.bytes(ipv6ToBytes(c.address));
    else w.bytes(hexToBytes(c.address.slice(0, 36).replaceAll("-", "")));
    w.u16(c.port);
  }
  return w.done();
}

export function decodeCompactSdp(data: Uint8Array): CompactSdp {
  const r = new Reader(data);
  const payloadType = r.u8();
  const mid = r.str();
  const ufrag = r.str();
  const pwd = r.str();
  const fingerprint = r.bytes(32);
  const setup = SETUPS[r.u8()];
  if (!setup) throw new ProtocolError("bad DTLS setup");
  const n = r.u8();
  if (n > MAX_CANDIDATES) throw new ProtocolError("too many candidates");
  const candidates: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    const kind = r.u8();
    const type = TYPES[kind >> 4];
    const fam = kind & 0x0f;
    if (!type) throw new ProtocolError("bad candidate type");
    let address: string;
    if (fam === FAMILY_V4) address = Array.from(r.bytes(4)).join(".");
    else if (fam === FAMILY_V6) address = ipv6FromBytes(r.bytes(16));
    else if (fam === FAMILY_MDNS) {
      const h = bytesToHex(r.bytes(16));
      address = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
    } else throw new ProtocolError("bad candidate family");
    candidates.push({ type, address, port: r.u16() });
  }
  r.end();
  if (!/^[\x21-\x7e]+$/.test(ufrag + pwd + mid)) throw new ProtocolError("bad ICE credentials");
  return { payloadType, mid, ufrag, pwd, fingerprint, setup, candidates };
}

// ---- rebuilding a full SDP ----------------------------------------------

const TYPE_PREF: Record<CandidateType, number> = { host: 126, srflx: 100, relay: 0 };

/** Builds a standard SDP that browsers and aiortc accept as a remote description. */
export function sdpFromCompact(s: CompactSdp, sessionId = "4611731400430051336"): string {
  const pt = s.payloadType;
  const fp = Array.from(s.fingerprint, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  const candidates = s.candidates.map((c, i) => {
    const priority = TYPE_PREF[c.type] * 2 ** 24 + (65535 - i) * 2 ** 8 + 255;
    const related = c.type === "host" ? "" : " raddr 0.0.0.0 rport 0";
    return `a=candidate:${i + 1} 1 udp ${priority} ${c.address} ${c.port} typ ${c.type}${related}`;
  });
  return [
    "v=0",
    `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    `a=group:BUNDLE ${s.mid}`,
    "a=msid-semantic:WMS *",
    `m=audio 9 UDP/TLS/RTP/SAVPF ${pt}`,
    "c=IN IP4 0.0.0.0",
    "a=rtcp:9 IN IP4 0.0.0.0",
    ...candidates,
    "a=end-of-candidates",
    `a=ice-ufrag:${s.ufrag}`,
    `a=ice-pwd:${s.pwd}`,
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${s.setup}`,
    `a=mid:${s.mid}`,
    "a=sendrecv",
    "a=rtcp-mux",
    `a=rtpmap:${pt} opus/48000/2`,
    `a=fmtp:${pt} minptime=10;useinbandfec=1`,
    "",
  ].join("\r\n");
}
