# Polkadot developer docs: what matters for Homephone

A full read of the [Polkadot developer docs](https://developers.polkadot.com/apps/) on 20 Nov 2026: all 131 Apps and Apps-reference pages, plus the Bulletin chain page. Each fact links to its page. The design built on these facts is in [polkadot.md](polkadot.md).

**Legend.** ✅ helps us · ⚠️ a constraint we must design for · ❓ undocumented, test in M0 · ❌ blocks something

## The five things that shape the build

1. ✅ **The Pi can publish rings on its own after pairing.** The terminal SDK's "allowance signers are the canonical write path… ask the wallet for an allowance slot once and sign locally afterward" ([terminal](https://developers.polkadot.com/apps/product-sdk/terminal/)). Products inside the App work differently: the App signs a proof for each statement ([lifecycle](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/lifecycle/)). That's fine, because the caller's phone is awake anyway. ❓ Nothing documents how long the slot lasts.
2. ❓❌ **Voice inside a Product is undocumented.** No TrUAPI group covers WebRTC, TURN or a call UI. The only media permission named is the microphone ([permissions](https://developers.polkadot.com/reference/apps/protocol/truapi/permissions/)). The sandbox says "the Host API is the only egress… there is no escape hatch" ([sandbox](https://developers.polkadot.com/reference/apps/protocol/truapi/sandbox/)). The docs also say Products shouldn't run their own TURN, because calling is "a service the host provides" ([messaging](https://developers.polkadot.com/apps/architecture/messaging/#nat-traversal-stun-and-turn)). **This is the biggest risk to route B.** Test first in M0 on iOS **and** Android, because the mobile bridge "differs from the spec and, in places, between iOS and Android" ([TrUAPI](https://developers.polkadot.com/reference/apps/protocol/truapi/)).
3. ✅❓ **The Desktop app is a linked device that makes calls.** It holds no keys and pairs with the phone. Since the [September update](https://developers.polkadot.com/apps/updates/2026-09-devnet-update/#desktop-app) it has "audio and video calls" and syncs contacts and chats with the phone "over an encrypted peer-to-peer channel… set up through the same statement store path used for calls" ([messaging & calls](https://developers.polkadot.com/apps/using-the-app/messaging-and-calls/#device-sync)). If Desktop rings when someone calls its owner, a Pi that speaks the same linked-device protocol could ring for **ordinary App calls**, with no Product needed. That is close to route A without device enrolment. (The architecture page still says calls are mobile-only; the update is newer.)
4. ⚠️ **Family members need the test builds.** "The Polkadot releases on Google Play and the App Store connect to a different network and do not work with these docs." The devnet builds are the [Android tester group](https://appdistribution.firebase.dev/i/f3b79521380b40b9), the [APK](https://github.com/Polkadot-Community-Foundation/polkadot-android-community/releases/latest), [TestFlight](https://testflight.apple.com/join/HnBX59vz) and [Desktop](https://github.com/Polkadot-Community-Foundation/polkadot-desktop-community/releases/latest) ([users](https://developers.polkadot.com/apps/using-the-app/users/)).
5. ⚠️ **Devnet resets wipe accounts.** The September update needed "a fresh account" for everyone. Contacts and messages started over, and everyone needed a new username; `.dot` names survived ([update](https://developers.polkadot.com/apps/updates/2026-09-devnet-update/)). Homephone needs an easy "re-join the household" flow, and we watch the [updates page](https://developers.polkadot.com/apps/updates/2026-10-devnet-update/).

## Verified in the source and on the live chain (20 Nov 2026)

The docs left the biggest questions open, so we read the code: [product-sdk](https://github.com/paritytech/product-sdk) at `@parity/product-sdk@0.39.0` and main, [trinity-user-agents](https://github.com/paritytech/trinity-user-agents) (TrUAPI and the iOS/Android hosts), [polkadot-desktop-community](https://github.com/Polkadot-Community-Foundation/polkadot-desktop-community), and the devnet People chain (1004) over read-only RPC.

| Question | Answer | Evidence |
|---|---|---|
| Can a Product do WebRTC voice? | ✅ **Yes.** The App's injected script gates `RTCPeerConnection` behind a TrUAPI `WebRtc` permission and `getUserMedia` behind `Microphone`. Android and iOS grant audio capture under that permission. Our own STUN/TURN servers are allowed. | `trinity-user-agents/js/container` |
| Does the platform give a Product TURN or the App's call engine? | ❌ No. We bring our own TURN. | TrUAPI method list |
| Can a Product ring a phone whose App or Product is closed? | ❌ **No.** Product notifications are local only on iOS, Android and Desktop, with no recipient. | `getNotificationManager`, host code |
| Does Desktop ring for incoming calls? | ✅ **Yes**, while it's running, and it stops when another device answers. | `src/features/call/ui/IncomingCallDetector.tsx` |
| What does a linked device get when paired? | Its own signing and encryption keys, plus **the owner's chat X25519 private key**. The phone pays its storage allowance and announces it to contacts. The same pairing is used by CLIs. | `rust/crates/truapi/src/host_logic/sso/pairing/v2.rs:82` |
| Is there a headless host? | ✅ `truapi-host pairing-host` CLI (Linux arm64) and `@parity/truapi-host/node`. It covers pairing only, not chat or calls. | trinity-user-agents |
| How does the App ring a closed phone? | Call offers are chat messages to every device of the person being called. When the App is backgrounded, the identity backend sends PushKit or FCM. | iOS `Modules/ChatCall`, Android |
| Can the Pi publish with the SDK as shipped? | ⚠️ Not directly. `StatementStoreClient` has no Node transport (`mode:'local'` throws), so the sidecar plugs in its own, using the terminal's prover. | `product-sdk` statement-store, terminal 0.13.3 / 0.14.0 |
| Topic | `blake2b-256(utf8(appName))`. `topic2` and `channel` are hashed the same way. | statement-store source |
| Statement lifetime | `expiry` = (unix seconds << 32) \| sequence. **No maximum TTL** on the chain. A newer statement on the same channel must have a higher expiry, or it's rejected as `channelPriorityTooLow`. | polkadot-sdk `stable2609-2`, live RPC |
| Size | The SDK caps data at 512 bytes of JSON. The node allows far more; the real cap is the account's `max_size`. | `data.ts:40`, node source |
| **Allowance sizes** (live chain) | **Lite person: 50 statements / 500 KiB. Full: 200 / 1 MiB. A claimed slot, which is what a paired Pi gets: 2 statements / 500 KiB, lasting about 2–3 days**, up to 20 slots claimed a day. No allowance means `rejected: noAllowance`. | People chain storage, `:statement_allowance:` |
| Gossip | All three devnet RPC nodes held the same 7,253 statements. | 60 s live subscription |

**What this means for the design:**
* **Route B's voice works**, but **a Product can't ring a closed App**. With B, family members hear the house ring them only while Homephone is open.
* **A Pi slot holds just 2 live statements.** The Pi keeps one channel for messages to the other phone and one for messages to its household, each new message replacing the last, with a short real expiry.
* Slots expire after about 2–3 days. ❓ Can the Pi renew one without the owner's phone? The newer terminal core renews itself, but claiming uses a ring-VRF proof.
* **Route A′ (the Pi as a linked device) now looks possible.** Desktop shows a linked device can receive calls and ring. A Pi that speaks the same chat and call protocol would ring for **ordinary App calls**, and calls it makes would ring family phones through the platform's own push. The costs: reimplementing Desktop's chat and call modules (a provisional wire format), and the Pi holding the owner's chat key.

## Statement Store (ringing and call setup)

| Fact | Means for Homephone |
|---|---|
| **512 bytes, measured after JSON encoding** ([allowance](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/allowance/), [pub-sub](https://developers.polkadot.com/apps/build/pub-sub-off-chain-data/#publish-a-typed-statement)) | ⚠️ Binary ciphertext goes in as base64 (+33%). Re-budget the ~210-byte offer, which becomes ~300 bytes. Keep the offer compact. |
| TTL defaults to 30 s, up to a pallet cap that isn't stated. The tutorial uses 3600 s ([lifecycle](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/lifecycle/), [tutorial](https://developers.polkadot.com/apps/tutorials/shared-todo-app/#make-the-board-durable)) | ❓ Find the cap. A ring needs about 45 s. |
| Primary topic = `blake2b(appName)`, set at the host boundary, plus an optional `topic2` ([reference](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/)) | ⚠️ The Pi's sidecar must use the same `appName` as the `homephone.dot` Product, or the two won't hear each other. ❓ Is it `homephone` or `homephone.dot`? |
| Subscribing **replays every live statement**, and your own statements echo back ([subscriptions](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/subscriptions/)) | ⚠️ Every ring carries an id and an expiry time. A rebooted Pi must not ring for an old call. |
| The host **deduplicates by content hash** ([TrUAPI statement store](https://developers.polkadot.com/reference/apps/protocol/truapi/statement-store/)) | ⚠️ A re-sent ring needs a sequence number, or it's dropped as a duplicate. |
| Channels: last write wins **per account and channel** ([channels](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/channels/)) | ✅ Put call state on channel `call:<id>`, so it's one live statement, not many. |
| Delivery is best effort. A subscriber on the same node will see it; one on another node "may or may not" ([lifecycle](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/lifecycle/)) | ⚠️ Re-send until acknowledged. ❓ Measure loss and delay between nodes. Same-node delivery took "a couple of seconds" in the tutorial. |
| Allowance = `max_count` live statements + `max_size` bytes. No fee. On testnet it's set by the privileged `increase_allowance_by` (governance or sudo). Provisioning is "still being defined" ([allowance](https://developers.polkadot.com/reference/apps/infrastructure/statement-store/allowance/)) | ❓ How large is a granted slot? Ask in [#polkadot-products-public](https://matrix.to/#/#polkadot-products-public:matrix.org). |
| SDK: `@parity/product-sdk-statement-store` (not in the main package). `new StatementStoreClient({appName})`, `connect({mode:'host'})`, `publish(obj,{topic2, channel, ttlSeconds})`, `subscribe(cb)`, `ChannelStore` ([SDK](https://developers.polkadot.com/apps/product-sdk/statement-store/)) | The Product uses this as is. ❓ The Pi has no host. `mode:'local'` is "mainly for tests", and how it connects to the terminal's `getStatementStoreProver` isn't documented. Read the SDK source. |

## Pairing the Pi (terminal and auth SDKs)

* `@parity/product-sdk-terminal` runs on Node 21 or newer, Node only. It keeps sessions on disk in `~/.polkadot-apps/`, pairs by QR (`adapter.sso.pairingStatus`, then `authenticate()`), and has `createSessionSigner` ([terminal](https://developers.polkadot.com/apps/product-sdk/terminal/)).
* `hasStatementStoreAllowance` is a cache check that never buzzes the owner's phone. ✅ The Pi's "needs re-pairing" light uses it.
* `@parity/product-sdk-auth`: `createAuthClient({dappId, productId, derivationIndex, peopleEndpoints})` gives the session's `rootAddress`, `productAddress` and `productH160`. A new session **can't sign until the owner grants** `DEFAULT_RESOURCES` (Bulletin, Statement Store and contract allowances) ([auth](https://developers.polkadot.com/apps/product-sdk/auth/)).
* ⚠️ **Endpoints.** The examples use Paseo Next. We must pass the **devnet People (1004)** endpoints, for example `wss://people-paseo.rotko.net` ([networks](https://developers.polkadot.com/apps/reference/networks/)).
* ⚠️ **Which account the Pi signs as.** A paired session signs as the product account `["product", productId, index]`. Pair the Pi as `homephone.dot`, or it becomes a different account ([accounts](https://developers.polkadot.com/apps/concepts/accounts/)). ❓ At index 0 the Pi is the *same* account as the owner's Homephone in the App, sharing one allowance and one set of channels. Index 1 avoids that, but `DEFAULT_RESOURCES` targets index 0.
* Allowance lifetime: "not documented". An expired one shows as "re-pair the wallet". There is no per-allowance revoke; signing out clears everything ([allowances](https://developers.polkadot.com/apps/concepts/allowances/#scope-and-lifetime)).
* `AutoSigning` is `NotAvailable` on iOS and Android. Every transaction waits for the phone, and nothing tells the owner the phone is waiting ([signer](https://developers.polkadot.com/apps/product-sdk/signer/)). ✅ This confirms our rule that the Pi makes no transactions.
* Host-only pieces fail on the Pi: `createApp()`, `chain-client` ("no direct-WebSocket fallback") and Bulletin reads ("only work inside a container") ([troubleshooting](https://developers.polkadot.com/apps/troubleshooting/)). The Pi uses plain PAPI and the terminal SDK.

## Chat, contacts and invites

* The App's chat: the **Statement Store carries the signalling** (presence, typing, "message-arrival notifications"), and **Bulletin holds the encrypted message text** ([chat](https://developers.polkadot.com/reference/apps/hosts/polkadot-app/chat/)). Calls send offer, answer, candidates and hang-up "as encrypted chat messages over the statement store", with short-lived TURN credentials from the platform ([messaging](https://developers.polkadot.com/apps/architecture/messaging/#voice-and-video-calls)).
* What a Product can do in chat: register **as a bot in a room**, create "simple group chats" (`host_chat_create_simple_group`), send `Text`, `RichText`, `Actions`, `File` and `Custom` messages, and **render its own `Custom` messages inside the chat** ([TrUAPI chat](https://developers.polkadot.com/reference/apps/protocol/truapi/chat/)). ✅ An invite could be a Homephone card with a "Join" button right in the chat. ❓ Who can be in a group is still provisional.
* People must have added each other as contacts to chat. Chat history lives on the device and isn't restored from backup ([messaging & calls](https://developers.polkadot.com/apps/using-the-app/messaging-and-calls/)).
* The mobile App has no address bar. Products open from Browse or from a tapped `.dot` / `.dev-dot.li` link ([discover](https://developers.polkadot.com/apps/using-the-app/discover-and-open-apps/)). ✅ The invite link works.
* `signMessageWithDotNsIdentity` proves a joiner's username to the owner, but reveals their main account ([platform services](https://developers.polkadot.com/apps/build/platform-services-sdk/#read-identity-and-personhood)). Optional, and a privacy trade-off.

## Notifications (ringing a closed app)

* ❓ The SDK overview lists `getNotificationManager()` as "push notifications to the user's phone" ([SDK](https://developers.polkadot.com/apps/product-sdk/)). TrUAPI has `host_push_notification`, "documented per-Host" ([TrUAPI](https://developers.polkadot.com/reference/apps/protocol/truapi/)). Our reading of the App source said local only. **Test whether a Product can alert a phone while it's closed.** That decides whether family phones ring when Homephone isn't open.
* ❓ A deploy config can add a `worker` entry, published to `worker.homephone.dot` ([build & publish](https://developers.polkadot.com/apps/build/build-and-publish/#add-card-metadata)). It's undocumented; it might be a background runner.

## Identity and personhood

* Tiers: None → **Lite** (an attested device, username like `alicia.07`) → **Full** (by invitation voucher only) ([username & personhood](https://developers.polkadot.com/apps/using-the-app/username-and-personhood/)).
* A **device name** (`joseph.42`) identifies "a proved device" and comes only from the identity gateway. It's issued after Apple or Google attestation, or **"a voucher secret for out-of-band enrolment"** ([identity architecture](https://developers.polkadot.com/apps/architecture/identity/), [PoP rules](https://developers.polkadot.com/reference/apps/infrastructure/dotns/poprules-pricing/)). **For route A, this voucher is what we ask PCF for.**
* `identity-backend` is "centralized today". On iOS, DeviceCheck limits free registrations per device (`PAYMENT_REQUIRED`), which matters when family members re-register after a reset.
* A personhood check at `0x…0A010000` (`personhoodStatus`) needs no account ([addresses](https://developers.polkadot.com/apps/reference/addresses/)).

## Publishing `homephone.dot`

* ✅ `homephone` has 9 letters, so it needs no personhood. It costs a **refundable 10 PAS deposit**, and registrations **don't expire** ([register](https://developers.polkadot.com/apps/build/register-a-dot-name/), [PoP rules](https://developers.polkadot.com/reference/apps/infrastructure/dotns/poprules-pricing/)). PAS is free from the [faucet](https://faucet.polkadot.io).
* Publish from the laptop, never the Pi: `pad ./dist homephone.dot --env devnet`. `pad` needs **Node 22+** and about 1.5 GB ([build & publish](https://developers.polkadot.com/apps/build/build-and-publish/)). Start from the [playground template](https://github.com/Polkadot-Community-Foundation/playground-app-template) (SDK 0.39.0). `pad login` hands the name to the owner's App account.
* ⚠️ **The app bundle expires after about 2 weeks** unless renewed. `playground deploy` doesn't renew; use `enableAutoRenew` while the storage authorization lasts ([keep your app available](https://developers.polkadot.com/apps/deploy-your-app/#keep-your-app-available)). Bulletin writes need an authorization from the [faucet](https://developers.polkadot.com/chain-interactions/store-data/bulletin-chain/), and you can't authorize yourself.
* Listing in Browse needs Lite personhood (1 a day). Not needed: family members open Homephone from the invite link ([discovery](https://developers.polkadot.com/apps/architecture/discovery/)).
* ⚠️ The `dotns` CLI defaults to **mainnet** and spends real DOT. Always pass `--env` ([CLI](https://developers.polkadot.com/reference/apps/infrastructure/dotns/cli/)).

## Versions and networks

* Pin **`@parity/product-sdk@0.39.0`**. Devnet hosts speak TrUAPI 0.25, and later SDKs speak 0.26 ([October update](https://developers.polkadot.com/apps/updates/2026-10-devnet-update/)). `@novasamatech/host-api` doesn't work on devnet.
* **`devnet`** (PCF): Asset Hub 1000, People 1004, Bulletin 1010, SS58 42, PAS. **`paseo`** (Parity, Paseo Next v2): 1500 and 1502. `polkadot` and `kusama` throw "not live yet" ([networks](https://developers.polkadot.com/apps/concepts/networks/)).
* Local storage in a Product is per device and **doesn't sync** ([persist data](https://developers.polkadot.com/apps/build/persist-data-locally/)). The household allowlist must live on each device (the Pi keeps its own), not only on the owner's phone.

## Not useful to us

* **HOP** moves assets and messages between chains on-chain. It can't carry ringing or audio ([HOP](https://developers.polkadot.com/reference/apps/infrastructure/hop/)).
* Smart contracts, CASH and coinage, Pocket, preimages, and the Playground directory.
