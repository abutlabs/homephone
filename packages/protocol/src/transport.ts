// How call messages travel.
//
// Production uses the People chain Statement Store (milestone 2). The wire form
// of one message there is the JSON text `{"h":"<base64 envelope>"}`, because the
// Product SDK JSON-encodes statement data and drops anything that isn't JSON.
// The 512-byte limit applies to that JSON text.
//
// `inboxTopic` names the topic2 an endpoint listens on. It's derived from the
// inbox's public key, so only people who know the key can address it, and the
// topic says nothing about who owns it.

import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, concatBytes, fromBase64, toBase64, utf8ToBytes } from "./bytes.ts";

export const STATEMENT_MAX_BYTES = 512;

export interface PublishOptions {
  ttlSeconds?: number;
}

export interface Transport {
  /** Publishes `data` to `topic`. Resolves false if the network refused it. */
  publish(topic: string, data: Uint8Array, opts?: PublishOptions): Promise<boolean>;
  /** Delivers every live message on `topic`, including ones already published. */
  subscribe(topic: string, onData: (data: Uint8Array) => void): () => void;
}

export function inboxTopic(boxPub: Uint8Array): string {
  return "hp1-" + bytesToHex(blake2b(concatBytes(utf8ToBytes("homephone/v1/inbox"), boxPub), { dkLen: 16 }));
}

/** The statement data for an envelope, exactly as it will be measured. */
export function toStatementJson(envelope: Uint8Array): string {
  return JSON.stringify({ h: toBase64(envelope) });
}

export function fromStatementJson(value: unknown): Uint8Array | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || typeof (value as { h?: unknown }).h !== "string") return null;
  try {
    return fromBase64((value as { h: string }).h);
  } catch {
    return null;
  }
}

export function statementSize(envelope: Uint8Array): number {
  return new TextEncoder().encode(toStatementJson(envelope)).length;
}

/**
 * An in-memory Statement Store for tests and local development. Like the real
 * one it replays live messages to new subscribers, echoes messages back to
 * their publisher, and forgets them after their TTL. It can also drop or delay
 * messages to imitate gossip between nodes.
 */
export class MemoryNetwork {
  private live = new Map<string, { data: Uint8Array; expires: number }[]>();
  private subs = new Map<string, Set<(d: Uint8Array) => void>>();
  lossRate = 0;
  delayMs = 0;
  published = 0;

  private readonly now: () => number;
  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  transport(): Transport {
    return {
      publish: async (topic, data, opts) => {
        if (statementSize(data) > STATEMENT_MAX_BYTES) return false;
        this.published++;
        const expires = this.now() + (opts?.ttlSeconds ?? 30) * 1000;
        const list = (this.live.get(topic) ?? []).filter((s) => s.expires > this.now());
        list.push({ data, expires });
        this.live.set(topic, list);
        for (const cb of this.subs.get(topic) ?? []) {
          if (Math.random() < this.lossRate) continue;
          if (this.delayMs > 0) setTimeout(() => cb(data), this.delayMs);
          else queueMicrotask(() => cb(data));
        }
        return true;
      },
      subscribe: (topic, onData) => {
        const set = this.subs.get(topic) ?? new Set();
        set.add(onData);
        this.subs.set(topic, set);
        for (const s of this.live.get(topic) ?? []) {
          if (s.expires > this.now()) queueMicrotask(() => onData(s.data));
        }
        return () => set.delete(onData);
      },
    };
  }
}
