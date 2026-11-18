# Homephone

A homephone for the internet age: a Raspberry Pi inside a classic telephone that rings the whole household, built on Polkadot.

Call a household, not a person. Your family rings your home from the Polkadot App on their phones, every phone in the house rings at once, and whoever is nearest picks up, just like the old family landline. Only people you're connected to in the Polkadot App, and have approved, can make it ring. There is no phone network and no Homephone server in the call: Polkadot carries identity, contacts and ringing, and the voice goes directly between the two ends.

**Status:** testnet only and early. The design is set (below and in [docs/polkadot.md](docs/polkadot.md)). The code in this repo today is the milestone 1 hardware harness, which proves the phone hardware with a temporary server. See [ROADMAP.md](ROADMAP.md).

## How it works

```
  Polkadot App (your phone)                              Homephone (Pi in a classic telephone)
  ┌─────────────────────────────┐                        ┌──────────────────────────────────┐
  │ homephone.dot (a Product):  │    pair once (QR)      │ paired with its owner's account  │
  │  set up your home, invite   │───────────────────────►│ handset, hook, dial, bell        │
  │  contacts, call, answer     │                        │                                  │
  └──────────────┬──────────────┘                        └────────────────┬─────────────────┘
                 │   ring / answer: signed, encrypted messages             │
                 └────────────► Polkadot Statement Store ◄────────────────┘
                 ◄═════════ voice: WebRTC, device to device (relay only if needed) ═════════►
```

* **The Polkadot App is the app.** Homephone runs inside it as a Polkadot Product, `homephone.dot`. That's where you create your home, pair a phone, invite people and make calls. Your keys stay in the App.
* **The housephone extends your Polkadot account.** A Pi in an old (or old-looking) telephone pairs with your Polkadot App once, then rings and answers on its own.
* **Ringing goes over Polkadot.** Ring, answer and hang-up are small signed and encrypted messages on Polkadot's Statement Store.
* **Only approved contacts can ring your home.** You invite a Polkadot App contact with a link sent in the App chat, they join, and you approve them. Every phone in the house ignores anyone else. [How it works](docs/polkadot.md#who-can-ring-your-home).
* **Voice goes directly between the two ends** over WebRTC: housephone to housephone, or housephone to the App. A relay is used only when two home networks can't reach each other. Audio never goes through a blockchain.

The full design, including what's still provisional on Polkadot's side, is in [docs/polkadot.md](docs/polkadot.md). The voice stack and the alternatives we ruled out are in [docs/calling-stack.md](docs/calling-stack.md).

## Build a phone

Every Homephone is the same small computer inside a telephone you'd want on your hall table: either **a new retro-style phone** or **a real vintage phone**. We keep the handset, hook switch, dial and bell, and replace the phone's own circuit board. It's solder-free where possible: plugs, jumper wires and screw terminals.

Step-by-step setup is in [docs/pi-setup.md](docs/pi-setup.md). The earlier hardware research is in the [hardware doc](https://claude.ai/artifact/A4RnHeqZ5cmp7YKUXtfBv7).

Prices are euros including VAT from Dutch and German shops, checked 18 Nov 2026 where a shop is named. A ~ marks an estimate.

### The core: same in every phone, ~€55

| Part | Job | Where | € |
|---|---|---|---|
| Raspberry Pi Zero 2 WH (header pre-soldered) | The computer | BerryBase (€20.90) or Kiwi | 21 |
| Micro-USB power supply 2.5A, EU plug | Power | Kiwi | 8.50 |
| 32GB microSD card | Holds the OS | ~any shop | ~6 |
| Micro-USB OTG hub | The Zero has one USB port; the sound card and ringer need two | ~Amazon.nl | ~8 |
| Adafruit USB Audio Adapter (#1475) | The handset's earpiece and microphone | Kiwi | 3.60 |
| 2 × 3.5mm plug to screw-terminal adapter | Wires the handset cord to the sound card | ~Amazon.nl | ~8 |
| **Core** | | | **~55** |
| Jumper wires, Wago 221 lever connectors, small screwdrivers | Shared, once | ~Amazon.nl | ~40 |

### Pick a phone

| Phone | What you get | Add to the core |
|---|---|---|
| **A. New retro-style phone** (recommended to start) | A new "vintage" phone, like the classic designs sold by the hundred on Alibaba or in shops. Working parts, consistent between units, easy to buy twice. | **~€20 to ~€60** for the phone, plus a ringer (below) |
| **B. Real vintage phone** | A thrifted 1970s–80s desk phone. The real thing, but every one is different. | **~€25 to ~€60** for the phone, **~€10 to ~€20** for a new microphone, plus a ringer |
| **Bench phone** (for development) | A plain box with a retro handset and a magnet switch, for writing code before cutting into a real phone. | ~€30: box, handset, reed switch |

**Ringer:** either a small USB speaker hidden inside the phone (Adafruit Mini USB Speaker #3369, €20.25 at Opencircuit), or, for a phone with a real bell, a 12V solenoid that strikes it (Adafruit MOSFET driver #5648, solenoid #412, 12V adapter, ~€23). An old bell needs 40–90V AC to ring by itself; tapping it with a solenoid avoids that.

**A homephone costs about €95–€160**, depending on the phone and ringer. Two come to about €230–€360 including the shared tools. Members without a housephone just use the Polkadot App, for €0.

### Choosing a new retro-style phone

They look alike, but check these before buying, and buy **one** to open up first. On Alibaba, minimum orders, shipping and import fees can outweigh the low unit price for a couple of phones. Prices seen at retailers in Nov 2026 were roughly $20–40 for budget models and about $70 for the GPO 746, which has a real rotary dial and bell.

| Check | Why |
|---|---|
| **Not "decorative" or "non-functional"** | Those have no working handset or hook switch inside. |
| **Rotary dial or push buttons?** | Both work. A real rotary dial sends pulses we count on one GPIO pin. Many "rotary" phones hide push buttons behind a dial-shaped plate; those need a keypad wired to several GPIO pins. Dialing isn't built yet (milestone 1 is "lift the handset to ring one home"). |
| **Bell or electronic ringer?** | A mechanical bell takes the solenoid ringer. An electronic buzzer is usually replaced by the USB speaker. |
| **Handset microphone** | Modern phones normally use an electret microphone, which the USB sound card can read directly. Check this on the first unit. Old carbon microphones (phone B) need replacing. |
| **Room inside** | The Pi Zero, hub and sound card need roughly 8 × 5 × 3 cm, plus the power cable through the old line-cord hole. |

### Which Pi?

The Pi Zero 2 W (512MB) is the default. It should be enough for a voice call, but that hasn't been measured yet; milestone 1 will tell. If it's too small, a Pi 4 or Pi 5 drops in (about €20–60 more, and no USB hub needed). Everything else carries over.

## What's in this repo today (milestone 1)

Milestone 1 proves the phone hardware: hook switch, handset audio, ringer, and the Pi Zero. To test that before the Polkadot pieces exist, it uses a **temporary** ringing server and [LiveKit](https://livekit.io) for voice. Both are removed in milestone 2, when ringing moves to Polkadot ([ROADMAP.md](ROADMAP.md)).

* **The phone** (`src/homephone/phone`) is a Python program for 64-bit Raspberry Pi OS Lite. It watches the hook switch on a GPIO pin, rings the ringer, and carries the call on the USB sound card. Lifting the handset rings one household (a hotline), so no dial is needed yet. This program stays. In milestone 2 it gets direct WebRTC and talks to a small Polkadot sidecar.
* **Device identity** (`src/homephone/identity.py`): every phone creates its own Polkadot sr25519 key on first start (`homephone-identity`).
* **The ringing server** (`src/homephone/server`) and **laptop test page** (`src/homephone/web`) are temporary, for testing only.

More detail: [docs/architecture.md](docs/architecture.md).

### Try it on your laptop (no Pi, no accounts)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine on Linux). This runs a local LiveKit server, the ringing server, and a pretend Pi phone whose microphone sends short beeps.

```sh
git clone https://github.com/abutlabs/homephone.git
cd homephone
docker compose up
```

Then open **http://localhost:8080/?key=letmein&household=laptop** and click **Start test phone**.

* **Call the Pi:** click **Call** next to *home*. The mock phone rings; click **Lift handset** under *Phones online*. You hear its beeps, and its *hears* meter moves when you speak.
* **The Pi calls you:** click **Lift handset** while nothing is ringing. After a short dial tone the phone rings your laptop; click **Answer**.
* **Run the tests**, including a real two-phone call through LiveKit: `docker compose --profile test run --rm test`

Stop everything with `docker compose down`. The images are the public build from `ghcr.io/abutlabs/homephone`. If they can't be pulled yet, Docker builds them from this folder.

### With a real Pi

Use LiveKit Cloud's free tier ([docs/livekit-cloud.md](docs/livekit-cloud.md)) or the Docker LiveKit on your laptop, then follow [docs/pi-setup.md](docs/pi-setup.md).

```sh
cp .env.example .env       # fill in LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
python -m venv .venv && . .venv/bin/activate
pip install -e ".[server]"
set -a; . ./.env; set +a
homephone-server run       # prints the link to the laptop test page
```

## Repository

```
src/homephone/
  identity.py        Polkadot device key (create, sign, verify)
  phone/             The Pi program: hook switch, audio, ringer, call state machine
  protocol.py        Messages to the temporary ringing server (milestone 1)
  server/            Temporary ringing server (milestone 1)
  web/               Laptop test phone (milestone 1)
docs/
  polkadot.md        The design: Homephone on Polkadot. Start here
  calling-stack.md   Voice: WebRTC, NAT traversal, why not Jami
  architecture.md    How the milestone 1 code works
  pi-setup.md        Set up a Pi, step by step
  livekit-cloud.md   LiveKit for milestone 1 tests
contracts/           Early contract sketch, likely dropped (see docs/polkadot.md)
deploy/              systemd unit for the Pi, local LiveKit config
tests/               Unit and end-to-end tests
compose.yaml         Laptop test setup
```

## Development

```sh
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest                                        # fast tests, no LiveKit needed
docker compose --profile test run --rm test   # adds the real LiveKit call test
homephone --mock                              # a mock phone in your terminal (Enter lifts/hangs up)
```

## Keys and secrets

* Your Polkadot keys stay in the Polkadot App on your phone. A housephone never sees them; pairing gives it its own limited permission to send ringing messages.
* Each phone's own key is in `~/.config/homephone/device-key.json` (mode 600) and never leaves the device. Only its public address is shared.
* Milestone 1 only: the LiveKit API secret lives in the server's `.env`, which git ignores. The key in `deploy/livekit-dev.yaml` and `compose.yaml` is for the local test LiveKit and is public on purpose. Never expose that setup to the internet.

## License

MIT, see [LICENSE](LICENSE).
