# Homephone

A homephone for the internet age: a Raspberry Pi that turns a classic telephone into a Polkadot housephone and rings the whole household.

Call a household, not a person. Your family rings your home from the Polkadot App on their phones, every phone in the house rings at once, and whoever is nearest picks up, just like the old family landline. Only people you're connected to in the Polkadot App, and have approved, can make it ring. There is no phone network and no Homephone server in the call: Polkadot carries identity, contacts and ringing, and the voice goes directly between the two ends.

**Status:** testnet only and early. The design is set (below and in [docs/polkadot.md](docs/polkadot.md)). The code in this repo today is the milestone 1 hardware harness, which proves the phone hardware with a temporary server. See [ROADMAP.md](ROADMAP.md).

## How it works

```
  Polkadot App (your phone)                              Homephone (classic phone + Pi)
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
* **The housephone extends your Polkadot account.** A classic phone plugged into a Homephone box pairs with your Polkadot App once, then rings and answers on its own.
* **Ringing goes over Polkadot.** Ring, answer and hang-up are small signed and encrypted messages on Polkadot's Statement Store.
* **Only approved contacts can ring your home.** You invite a Polkadot App contact with a link sent in the App chat, they join, and you approve them. Every phone in the house ignores anyone else. [How it works](docs/polkadot.md#who-can-ring-your-home).
* **Voice goes directly between the two ends** over WebRTC: housephone to housephone, or housephone to the App. A relay is used only when two home networks can't reach each other. Audio never goes through a blockchain.

The full design, including what's still provisional on Polkadot's side, is in [docs/polkadot.md](docs/polkadot.md). The voice stack and the alternatives we ruled out are in [docs/calling-stack.md](docs/calling-stack.md).

## Build a phone

A Homephone is a small box that acts as **the telephone exchange for one ordinary phone**. You plug a classic landline phone into it by its normal cord, unmodified, and its own bell, dial and handset work just as they did on a real line:

```
  classic phone ── phone cord ── [ line board (AG1171) ] ── [ Raspberry Pi Zero 2 W ] ── internet / Polkadot
  (unchanged)                    makes the line power and     the brain: Polkadot,
                                 the ~60V that rings the       contacts, calls
                                 bell; reads hook and dial
```

The line board is a few parts on a small prototype board, so **this build needs some soldering**. Why this design, the wiring, and the rules from the datasheet are in **[docs/hardware.md](docs/hardware.md)**. Pi setup is in [docs/pi-setup.md](docs/pi-setup.md).

Prices are euros including VAT, checked **19 Nov 2026**. A ~ marks an estimate. **Stock is tight:** the Pi Zero 2 WH and the AG1171 were both out of stock at most EU shops that day.

### 1. The brain, ~€48

| Part | Job | Where | € |
|---|---|---|---|
| Raspberry Pi Zero 2 WH (header pre-soldered) | The computer | [Kiwi](https://www.kiwi-electronics.com/en/raspberry-pi-zero-2-w-with-header-20130) (21.16, out of stock) · [BerryBase](https://www.berrybase.de/en/raspberry-pi-zero-2-wh) (20.90, out of stock) | 21 |
| Official Raspberry Pi micro-USB power supply, 5.1V 2.5A, EU plug | Power for everything | [Kiwi](https://www.kiwi-electronics.com/en/raspberry-pi-psu-5-1v-2-5a-microusb-eu-plug-10809) | 8.46 |
| 32GB microSD card | Holds the OS | ~any shop | ~6 |
| Adafruit USB Audio Adapter (#1475) | Voice in and out of the line board | [Opencircuit](https://opencircuit.shop/product/usb-audio-adapter-works-with-raspberry-pi) (9.75, 10–12 days) · [Kiwi](https://www.kiwi-electronics.com/en/usb-audio-adapter-works-with-raspberry-pi-2244) (3.62, back 25 Nov) | 4–10 |
| Micro-USB OTG adapter (micro-USB to USB-A) | The Zero's one USB port to the sound card | ~any shop | ~3 |

### 2. The line board, ~€25

| Part | Job | Where | € |
|---|---|---|---|
| **Silvertel AG1171-S** (or AG1171) | The line interface: line power, ring voltage, hook and dial detection, audio | [Braemac/Symmetry](https://americas.braemac.com/products/silvertel/ag1171s/) ($8.50, 408 in stock, US: add shipping and import VAT) · [Mouser NL](https://nl.mouser.com/ProductDetail/Silvertel/Ag1171S) (7.33, expected 9 Dec) · [Farnell NL](https://nl.farnell.com/en-NL/silvertel/ag1171-s/ringing-slic-low-power-70deg-c/dp/4472677) (8.36 ex VAT, 20 weeks) · plain AG1171 at [DigiKey NL](https://www.digikey.nl/en/products/detail/silvertel/AG1171/21187236) (9.14, 60 due 23 Nov) | ~9 |
| 3.3V 1A switching regulator, 7805-style (Traco TSR 1-2433 or Recom R-78E3.3-1.0) | Clean power for the AG1171 | [Bürklin](https://www.buerklin.com/en/p/traco-power/dc-dc-converters/tsr-1-2433/26K2076) (5.93 ex VAT; check stock) | ~7 |
| Capacitors (470µF 16V, 2 × 100nF, 2 × 10nF, 2 × 1µF), 4 × 1N4004, 1 × BZT03C82 or P6KE82, 10k trimmer | Supply, protection, audio | ~Reichelt / TinyTronics | ~5 |
| RJ11 PCB jack (SparkFun PRT-00132) + breakout (BOB-14021) | Where the phone plugs in | [Kiwi jack](https://www.kiwi-electronics.com/en/rj11-6-pin-connector-2926) (2.11) · [Kiwi breakout](https://www.kiwi-electronics.com/en/sparkfun-rj11-breakout-2925) (3.38) | 5.49 |
| 5 × 7 cm prototype board | Holds it all | [TinyTronics](https://www.tinytronics.nl/en/tools-and-mounting/prototyping-supplies/experiment-pcbs/experiment-pcb-5cm*7cm-lanes-and-islands) | 0.65 |

**Two AG1171 parts exist:** AG1171 and AG1171-S. Silvertel's own link points to the AG1171-S, and [The Phone Friend](https://hackaday.io/project/190181-the-phone-friend) used it. Check the pinout of the part you receive against its datasheet before soldering. Never connect the line board to an outside phone line.

### 3. The phone

**Rule: use phones that others have already taken apart and written up**, so we inherit their fixes ([docs/hardware.md](docs/hardware.md#choosing-the-phone)).

| Phone | Why | Where | € |
|---|---|---|---|
| **Original Post Office 746, refurbished** (recommended) | The best-documented phone in Europe: circuit diagrams, conversions and hacker builds. Real rotary dial and bell. Needs a capacitor for the UK "bell wire" to ring on two wires (documented) | [GPO Spares](https://gpospares.co.uk) (UK refurbisher, original moulds) · [eBay.de](https://www.ebay.de/itm/287214345719) (~35–92) · UK dealers (£79–150). From the UK, add import VAT | ~40–90 |
| Western Electric 500 | The most-hacked phone anywhere, and rings on two wires as is. For family in the US | US sellers | — |
| GPO Retro 746 (new replica) | New and in 10 colours, but nobody has documented its insides yet. Try one before standardising | [Amazon.nl](https://www.amazon.nl/dp/B008MV7O8K) (53.28) · [bol.com](https://www.bol.com/nl/nl/p/gpo-746rotarybla-telefoon-retro-jaren-70-draaischijf-zwart/9200000047496663/) (65.95–73.95) | 53–74 |

### What it costs

| | € |
|---|---|
| Brain + line board | **~€73** |
| Plus a refurbished 746 | **~€115–165 per Homephone** |
| Shared, once: [jumper wires](https://www.kiwi-electronics.com/en/premium-jumperwires-ribbon-40-wires-f-f-20cm-590) (3.01), soldering iron, solder, multimeter | ~€40–70 |

Family members without a housephone use the Polkadot App, for €0.

### The bench phone (milestone 1)

The parts already ordered for milestone 1 (a handset, a magnet switch and a USB speaker in a plain box) stay useful for writing and testing the phone software before the line board exists.

### Which Pi?

The Pi Zero 2 W (512MB) is the default. It should be enough for a voice call, but that hasn't been measured yet; milestone 1 will tell. If it's too small, a Pi 4 or Pi 5 drops in (about €20–60 more). Everything else carries over.

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
