// A minimal JSON-RPC client for the People chain's Statement Store.
// Uses Node's global WebSocket (Node 22+), so it needs no dependencies.

export const DEVNET_PEOPLE_ENDPOINTS = [
  "wss://people-paseo.rotko.net",
  "wss://people-paseo.gatotech.network",
  "wss://rpc.interweb-it.com/people-paseo",
];

export type TopicFilter = "any" | { matchAll: string[] } | { matchAny: string[] };

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class PeopleRpc {
  private ws!: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private subs = new Map<string, (params: unknown) => void>();

  static async connect(endpoints = DEVNET_PEOPLE_ENDPOINTS): Promise<PeopleRpc> {
    let lastError: unknown;
    for (const url of endpoints) {
      try {
        const rpc = new PeopleRpc();
        await rpc.open(url);
        return rpc;
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error(`no People chain endpoint reachable: ${String(lastError)}`);
  }

  private open(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`timeout connecting to ${url}`));
      }, 10_000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`cannot connect to ${url}`));
      };
      ws.onmessage = (ev) => this.onMessage(String(ev.data));
      ws.onclose = () => {
        for (const p of this.pending.values()) p.reject(new Error("connection closed"));
        this.pending.clear();
      };
    });
  }

  private onMessage(text: string): void {
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.params?.subscription !== undefined) {
      this.subs.get(String(msg.params.subscription))?.(msg.params.result);
    }
  }

  request<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  /**
   * Subscribes to statements matching `filter` (hex topics with 0x). The node
   * first replays every stored match, then streams new ones. `onStatement`
   * gets each statement as hex.
   */
  async subscribe(filter: TopicFilter, onStatement: (hex: string) => void): Promise<() => Promise<void>> {
    const id = await this.request<string>("statement_subscribeStatement", [filter]);
    this.subs.set(String(id), (result: any) => {
      // Shapes seen: {event:"newStatements", data:{statements:[hex...]}} or a bare hex string.
      const list: unknown[] =
        typeof result === "string" ? [result] : (result?.data?.statements ?? result?.statements ?? []);
      for (const s of list) if (typeof s === "string") onStatement(s);
    });
    return async () => {
      this.subs.delete(String(id));
      await this.request("statement_unsubscribeStatement", [id]).catch(() => undefined);
    };
  }

  close(): void {
    this.ws?.close();
  }
}

export const toHex = (b: Uint8Array): string => "0x" + Buffer.from(b).toString("hex");
export const fromHex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
