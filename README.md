# Homephone

A landline for the internet age: a Raspberry Pi home phone that rings the whole household, built on WebRTC and Polkadot.

Call a household, not a person. Every phone in that home rings at once, and whoever is nearest picks up, just like the old family landline. Households join a family group. Each member's housephone or smartphone app can ring any other household in the group. There is no phone network involved: calls go over the internet with WebRTC (through [LiveKit](https://livekit.io)), and each device has its own Polkadot account.

**Status:** milestone 1, one Pi phone calls a laptop. See [ROADMAP.md](ROADMAP.md) for the milestones and the plan after that.

## How it works

```
  Pi phone                     Ringing server                   Laptop / app
  (handset, hook, ringer)      (this repo, FastAPI)             (browser page)
        |                               |                              |
        |-- hello, signed with -------->|<------- hello (test key) ----|
        |   its Polkadot key            |                              |
        |-- lift handset: "call laptop"->|-- ring every device in ---->|
        |                               |   the "laptop" household     |
        |<-- "answered" ----------------|<------- "answer" ------------|
        |                                                              |
        |<============ voice: WebRTC through LiveKit =================>|
```

* **The phone** (`src/homephone/phone`) is a Python program for 64-bit Raspberry Pi OS Lite. It watches a hook switch on a GPIO pin, plays a bell on a USB speaker, and carries the call on a USB sound card wired to a handset. In milestone 1, lifting the handset rings one household (a hotline), so no keypad is needed.
* **The ringing server** (`src/homephone/server`) knows which device belongs to which household, rings all of a household's devices at once, stops the others when one answers, and hands out LiveKit tokens. The LiveKit secret stays on the server.
* **The laptop test phone** (`src/homephone/web`) is a single web page served by the ringing server. It can call and answer, and it can lift and hang up mock phones.
* **Polkadot**: every device creates an sr25519 account on first start (`homephone-identity`) and signs in with it. The goal is a Polkadot housephone: family members call it from the Polkadot App. Start with [docs/polkadot.md](docs/polkadot.md) and [ROADMAP.md](ROADMAP.md).

More detail: [docs/architecture.md](docs/architecture.md).

## Try it on your laptop (no Pi, no accounts)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine on Linux). This runs a local LiveKit server, the ringing server, and a pretend Pi phone whose microphone sends short beeps.

```sh
git clone https://github.com/abutlabs/homephone.git
cd homephone
docker compose up
```

Then open **http://localhost:8080/?key=letmein&household=laptop** and click **Start test phone**.

* **Call the Pi:** click **Call** next to *home*. The mock phone rings; click **Lift handset** under *Phones online*. You hear its beeps, and its *hears* meter moves when you speak.
* **The Pi calls you:** click **Lift handset** while nothing is ringing. After a short dial tone the phone rings your laptop; click **Answer**.
* **Run the tests**, including a real two-phone call through LiveKit:

  ```sh
  docker compose --profile test run --rm test
  ```

Stop everything with `docker compose down`. The images are the public build from `ghcr.io/abutlabs/homephone`. If they can't be pulled yet, Docker builds them from this folder.

## Build a phone

Everything is solder-free: plugs, jumper wires and screw terminals. The full research, with wiring and sources, is in the [hardware doc](https://claude.ai/artifact/A4RnHeqZ5cmp7YKUXtfBv7). Step-by-step setup is in [docs/pi-setup.md](docs/pi-setup.md).

Prices are euros including VAT from Dutch and German shops, checked 18 Nov 2026 where a shop is named. A ~ marks a typical price, not a checked one.

### Pick a build

| Build | What it is | Per phone |
|---|---|---|
| **A. Lean phone** (recommended) | Pi Zero 2 WH in a plain box. Lift the handset to ring one household. | **~€97** |
| **B. Dev phone** | Pi 4 or Pi 5: more memory, 4 USB ports, easier to develop on. Optional screw-terminal HAT and keypad. | **~€110 to ~€180** |
| **C. Vintage phone** (later) | Build A or B moved into a thrifted 1970s–80s desk phone, with a real bell. | **A or B, plus ~€15 to ~€85** |
| **App only** | Family members without a housephone use the Polkadot App, with Homephone as a Product inside it. | **€0** |

Two lean phones come to about **€240**, including ~€40 of shared wire, connectors and small tools.

### A. Lean phone, ~€97

| Part | Job | Where | € |
|---|---|---|---|
| Raspberry Pi Zero 2 WH (header pre-soldered) | The computer | BerryBase (€20.90) or Kiwi (restock 24 Nov, max 2 each) | 21 |
| Micro-USB power supply 2.5A, EU plug | Power | Kiwi | 8.50 |
| 32GB microSD card | Holds the OS | ~any shop | ~6 |
| Micro-USB OTG hub | The Zero has one USB port; the sound card and ringer need two | ~Amazon.nl | ~8 |
| Adafruit USB Audio Adapter (#1475) | Handset earpiece and microphone | Kiwi (back 25 Nov) | 3.60 |
| Retro handset with 3.5mm plug | The part you hold | ~Amazon.nl | ~20 |
| Adafruit Mini USB Speaker (#3369) | Ringer | Opencircuit | 20.25 |
| Magnetic door contact (reed switch) | Hook switch | ~Amazon.nl, 10-pack | ~2 |
| ABS project box, ~150 × 100 × 60 mm | Enclosure | ~any electronics shop | ~8 |
| **Per phone** | | | **~97** |
| Jumper wires, Wago 221 lever connectors, small screwdrivers | Shared, once | ~Amazon.nl | ~40 |

To save ~€10 a phone, use any USB-powered mini speaker as the ringer. Order one handset first and check how it sounds before buying more.

### B. Dev phone, ~€110 to ~€180

Same as A, with these swaps. Pi 4 and Pi 5 prices are approximate EU prices after the 2026 increases.

| Swap | € |
|---|---|
| Pi Zero 2 WH → **Pi 4 (1GB)** ~€40, or **Pi 5 (1GB)** ~€50, or **Pi 5 (2GB)** ~€80 | +19 to +59 |
| Micro-USB supply → official USB-C supply (Pi 5 needs the 27W one) | ~+4 |
| No USB hub needed (4 USB ports) | −8 |
| Optional: Adafruit Pi-EzConnect screw-terminal HAT (#2711) | ~+20 |
| Optional: 3×4 phone keypad (#1824) | ~+9 |

A Pi 4 (1GB) without extras is about **€110**. A Pi 5 (2GB) with the HAT and keypad is about **€180**. Choose this if the Zero turns out too small, or for the phone you develop on.

### C. Vintage phone, later

Start from build A or B and drop the box and the retro handset. Add:

| Part | Job | ~€ |
|---|---|---|
| Used rotary or push-button desk phone | Shell, handset, hook contacts, dial, bell | 25–60 |
| Electret or dynamic microphone insert | Replaces the old carbon mic, which a sound card can't read | 10–20 |
| 2 × 3.5mm plug to screw-terminal adapter | Handset cord to the sound card | ~8 |
| *Real bell (optional):* Adafruit MOSFET driver (#5648), 12V solenoid (#412), 12V adapter with screw-terminal jack, JST cable | Taps the phone's own bell gong | ~23 |

That is ~€45 to ~€110 of parts, minus the ~€28 box and handset you no longer need. The phone's original bell needs 40–90V AC; tapping it with a 12V solenoid avoids that. Vintage prices are estimates converted from USD.

### Which Pi?

The Zero 2 W (512MB) is the default and should be enough for a voice call, but this hasn't been measured yet; milestone 1 will tell. If it's too small, only the Pi, its power supply and the hub change. Everything else carries over.

## Run it for real (LiveKit Cloud)

For a Pi on your network, or calls between homes, use LiveKit Cloud's free tier (about 5,000 participant-minutes a month). Set it up with [docs/livekit-cloud.md](docs/livekit-cloud.md), then:

```sh
cp .env.example .env       # fill in LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
python -m venv .venv && . .venv/bin/activate
pip install -e ".[server]"
set -a; . ./.env; set +a
homephone-server run      # prints the link to the laptop test page
```

On the Pi, follow [docs/pi-setup.md](docs/pi-setup.md).

## Repository

```
src/homephone/
  identity.py        Polkadot device account (create, sign, verify)
  protocol.py        Messages between devices and the server
  phone/             The Pi program: hook switch, audio, ringer, LiveKit, state machine
  server/            Ringing server: households, tokens, call routing
  web/               Laptop test phone (HTML + JS)
contracts/           Early contract sketch, likely dropped (see docs/polkadot.md)
deploy/              systemd unit for the Pi, local LiveKit config
docs/                Pi setup, LiveKit Cloud, architecture
tests/               Unit and end-to-end tests
compose.yaml         Laptop test setup
```

## Development

```sh
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest                                   # fast tests, no LiveKit needed
docker compose --profile test run --rm test   # adds the real LiveKit call test
homephone --mock                  # a mock phone in your terminal (Enter lifts/hangs up)
```

## Secrets

* The LiveKit API secret lives only in the server's `.env`, which git ignores. Phones and browsers get short-lived tokens for one call room.
* Each device's Polkadot secret phrase is in `~/.config/homephone/device-key.json` (mode 600) and never leaves the device. Only the public address is shared.
* The key in `deploy/livekit-dev.yaml` and `compose.yaml` is for the local test LiveKit only and is public on purpose. Never expose that setup to the internet.

## License

MIT, see [LICENSE](LICENSE).
