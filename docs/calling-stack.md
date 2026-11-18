# Calling stack: reuse Jami, fork it, or build our own?

Decided 18 Nov 2026. Updated the same day: Polkadot is now the foundation ([polkadot.md](polkadot.md)). Signalling goes over the Statement Store, and the Polkadot App's own WebRTC call stack is our reference design. That rules out Jami: it brings its own network, identity and name service.

## What we want

A decentralized network of household phones. Each device is a Polkadot (sr25519) account. You choose which other keys may ring you. Devices talk to each other directly. Any server involved is plumbing that anyone can replace, and it can't read or decide anything. The chain holds only what needs global agreement.

## Decision

**Build our own on small, permissively licensed parts, with Polkadot for identity and signalling. Don't use Jami.**

| Option | Verdict | Why |
|---|---|---|
| Fork Jami | No | Large C++ codebase. GPLv3 would cover our work. Identity is RSA, not sr25519. Development leans on a few Savoir-faire Linux staff. |
| Reuse Jami as a sidecar (`jamid` driven over D-Bus) | No | Contact-only calling, NAT traversal and a pluggable name server work today. But there are no arm64 builds, identity is RSA, and its DHT, name server and app would duplicate what Polkadot already provides. |
| Build our own | **Yes** | Fits the Python code, the `Media` interface, sr25519 keys and the Statement Store. Everything stays MIT or BSD. Costs: we own reliability (ICE restarts, retries) and must measure the Pi Zero ourselves. |

## Our own stack

| Layer | Choice | License |
|---|---|---|
| Media | [aiortc](https://pypi.org/project/aiortc/) 1.16 (Nov 2026) + PyAV + aioice, Opus | BSD-3 |
| Media fallback | A small [Pion](https://github.com/pion/webrtc) (Go) helper process, if aiortc is too heavy or sounds poor on the Zero | MIT |
| Polkadot side | `homephone-dot` Node sidecar using `@parity/product-sdk-auth`, `-terminal` and `-statement-store` | Apache-2.0 |
| Signalling message | Compact binary offer, about 210 bytes: ICE ufrag/pwd, DTLS fingerprint, candidates, call id, sr25519 signature. Encrypted to the callee. Fits the Statement Store's 512-byte limit ([minimum viable SDP](https://webrtchacks.com/the-minimum-viable-sdp/)). The Polkadot App minimizes SDP the same way (`SdpCoder`); match its format where we can, to make M5 easier | ours, MIT |
| Signalling transport | The People chain Statement Store, from M2. A local in-memory transport for tests | — |
| NAT traversal | Direct P2P first. TURN from the platform if Products get it, otherwise our own coturn on a small VPS. A Pi behind home NAT can't host TURN | BSD-3 |
| Contacts | Signed grants between Homephone product accounts, kept on devices (encrypted on Bulletin if they need to be durable) and checked by each device before it rings. Not in a contract, so the family graph isn't public forever | ours, MIT |
| Echo cancellation | None at first (a handset has little echo). PipeWire echo-cancel or speexdsp ready if testing shows echo | MIT / BSD |

Signing the DTLS fingerprint with the device key ties the encrypted media to the Polkadot identity, so a relay can't sit in the middle.

## What we learned about Jami

Checked 18 Nov 2026. Sources are linked; **(inference)** marks reasoning, not a source.

**Health.** Active: client releases every 2–4 weeks (latest 20261110) and about 770 daemon commits in the past year. Development is concentrated, though. One developer wrote about 24% of daemon commits and 95 of the last 100 OpenDHT commits, and about 97% of merged changes come from Savoir-faire Linux staff. Outside patches are accepted through Gerrit with no CLA, but reviews are slow. ([client tags](https://github.com/savoirfairelinux/jami-client-qt/tags), [patch guide](https://docs.jami.net/developer/new-developers/submitting-your-first-patch.html))

**Licenses.** jami-daemon/libjami and dhtnet (its ICE/TURN layer) are GPLv3+. **OpenDHT switched to MIT on 18 Jan 2026**, so we could use it directly if we ever want a DHT. Running an unmodified `jamid` as a separate process keeps Homephone MIT **(inference, not legal advice)**. The only control API is D-Bus; the old REST API is gone. ([jami-daemon](https://github.com/savoirfairelinux/jami-daemon), [opendht](https://github.com/savoirfairelinux/opendht), [APIs](https://docs.jami.net/_sources/developer/new-developers/apis-of-jami.md.txt))

**Raspberry Pi.** No official arm64 builds: the arm64 and armhf package lists on dl.jami.net are empty for Debian 12/13 and Ubuntu (checked by download). Debian bookworm ships `jami-daemon` 20230206, and trixie doesn't ship it at all. One forum user built it on a Pi 4 with `make -j1`, and cross-compiling failed. ([forum](https://forum.jami.net/t/how-to-cross-compile-jami-daemon-on-x86-64-for-aarch64-raspberry-pi/5382))

**Memory, measured here.** Bookworm `jamid` 13.7.0 (Feb 2023), arm64, headless with a D-Bus session bus, in Docker on an Apple Silicon Mac:

| State | RSS |
|---|---|
| Idle, no account | 55 MB |
| Account created and connected to the DHT (21 threads) | 60 MB, flat over 60 s |

That fits easily in 512 MB. **We haven't measured a call yet**, nor the current 2026 version.

**Identity and contacts.** The Jami ID is the hash of a 4096-bit RSA account key, with per-device certificates under it. An sr25519 key can't be the identity; we'd need a signed link between the two. "Only ring contacts" is the default (`allowPublicIncoming` is false). ([account management](https://docs.jami.net/en_US/developer/jami-concepts/account-management.html))

**Blockchain history.** Jami's name registry started on Ethereum (proof-of-work, then proof-of-authority), hit consensus failures, and moved to SQL. The name server can be swapped per account (`RingNS.uri`), and its API is small (`GET /name/{n}`, `GET /addr/{a}`, signed `POST /name/{n}`). ([post](https://jami.net/updates-on-the-jami-name-service-part-1-byzantine-faults)) The lesson for us: keep the chain out of anything that needs to be fast and reliable, and use it only for slow, rarely changing facts.

**Mobile.** Phones use a DHT proxy plus FCM, APNs or UnifiedPush. Forum threads from early 2026 report UnifiedPush not working and FCM losing the proxy after about half a day, with no developer reply. ([1](https://forum.jami.net/t/unified-push-not-working/5429), [2](https://forum.jami.net/t/help-id-love-to-love-this-app-but-i-cant-get-it-working/5454)) Always-on Pis avoid this. Our phone app will hit the same issue: background ringing on iOS needs Apple VoIP push through a server.

**Central services in a default install.** `bootstrap.jami.net`, `turn.jami.net`, `dhtproxy.jami.net`, `ns.jami.net` and `config.jami.net`. All can be self-hosted, except push notifications for the app-store apps. ([docs](https://docs.jami.net/en_US/user/jami-distributed-network.html))

## What we'd take from Jami anyway

* The trust model: calls from non-contacts are dropped before any connection is made, and devices can be revoked one at a time.
* Their name server API shape, if we ever want household names.
* Their experience with blockchains (above).
* OpenDHT (MIT) as a possible discovery fallback.

## Contributing back

We're not building on Jami, so there's little to contribute there. The contribution that matters is on the Polkadot side: device enrolment for non-phone hardware, and a headless Linux build of the App's chat and call engine (roadmap M5).

## Other projects checked

| Project | License | Use for us |
|---|---|---|
| Tox (c-toxcore) | GPL-3.0, active (v0.2.25, Nov 2026) | The closest concept (always-on, key contacts). Study only |
| SimpleX | AGPL-3.0 | Calls go WebRTC through TURN by default. Study only |
| liblinphone | AGPL-3.0 / commercial | Mature SIP stack, can't link from MIT |
| py-libp2p | MIT/Apache | Its own README marks WebRTC private-to-private as unstable. Not yet |
| libdatachannel | MPL-2.0 | Good C++ library, but the Python binding is a hobby project |
