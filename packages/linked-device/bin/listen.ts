// Listen to the owner's chats with some contacts, as a linked device.
//
//   python -m homephone.people kloskehome.01 > .secrets/contacts.json
//   node packages/linked-device/bin/listen.ts [--session .secrets/linked-device.json] [--contacts .secrets/contacts.json]
//
// For each contact: subscribes to the identity channel (keys from the chain),
// learns the contact's device keys from roster messages there, then subscribes
// to each device's main-session topic and prints what arrives, including call
// offers. Receive-only: it never acknowledges anything (docs/linked-device-spec.md §2.6).

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  decodeMessages, describe, identityChannel, mainIncoming, StatementData, type DeviceKeys,
} from "../src/chat.ts";
import { PeopleRpc, fromHex, toHex } from "../src/people-rpc.ts";
import { decodeStatement } from "../src/statement.ts";

const { values } = parseArgs({
  options: {
    session: { type: "string", default: ".secrets/linked-device.json" },
    contacts: { type: "string", default: ".secrets/contacts.json" },
  },
});

const s = JSON.parse(readFileSync(values.session!, "utf8"));
const own = {
  id: fromHex(s.owner.identityAccountId),
  chatPriv: fromHex(s.owner.identityChatPrivateKey),
  deviceStmt: fromHex(s.device.stmtPublic),
  deviceEncPriv: fromHex(s.device.encSecret),
};
const contacts: { username: string; id: string; chatPub: string }[] = JSON.parse(readFileSync(values.contacts!, "utf8"));
const rpc = await PeopleRpc.connect();
const short = (b: Uint8Array) => toHex(b).slice(0, 12);
const t = () => new Date().toISOString().slice(11, 19);

for (const c of contacts) {
  const peer = { id: fromHex(c.id), chatPub: fromHex(c.chatPub) };
  const idc = identityChannel(own, peer);
  const known = new Map<string, DeviceKeys>();

  const watchDevice = async (dev: DeviceKeys) => {
    const key = toHex(dev.stmt);
    if (known.has(key)) return;
    known.set(key, dev);
    const main = mainIncoming(own, dev);
    console.log(`${t()} [${c.username}] watching device ${short(dev.stmt)} on main topic ${short(main.topic)}`);
    await rpc.subscribe({ matchAny: [toHex(main.topic)] }, (hex) => {
      const st = decodeStatement(fromHex(hex));
      if (!st.data) return;
      let opened;
      try {
        opened = main.open(st.data);
      } catch (e) {
        console.log(`${t()} [${c.username}] main: could not decrypt (${(e as Error).message})`);
        return;
      }
      if (!opened) {
        console.log(`${t()} [${c.username}] main: a statement not addressed to this device`);
        return;
      }
      if (opened.tag !== "request") {
        console.log(`${t()} [${c.username}] main: ${opened.tag}`);
        return;
      }
      for (const m of decodeMessages(opened.value)) {
        console.log(`${t()} [${c.username}] main: ${describe(m)}`);
        const v = m.versioned.value;
        if (v.tag === "deviceAdded" && v.value.statementAccountId.length === 32)
          void watchDevice({ stmt: v.value.statementAccountId, encPub: v.value.encryptionPublicKey });
      }
    });
  };

  console.log(`${t()} [${c.username}] identity channel in ${short(idc.topicIn)} / out ${short(idc.topicOut)}`);
  await rpc.subscribe({ matchAny: [toHex(idc.topicIn), toHex(idc.topicOut)] }, (hex) => {
    const st = decodeStatement(fromHex(hex));
    const dir = st.topics.some((x) => Buffer.from(x).equals(Buffer.from(idc.topicIn))) ? "from them" : "from us";
    if (!st.data) return;
    let sd;
    try {
      sd = StatementData.dec(idc.enc.decrypt(st.data));
    } catch (e) {
      console.log(`${t()} [${c.username}] identity (${dir}): could not decrypt (${(e as Error).message})`);
      return;
    }
    if (sd.tag !== "request") {
      console.log(`${t()} [${c.username}] identity (${dir}): ${sd.tag}`);
      return;
    }
    for (const m of decodeMessages(sd.value)) {
      console.log(`${t()} [${c.username}] identity (${dir}): ${describe(m)}`);
      const v = m.versioned.value;
      if (dir === "from them" && v.tag === "deviceChatAccepted") void watchDevice({ stmt: v.value.device.statementAccountId, encPub: v.value.device.encryptionPublicKey });
      if (dir === "from them" && v.tag === "deviceAdded" && v.value.statementAccountId.length === 32)
        void watchDevice({ stmt: v.value.statementAccountId, encPub: v.value.encryptionPublicKey });
    }
  });
}
console.log(`${t()} listening (Ctrl-C to stop)…`);
