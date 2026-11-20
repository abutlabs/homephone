// homephone-dot: the Pi's Polkadot side, as a linked device of the house account.
//
//   node packages/linked-device/bin/daemon.ts --session .secrets/house-device.json --contacts .secrets/house-contacts.json
//
// Talks JSON lines with the phone program: events on stdout, commands on stdin,
// logs on stderr.
//
//   events   {"event":"ready"}
//            {"event":"offer","callId","from","purpose","sdp"}      full SDP, candidates inline
//            {"event":"ice","callId","candidates":["candidate:..."]}
//            {"event":"closed","callId"}
//            {"event":"sent","callId","what","result"}
//   commands {"cmd":"answer","callId","sdp"}                        our full answer SDP
//            {"cmd":"hangup","callId"}

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { decodeMessages, identityChannel, mainIncoming, StatementData, type DeviceKeys } from "../src/chat.ts";
import { decodeCandidates, decodeMinimalSetup, encodeMinimalSetup } from "../src/minimal-setup.ts";
import { PeopleRpc, fromHex, toHex } from "../src/people-rpc.ts";
import { bumpPriority, chatMessage, mainOutgoing } from "../src/send.ts";
import { keysFromPhrase } from "../src/account.ts";
import { x25519 } from "@noble/curves/ed25519.js";
import { decodeStatement } from "../src/statement.ts";

const { values } = parseArgs({
  options: {
    session: { type: "string", default: ".secrets/house-device.json" },
    contacts: { type: "string", default: ".secrets/house-contacts.json" },
    "max-offer-age": { type: "string", default: "45" },
    account: { type: "string" }, // the house account's recovery phrase file: sign as the identity
  },
});

const log = (...a: unknown[]) => console.error(new Date().toISOString().slice(11, 19), ...a);
const emit = (o: object) => process.stdout.write(JSON.stringify(o) + "\n");

const s = JSON.parse(readFileSync(values.session!, "utf8"));
const own = {
  id: fromHex(s.owner.identityAccountId),
  chatPriv: fromHex(s.owner.identityChatPrivateKey),
  deviceStmt: fromHex(s.device.stmtPublic),
  deviceStmtSecret: fromHex(s.device.stmtSecret),
  deviceEncPriv: fromHex(s.device.encSecret),
};
let signer: { secret: Uint8Array; public: Uint8Array } | undefined;
if (values.account) {
  const acct = JSON.parse(readFileSync(values.account, "utf8"));
  const keys = keysFromPhrase(acct.phrase, acct.tld ?? "dot");
  const sameIdentity = Buffer.from(keys.identityPublic).equals(Buffer.from(own.id));
  const sameChat = Buffer.from(keys.chatPub).equals(Buffer.from(x25519.getPublicKey(own.chatPriv)));
  if (!sameIdentity || !sameChat) {
    log(`the phrase in ${values.account} is not this session's account (identity ${sameIdentity ? "ok" : "MISMATCH"}, chat key ${sameChat ? "ok" : "MISMATCH"})`);
    process.exit(2);
  }
  signer = { secret: keys.identitySecret, public: keys.identityPublic };
  log(`signing as the house identity ${toHex(keys.identityPublic).slice(0, 12)} (permanent allowance)`);
}
const contacts: { username: string; id: string; chatPub: string }[] = JSON.parse(readFileSync(values.contacts!, "utf8"));
const rpc = await PeopleRpc.connect();
const maxAgeMs = Number(values["max-offer-age"]) * 1000;

interface Contact {
  username: string;
  id: Uint8Array;
  chatPub: Uint8Array;
  devices: Map<string, DeviceKeys>;
  out: ReturnType<typeof mainOutgoing>;
}
const calls = new Map<string, Contact>(); // offer id -> who called
const seen = new Set<string>(); // message ids already handled

async function send(contact: Contact, callId: string, what: string, content: Parameters<typeof chatMessage>[0]) {
  const recipients = [...contact.devices.values()];
  for (let attempt = 0; attempt < 3; attempt++) {
    const hex = toHex(contact.out.statement([chatMessage(content)], recipients));
    let result: any;
    try {
      result = await rpc.request("statement_submit", [hex]);
    } catch (e) {
      result = { error: (e as Error).message };
    }
    const reason = result?.reason ?? result?.status;
    const min = result?.min_expiry ?? result?.minExpiry ?? result?.reason?.channelPriorityTooLow?.min_expiry;
    if (min !== undefined && attempt < 2) {
      bumpPriority(BigInt(min));
      continue;
    }
    log(`sent ${what} for ${callId} to ${contact.username} (${recipients.length} device(s)): ${reason ?? JSON.stringify(result)}`);
    emit({ event: "sent", callId, what, result });
    return;
  }
}

function onMessages(contact: Contact, msgs: ReturnType<typeof decodeMessages>) {
  for (const m of msgs) {
    if (seen.has(m.messageId)) continue;
    seen.add(m.messageId);
    const v = m.versioned.value;
    if (v.tag === "dataChannelOffer") {
      const age = Date.now() - Number(m.timestamp);
      if (age > maxAgeMs) {
        log(`ignoring old call offer ${m.messageId} (${Math.round(age / 1000)}s old)`);
        continue;
      }
      calls.set(m.messageId, contact);
      const setup = decodeMinimalSetup(v.value.sdp);
      log(`call from ${contact.username}: ${m.messageId} (${v.value.purpose === 0 ? "audio" : "video"})`);
      emit({ event: "offer", callId: m.messageId, from: contact.username, purpose: v.value.purpose, sdp: setup.sdpWithCandidates });
    } else if (v.tag === "dataChannelIceCandidate" && calls.has(v.value.offerMessageId)) {
      emit({ event: "ice", callId: v.value.offerMessageId, candidates: decodeCandidates(v.value.sdp) });
    } else if (v.tag === "dataChannelClosed" && calls.has(v.value.offerMessageId)) {
      log(`call ${v.value.offerMessageId} closed by ${contact.username}`);
      emit({ event: "closed", callId: v.value.offerMessageId });
      calls.delete(v.value.offerMessageId);
    } else if (v.tag === "deviceAdded" && v.value.statementAccountId.length === 32) {
      void watchDevice(contact, { stmt: v.value.statementAccountId, encPub: v.value.encryptionPublicKey });
    } else if (v.tag === "deviceRemoved") {
      contact.devices.delete(toHex(v.value.statementAccountId));
    }
  }
}

async function watchDevice(contact: Contact, dev: DeviceKeys) {
  const key = toHex(dev.stmt);
  if (contact.devices.has(key)) return;
  contact.devices.set(key, dev);
  const main = mainIncoming(own, dev);
  log(`${contact.username}: watching device ${key.slice(0, 12)}`);
  await rpc.subscribe({ matchAny: [toHex(main.topic)] }, (hex) => {
    const st = decodeStatement(fromHex(hex));
    if (!st.data) return;
    try {
      const opened = main.open(st.data);
      if (opened?.tag === "request") onMessages(contact, decodeMessages(opened.value));
    } catch {
      /* not decryptable for us */
    }
  });
}

for (const c of contacts) {
  const contact: Contact = {
    username: c.username,
    id: fromHex(c.id),
    chatPub: fromHex(c.chatPub),
    devices: new Map(),
    out: mainOutgoing({ ...own, signer }, { id: fromHex(c.id), chatPub: fromHex(c.chatPub) }),
  };
  const idc = identityChannel(own, contact);
  await rpc.subscribe({ matchAny: [toHex(idc.topicIn)] }, (hex) => {
    const st = decodeStatement(fromHex(hex));
    if (!st.data) return;
    try {
      const sd = StatementData.dec(idc.enc.decrypt(st.data));
      if (sd.tag !== "request") return;
      for (const m of decodeMessages(sd.value)) {
        const v = m.versioned.value;
        if (v.tag === "deviceChatAccepted")
          void watchDevice(contact, { stmt: v.value.device.statementAccountId, encPub: v.value.device.encryptionPublicKey });
        if (v.tag === "deviceAdded" && v.value.statementAccountId.length === 32)
          void watchDevice(contact, { stmt: v.value.statementAccountId, encPub: v.value.encryptionPublicKey });
      }
    } catch {
      /* not for us */
    }
  });
  log(`${c.username}: identity channel open`);
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let cmd: any;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }
  const contact = calls.get(cmd.callId);
  if (!contact) {
    log(`no such call ${cmd.callId}`);
    return;
  }
  if (cmd.cmd === "answer") {
    const setup = encodeMinimalSetup(cmd.sdp);
    void send(contact, cmd.callId, "answer", { tag: "dataChannelAnswer", value: { offerMessageId: cmd.callId, sdp: setup } });
  } else if (cmd.cmd === "hangup") {
    void send(contact, cmd.callId, "hangup", { tag: "dataChannelClosed", value: { offerMessageId: cmd.callId } });
    calls.delete(cmd.callId);
  }
});

emit({ event: "ready" });
log("ready");
