// Small byte helpers shared by the codecs. Works in Node and in browsers.

export { bytesToHex, hexToBytes, concatBytes, utf8ToBytes, randomBytes } from "@noble/hashes/utils.js";

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export class ProtocolError extends Error {}

/** Appends fixed-size fields to a growing buffer. */
export class Writer {
  private parts: number[] = [];

  u8(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xff) throw new ProtocolError(`u8 out of range: ${n}`);
    this.parts.push(n);
    return this;
  }

  u16(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new ProtocolError(`u16 out of range: ${n}`);
    this.parts.push(n >> 8, n & 0xff);
    return this;
  }

  u32(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new ProtocolError(`u32 out of range: ${n}`);
    this.parts.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
    return this;
  }

  bytes(b: Uint8Array): this {
    for (const x of b) this.parts.push(x);
    return this;
  }

  /** A short ASCII string, length-prefixed with one byte. */
  str(s: string): this {
    const b = new TextEncoder().encode(s);
    if (b.length > 0xff) throw new ProtocolError("string too long");
    return this.u8(b.length).bytes(b);
  }

  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

/** Reads fields back in order; throws ProtocolError on truncated input. */
export class Reader {
  private pos = 0;
  private readonly buf: Uint8Array;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new ProtocolError("truncated message");
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++]!;
  }

  u16(): number {
    this.need(2);
    const v = (this.buf[this.pos]! << 8) | this.buf[this.pos + 1]!;
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const b = this.buf;
    const p = this.pos;
    this.pos += 4;
    return ((b[p]! << 24) >>> 0) + (b[p + 1]! << 16) + (b[p + 2]! << 8) + b[p + 3]!;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  str(): string {
    return new TextDecoder().decode(this.bytes(this.u8()));
  }

  rest(): Uint8Array {
    return this.bytes(this.buf.length - this.pos);
  }

  end(): void {
    if (this.pos !== this.buf.length) throw new ProtocolError("trailing bytes");
  }
}
