// Call messages (the plaintext body inside an envelope).
//
//   body = type(1) | callId(8) | seq(1) | timestamp(4, unix seconds) | fields
//
// Offer    caller -> household or person inbox   rings every device there
// Ringing  callee device -> caller               "a phone is ringing" (ringback)
// Answer   callee device -> caller               carries the answer SDP
// Taken    answering device -> its household     the other phones stop ringing
// Hangup   either side                           ends or declines the call
//
// The Statement Store has no acks or ordering, so senders repeat messages and
// receivers drop repeats by (callId, type, seq).

import { ProtocolError, Reader, Writer, bytesToHex } from "./bytes.ts";
import { decodeCompactSdp, encodeCompactSdp, type CompactSdp } from "./sdp.ts";

export const MsgType = { Offer: 1, Ringing: 2, Answer: 3, Taken: 4, Hangup: 5 } as const;
export type MsgType = (typeof MsgType)[keyof typeof MsgType];

export const HangupReason = {
  Normal: 0,
  Busy: 1,
  Declined: 2,
  Timeout: 3,
  Cancelled: 4,
  AnsweredElsewhere: 5,
} as const;
export type HangupReason = (typeof HangupReason)[keyof typeof HangupReason];

interface Header {
  callId: Uint8Array; // 8 random bytes
  seq: number; // 0-255, wraps
  ts: number; // unix seconds when sent
}

export type Message =
  | (Header & { type: typeof MsgType.Offer; sdp: CompactSdp })
  | (Header & { type: typeof MsgType.Ringing })
  | (Header & { type: typeof MsgType.Answer; sdp: CompactSdp })
  | (Header & { type: typeof MsgType.Taken })
  | (Header & { type: typeof MsgType.Hangup; reason: HangupReason });

export function encodeMessage(m: Message): Uint8Array {
  if (m.callId.length !== 8) throw new ProtocolError("callId must be 8 bytes");
  const w = new Writer().u8(m.type).bytes(m.callId).u8(m.seq & 0xff).u32(m.ts);
  if (m.type === MsgType.Offer || m.type === MsgType.Answer) w.bytes(encodeCompactSdp(m.sdp));
  else if (m.type === MsgType.Hangup) w.u8(m.reason);
  return w.done();
}

export function decodeMessage(body: Uint8Array): Message {
  const r = new Reader(body);
  const type = r.u8();
  const header: Header = { callId: r.bytes(8), seq: r.u8(), ts: r.u32() };
  switch (type) {
    case MsgType.Offer:
    case MsgType.Answer:
      return { ...header, type, sdp: decodeCompactSdp(r.rest()) };
    case MsgType.Ringing:
    case MsgType.Taken:
      r.end();
      return { ...header, type };
    case MsgType.Hangup: {
      const reason = r.u8();
      r.end();
      if (!Object.values(HangupReason).includes(reason as HangupReason)) throw new ProtocolError("bad reason");
      return { ...header, type, reason: reason as HangupReason };
    }
    default:
      throw new ProtocolError(`unknown message type ${type}`);
  }
}

export function callIdHex(callId: Uint8Array): string {
  return bytesToHex(callId);
}
