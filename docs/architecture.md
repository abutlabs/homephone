# Architecture

This describes milestone 1 as built: one ringing server, voice through LiveKit. Where it's going, a Polkadot housephone with ringing over the Statement Store and the Polkadot App as the app, is in [polkadot.md](polkadot.md) and [ROADMAP.md](../ROADMAP.md).

## Pieces

| Piece | Where it runs | Code |
|---|---|---|
| Phone program | Raspberry Pi (64-bit Raspberry Pi OS Lite) | `src/homephone/phone` |
| Ringing server | Laptop for now, later a small server | `src/homephone/server` |
| Laptop test phone | Any browser, served by the ringing server | `src/homephone/web` |
| Media | LiveKit Cloud, or a local LiveKit in Docker | — |
| Device identity | Each device, `~/.config/homephone/device-key.json` | `src/homephone/identity.py` |
| Household contract (early sketch, likely dropped) | Polkadot Hub | `contracts/HouseholdRegistry.sol` |

The ringing server never touches audio. It only decides who rings, who answered, and hands each side a LiveKit token for that call's room. Audio is WebRTC (Opus) between the device and LiveKit.

## The phone

```
GPIO hook switch ─┐                 ┌─> USB speaker: bell
                  ├─> PhoneController ─> USB sound card: tones, call audio
ringing server ───┘        │
                           └─> LiveKit room (mic published, far end played)
```

States:

| State | Means | Earpiece | Ringer |
|---|---|---|---|
| idle | handset down | — | — |
| ringing | a call for this household | — | bell |
| dialing | handset up, about to call | dial tone | — |
| calling | waiting for someone to pick up | ringback | — |
| answering | picked up, waiting for the room | — | — |
| in_call | talking | the far end | — |
| ended | the far end hung up, or nobody is home | busy tone | — |

Milestone 1 has no keypad: lifting the handset waits 1.5 s on dial tone and then rings `HOMEPHONE_DEFAULT_CALL`. Hanging up during the dial tone cancels it.

Hardware is behind small interfaces (`Hook`, `Handset`, `Ringer`, `Media`), each with a mock, so the same program runs on a laptop, in Docker and in tests.

## Ringing protocol

JSON over one WebSocket per device at `/ws`. The full list is in `src/homephone/protocol.py`.

1. Server sends `challenge {nonce}`.
2. A phone replies `hello {kind: phone, address, signature}`, signing `homephone-hello:<nonce>` with its Polkadot sr25519 key. The server checks the signature and looks the address up in the household list. The laptop page sends `hello {kind: web, key, household}` with the key the server printed.
3. `call {to: <household>}`: the server sends the caller `calling` with a token and rings every free device in that household with `ring`.
4. The first `answer` wins: that device gets `join` with its token, the caller gets `answered`, and every other device gets `stop_ring`.
5. `hangup` from either side ends it; the other side gets `ended`. A device that hangs up while ringing only declines for itself.
6. Unanswered calls end after 45 s (`no_answer`). Nobody online gives `unavailable` straight away.

## Identity and Polkadot

* On first start a device generates a 12-word secret phrase and an sr25519 keypair, saved with mode 600. `homephone-identity` prints its Polkadot address and the H160 address that Polkadot Hub contracts see for it.
* Signing in with that key means the server doesn't need passwords for phones, and the same key will sign call offers and household grants. See [polkadot.md](polkadot.md) for how device keys relate to the owner's Polkadot account.
* Only account addresses go on-chain. Names and call history stay off it.
* Ringing over the People chain Statement Store is milestone 2; see [ROADMAP.md](../ROADMAP.md).

## Laptop test setup (Docker)

`compose.yaml` runs three containers: `livekit` (local LiveKit, public dev key), `server` and `phone` (mock hardware). The phone shares LiveKit's network, so `ws://localhost:7880` works for both it and your browser. LiveKit advertises `127.0.0.1` for media by default; set `LIVEKIT_NODE_IP` to your laptop's LAN address if a real Pi should join this local LiveKit instead of LiveKit Cloud.
