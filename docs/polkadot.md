# Homephone on Polkadot

Homephone is designed as a Polkadot Product from the start, not as a phone system with Polkadot added later. This document maps each part of Homephone onto the Polkadot platform: accounts, Products, the Statement Store, Bulletin, DotNS, personhood and chat. It records what is documented, what is provisional and what we still need to find out.

Researched 18 Nov 2026 from the [Polkadot developer docs](https://developers.polkadot.com/apps/) and the public client source. All the docs were re-read on 20 Nov 2026; the facts that matter, each with its source link, are in [polkadot-dev-notes.md](polkadot-dev-notes.md). Every page there is also available as Markdown: add `.md` to the URL, or use [llms-full.txt](https://developers.polkadot.com/llms-full.txt) for all of it. **Provisional** marks something the docs themselves call unfinished.

## Mission

**Make a Raspberry Pi in an old landline phone a first-class Polkadot App device: a Polkadot housephone.** Family members call it from the Polkadot App they already use, and it rings the house. Polkadot provides the identity, contacts, signalling and encryption; Homephone provides the phone.

## Three ways a Pi can be on Polkadot

From the docs and the Android source (`trinity-user-agents/hosts/android`):

* The App's Statement Store allowance comes from **proving membership of a people set**. The `AsResources` extension registers `RegisterStatementStoreAllowance` with a ring-VRF proof (`feature/statement-store/.../AsResourcesProofExtension.kt`). An account that isn't a person can't publish chat or call signals.
* Starting a chat with an account fails with `PeerNotRegistered` unless it has **on-chain consumer info**, meaning a registered DotNS username (`feature/chats/.../StartChatDataUseCase.kt`).
* The Lite tier is an **attested proof of a unique device**, issued through `identity-backend`. The device proves itself with Apple App Attest, Google Play Integrity, Android hardware key attestation (the App's `vanilla` build flavor, without Google services), or **a voucher secret for out-of-band enrolment**. A Raspberry Pi has no attestation Apple or Google would accept, so only the voucher route could fit.

| | **A. Independent device account** (the goal) | **B. Linked to the owner's account** (buildable now) | **C. The owner's account on the Pi** (experiment only) |
|---|---|---|---|
| What it is | The Pi has its own root key, its own Lite "device" identity and username, and is a contact in people's Apps | The Pi pairs with the owner's App (`product-sdk-auth`) and gets a Statement Store allowance slot, paid for by the owner's personhood | The Android App runs on a Pi 4 or 5 (LineageOS), logged in with the owner's restored account |
| Called from | **The App's own call button**, like calling a person | **The `homephone.dot` Product** inside the App | The App's call button, but calls go to the owner, not the house |
| Blocker | Device enrolment without Apple or Google attestation (voucher). Also needs the App's chat and call engine running on a Pi: Android on a Pi 4/5, or a headless Linux port | Documented APIs; the open questions are listed below. Calls go through our Product, not the native call UI | A root key that controls money sits in a hallway phone. One person, not a household. Not a product |
| Pi model | Pi 4/5 for Android; Pi Zero 2 W only with a headless port | Pi Zero 2 W | Pi 4/5 |

**Decision (18 Nov 2026): route B.** It works on the cheapest Pi and builds on the App's contacts and chat. Everything it needs is documented. A possible shortcut to A: the Desktop app is a keyless device linked to the owner's phone that now places calls. If it also rings for incoming calls, a Pi speaking the same linked-device protocol could ring for ordinary App calls (M0 question). Pursue **A** with the Polkadot Community Foundation and Parity as the goal: "device enrolment for housephones," and later a headless Linux build of the App's chat and call engine, which is also the natural thing to contribute back. B carries over into A: the household, contacts, call protocol and phone hardware stay the same, and only the Pi's identity changes. Try **C** once as a cheap experiment, on an Android emulator or a Pi 5, to see where the App breaks without attestation. Don't ship it.

## The platform in one page

| Piece | What it is | Where |
|---|---|---|
| **Polkadot App** | iOS, Android and Desktop/Web clients. The phone holds the user's root key in the hardware keystore, and all signing happens there, approved by the user. Desktop and Web hold no keys; they pair with the phone. | [client tier](https://developers.polkadot.com/apps/architecture/client/) |
| **Product** | A static web app with a `.dot` name, published to Bulletin, running sandboxed in the App or the web gateway. It talks to its host over **TrUAPI**: accounts, signing, permissions (microphone is documented; **WebRTC isn't**), Statement Store, storage, notifications, chat. | [architecture](https://developers.polkadot.com/apps/architecture/) |
| **Product account** | Each user gets a separate account per Product, derived from their root key with the path `["product", productId, index]` (sr25519 soft derivation). Accounts in different Products can't be linked. Its public key can be computed off-device. | [identity](https://developers.polkadot.com/apps/concepts/identity/) |
| **Statement Store** (People chain, para 1004) | Signed, off-chain, gossiped publish/subscribe. **512 bytes** per statement, **measured after JSON encoding**. **30 s default lifetime** (configurable up to an unstated cap). Best-effort delivery with no ack, retry or ordering; subscribers get the live pool replayed, and hosts drop duplicates by content hash. Topics: the primary topic is `blake2b(appName)`, plus an optional `topic2`. Publishing requires a per-account **allowance** (`max_count` live statements, `max_size` total bytes). Not fee-based. | [reference](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/) |
| **Bulletin** (para 1010) | Content-addressed storage for Product bundles and app data. Anyone with the CID can read. Kept **about 2 weeks** and renewable. Writes need an authorization, not a fee. | [data placement](https://developers.polkadot.com/apps/concepts/data-placement/) |
| **Asset Hub** (para 1000) | PolkaVM/EVM contracts (`pallet-revive`), assets, DotNS. For "enforced shared state" only; every write is a signed transaction. | [network](https://developers.polkadot.com/apps/architecture/network/) |
| **DotNS** | `.dot` names to content. A stem of 9 or more characters needs no personhood, so `homephone` (9) qualifies, for a refundable 10 PAS deposit. Registrations don't expire. | [naming](https://developers.polkadot.com/apps/architecture/naming/) |
| **Personhood** | Tiers None, Lite (attested username such as `alicia.07`) and Full (by invitation). Each Product sees a per-Product alias. The earned name is readable with a permission prompt (`getUserId`). | [personhood](https://developers.polkadot.com/apps/using-the-app/username-and-personhood/) |
| **Chat and calls** | Built into the App. **Call signalling** (offer, answer, candidates) goes as encrypted chat messages over the Statement Store. Chat **message text is stored encrypted on Bulletin**, with the Statement Store announcing it. Media is peer-to-peer WebRTC with short-lived TURN from platform infrastructure. Mobile has calls, and **Desktop got calls in the September update**: a keyless, linked device that calls. | [messaging](https://developers.polkadot.com/apps/architecture/messaging/) |
| **CLI pairing** | `@parity/product-sdk-auth` and `-terminal` (Node 21 or newer; the `pad` deploy tool needs 22) pair a headless process with the user's App by QR code. Transactions still need approval on the phone. **Statement Store and Bulletin writes use an allowance slot the phone grants once; after that the process signs locally.** | [terminal](https://developers.polkadot.com/apps/product-sdk/terminal/), [auth](https://developers.polkadot.com/apps/product-sdk/auth/) |

### Networks: testnet only, for now

* **`devnet`** (Products Devnet): run by the Polkadot Community Foundation (PCF). Only its own App builds use it: the [Android tester group](https://appdistribution.firebase.dev/i/f3b79521380b40b9), the [APK](https://github.com/Polkadot-Community-Foundation/polkadot-android-community/releases/latest), [TestFlight](https://testflight.apple.com/join/HnBX59vz) and the [Desktop release](https://github.com/Polkadot-Community-Foundation/polkadot-desktop-community/releases/latest). **The App Store and Google Play releases are on a different network**, so family members need these builds. Hosts speak **TrUAPI 0.25**, so Products must pin **`@parity/product-sdk@0.39.0`**.
* **`paseo`** (Paseo Next v2): run by Parity. Desktop development builds default to it, and so do the terminal SDK's endpoints.
* **The production `polkadot` and `kusama` presets are not live.** Requesting them throws an error. Until they are, Homephone is a testnet project. Resets happen: the September devnet update gave everyone a fresh account, new usernames and empty contacts (`.dot` names survived), so Homephone needs an easy way to re-join a household.

**We target `devnet`**, because that's where family members' App builds are. Endpoints and addresses come from SDK presets and are never hard-coded.

## How Homephone maps onto it (route B)

```
 Polkadot App (phone)                     Pi phone
 ┌───────────────────────────┐            ┌───────────────────────────────┐
 │ root key (keystore)       │  QR pair   │ homephone-dot (Node sidecar) │
 │ homephone.dot Product ◄──┼───────────►│   product-sdk-auth/terminal   │
 │  - household setup        │ allowance  │   Statement Store pub/sub     │
 │  - call / answer (WebRTC) │   slot     │ phone program (Python)        │
 └────────────┬──────────────┘            │   hook, ringer, aiortc audio  │
              │ encrypted ring/offer/      └──────────────┬────────────────┘
              │ answer statements                         │
              └──────────► People chain Statement Store ◄─┘
                           (topic = blake2b(appName), topic2 = household inbox)
 Voice: WebRTC peer to peer; TURN only when direct fails.
```

| Homephone concept | Polkadot primitive |
|---|---|
| The app people use | The **`homephone.dot` Product**, opened in the Polkadot App. No separate app-store app and no Apple Developer account needed to start. |
| A person | Their **Homephone product account** (`["product","homephone.dot",0]`). Their display name is their earned name if they grant it, otherwise a name they set in Homephone. |
| A household | Created by its owner's product account. The owner signs which devices and people belong to it. |
| A Pi phone | A **paired session** of the owner's account, made with `product-sdk-auth`. It holds a **Statement Store allowance slot** so it can ring and answer without the phone (the terminal SDK signs locally with the slot; a Product in the App gets each proof from the App instead). It must pair as `homephone.dot`, against the devnet People endpoints. It also has its own sr25519 device key (what `homephone-identity` makes today) for end-to-end encryption and for signing its call offers, certified by the household's signature. |
| Ringing, answering, call setup | **Statement Store** messages: primary topic `blake2b(appName)`, the same `appName` for the Product and the Pi; `topic2` = a household or device inbox. Payloads are encrypted to the recipients and signed. A compact offer is about 210 bytes, about 300 after base64 inside JSON, under the 512-byte limit. Each ring carries an id, a sequence number and an expiry, because subscribers get replays and hosts drop exact duplicates. A ring is re-published every few seconds until answered, cancelled or 45 s pass, which also covers the lack of retries; the callee publishes an acknowledgement. |
| Voice | WebRTC peer to peer: aiortc on the Pi, the browser's WebRTC in the Product (the `Microphone` permission is documented; whether a Product may use WebRTC at all is not, and is the first M0 test). TURN only as a fallback. |
| Contacts ("who may ring us") | People you invite through the **Polkadot App chat** and approve (see [Who can ring your home](#who-can-ring-your-home)). The household's allowlist of Homephone accounts is signed and checked on every device. If it needs to be durable, it's stored **encrypted** on Bulletin. **Not in a contract**, which would make the family graph public forever. |
| Lost or stolen device | Revoked by the household signing a revocation, which is pushed to devices. An on-chain revocation list (Asset Hub contract) only if it turns out to be needed. |

## Who can ring your home

**Rule: only people you're connected to in the Polkadot App, and whom you've approved, can ring your house.**

The platform hides the contact graph from Products on purpose, so a Pi can't simply ask "is this caller one of my contacts?" What a Product can do (TrUAPI source, `rust/crates/truapi/src/v01/contacts.rs`, and RFC `docs/rfcs/contacts-api.md` in trinity-user-agents, draft):

* `host_contacts_pick` opens the App's own contact picker. The Product gets back one **opaque handle**: no name, no account and no list. Handles are keyed on the picking user's secret, so they can't be turned into an account or compared between users.
* The host turns a handle into an account only **inside a transaction the user signs**. That would put the relationship on-chain, which we don't want.
* Products can create chat rooms, but only between the user and the Product's bot, not with other people. Our reading of the source (`v01/notifications.rs`) says Product notifications are local only, but the SDK docs call `getNotificationManager()` "push notifications to the user's phone". M0 tests which is true.

So Homephone uses **the App's chat as the trusted channel for invitations, and keeps its own allowlist**:

1. **Create a home.** In `homephone.dot` you create a household, and your Homephone account owns it. Pair the Pi to it.
2. **Invite.** "Invite someone to ring my home" makes a one-time, expiring invite link (household id, household key, single-use secret). You send it **in the Polkadot App chat**. Only your App contacts can receive it there; that's the "connected in the Polkadot App" part.
3. **Join.** They tap the link and Homephone opens in their App. Their Homephone account signs a join request, sent to your household's Statement Store inbox and encrypted to it.
4. **Approve.** You see "alicia.07 wants to be able to ring your home". The name comes from their Polkadot username if they share it. Once you approve, every device in the house adds their Homephone account to its allowlist. Approval stops a forwarded link from working for a stranger.
5. **Ring.** A ring is signed by the caller's Homephone account. The Pi rings only if that account is on its allowlist. Anything else is dropped silently and the phone never makes a sound.
6. **Remove.** Remove someone in Homephone. Devices drop them, and their rings are ignored from then on.

Joining also adds your house to their Homephone, as a "Call home" button.

**Things to ask Parity for**, which would make this fully native:
* **Statements addressed to a contact handle.** The host would encrypt to the contact and label incoming statements from contacts, so a Product could ring someone it can't identify, and nothing would go on-chain.
* **Remote notifications for Products.** Then a ring reaches a family member's phone when Homephone isn't open. The App already does this for its own chat (`RegisterNotificationForCollection`), but there's nothing for Products yet. **Until then, ringing family members' phones only works while Homephone is open on them.** Ringing the Pi always works, because it's always listening.

### Rules this gives us

1. **The Pi never needs a transaction in normal use.** `AutoSigning` returns `NotAvailable` on mobile, so every transaction waits for the owner's phone. Anything on-chain happens at setup, while the owner is present.
2. **Statements are signals, not storage.** Anything that has to outlive about 30 s goes to device storage or Bulletin.
3. **Everything is encrypted before it reaches the Statement Store.** The network separates topics but doesn't encrypt them.
4. **Plan for re-pairing.** Allowance lifetimes are undocumented, and an expired one shows up as "re-pair the wallet." The Pi needs a clear signal for this (light and voice prompt) and an easy re-pair flow.
5. **Pin versions to the network.** `devnet` hosts run TrUAPI 0.25, so we use Product SDK 0.39.0. Newer SDKs speak TrUAPI 0.26 and don't work there yet.

## Language on the Pi

The Polkadot SDKs we need on the Pi (auth, terminal, statement store) are **TypeScript for Node 21 or newer**, and the pairing and allowance-slot protocols are internal to them and still provisional. Rewriting them in Python would mean chasing a moving target. So:

* **`homephone-dot`**, a small Node sidecar on the Pi, owns everything Polkadot: pairing, allowance slots, Statement Store publish and subscribe, encryption and signing of call messages.
* **The Python phone program** keeps the hook, ringer, audio and aiortc, and talks to the sidecar over a local socket. This replaces today's WebSocket to the ringing server.

To check: Node's memory use on the Pi Zero 2 W alongside Python and aiortc. Node 22 is available for arm64.

## Open questions (resolve in M0)

| Question | Why it matters | How to find out |
|---|---|---|
| Does the owner's App grant a **Statement Store allowance** to the Homephone product account and to a paired Pi, paid for by the owner's Lite personhood? The docs on this are "not yet documented, ask the community" | Every ring needs one. This is the biggest blocker for route B | Request `StatementStoreAllowance` from a test Product and from a paired Node process, then ask in [#polkadot-products-public](https://matrix.to/#/#polkadot-products-public:matrix.org) (Matrix) and `#devnet-discussion` (Discord) |
| Can a **non-phone device be enrolled** as a Lite device with a voucher, get a username and be chatted with? | Route A, the goal | Ask PCF and Parity directly. Read `identity-backend-community`'s voucher flow |
| Does an **allowance slot** granted to a paired CLI last for days or weeks? | An always-on phone can't keep asking its owner | Pair a Node process and leave it running |
| **Statement Store latency**, publish to receive, across nodes | A ring has to arrive within a second or two | Measure it in the M0 spike |
| Can a Product inside the mobile App use **WebRTC and the microphone** at all? TrUAPI has no voice API and "the Host API is the only egress" | Route B's voice depends on it. **Test first**, on iOS and Android separately | A test Product that opens an `RTCPeerConnection` |
| Does the **Desktop app ring for incoming calls**, and could a Pi speak its linked-device protocol? | Native App calls ringing the house, with no Product | Call a Desktop-paired account; read the [Desktop source](https://github.com/Polkadot-Community-Foundation/polkadot-desktop-community) |
| The Statement Store **TTL cap**, the **slot size** (`max_count`, `max_size`), and which `appName` the host hashes for `homephone.dot` | Ring lifetime, re-send rate, and whether Pi and Product hear each other | Read the SDK source; ask in the channel |
| Does a Product inside the App get **TURN**, or only WebRTC? The docs tell Products not to embed TURN, but no TrUAPI call for it is documented | Calls from behind hard NAT | Try it with the [host playground](https://github.com/paritytech/host-playground), or ask |
| Can a Product **ring the user while it's closed**? Product notifications are local only in TrUAPI today, and chat bot rooms are per user | Otherwise family members only hear a ring with Homephone open | Ask Parity. Test whether a bot room message notifies when the App is in the background |
| How does a **screenless Pi pair**? QR pairing assumes a terminal you can scan | Setup without a laptop | For now the Pi serves the QR on a local web page. Later, a pairing deep link, if the App supports one |
| What does running the App's **chat and call engine** on a Pi take (route A)? | The native call button, with no Product needed | The chat wire format is provisional. Platform TURN comes from the identity backend, which requires an attested session. Read the [Android](https://github.com/Polkadot-Community-Foundation/polkadot-android-community) and Desktop source, and try route C on an emulator |

## Sources

* Docs: [architecture](https://developers.polkadot.com/apps/architecture/), [accounts](https://developers.polkadot.com/apps/concepts/accounts/), [allowances](https://developers.polkadot.com/apps/concepts/allowances/), [identity](https://developers.polkadot.com/apps/concepts/identity/), [networks](https://developers.polkadot.com/apps/concepts/networks/), [data placement](https://developers.polkadot.com/apps/concepts/data-placement/), [Statement Store](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/) ([allowance](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/allowance/), [lifecycle](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/lifecycle/), [subscriptions](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/subscriptions/)), [messaging and calls](https://developers.polkadot.com/apps/architecture/messaging/), [TrUAPI chat](https://developers.polkadot.com/reference/apps/protocol/truapi/chat/), [terminal](https://developers.polkadot.com/apps/product-sdk/terminal/), [auth](https://developers.polkadot.com/apps/product-sdk/auth/), [keys](https://developers.polkadot.com/apps/product-sdk/keys/), [get started](https://developers.polkadot.com/apps/get-started/developers/), [October devnet update](https://developers.polkadot.com/apps/updates/2026-10-devnet-update/)
* Code: [product-sdk](https://github.com/paritytech/product-sdk) (Apache-2.0), [trinity-user-agents](https://github.com/paritytech/trinity-user-agents) (TrUAPI core MIT; App hosts in `hosts/ios` and `hosts/android`, GPL-3.0), [polkadot-desktop-community](https://github.com/Polkadot-Community-Foundation/polkadot-desktop-community) (GPL-3.0), [polkadot-android-community](https://github.com/Polkadot-Community-Foundation/polkadot-android-community), [playground-app-template](https://github.com/Polkadot-Community-Foundation/playground-app-template)
* The App's own call stack is a working reference for ours: `hosts/ios/polkadot-app/Modules/ChatCall/` (minimized SDP in `Connection/SdpCoder`, PushKit/CallKit, TURN credentials from the identity backend).
