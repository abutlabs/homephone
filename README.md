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

## What you need

Two orders per Homephone: **the phone** and **the electronics kit**. Prices include VAT, checked 19 Nov 2026.

### 1. The phone: a restored FeTAp 611, €98

The German Bundespost rotary phone of the 1970s: real bell, original rotary dial. We use only this model, so every phone is the same inside ([why](docs/hardware.md#the-phone-fetap-611)).

* **Standard supplier:** [Telefonmanufaktur](https://telefonmanufaktur.de/de/startseite/83-fetap-611-restauriert-designklassiker-in-verschiedenen-farbvarianten.html) (Germany). Restored and tested, new RJ11 cord, 5 colours. €98 + [€16.25 shipping to NL](https://telefonmanufaktur.de/de/content/8-zahlung-und-versand). An EU shop, so no import tax. **Skip their pulse-to-tone converter**; we don't need it.
* **Cheaper, second-hand:** [Vinted.nl](https://www.vinted.nl/catalog?search_text=fetap%20611) or [Marktplaats](https://www.marktplaats.nl/q/fetap+611/), often €20–50. Usually untested, so the bell or microphone may need work ([restoration guide](https://www.kahlhans.de/telefonseite/galerie/fetap-611/aufbereitung-fetap-611/)).

### 2. The electronics kit: one order at DigiKey, ~€102

Everything below is in **one order at [DigiKey NL](https://www.digikey.nl)**. At checkout choose **UPS or FedEx**: duties and VAT are prepaid, so nothing is due at the door. (With DHL you pay import VAT on delivery.) Shipping is free over €75 before VAT.

| Qty | Part | DigiKey part | € each |
|---|---|---|---|
| 1 | Raspberry Pi Zero 2 WH (header pre-soldered) | [SC0721](https://www.digikey.nl/en/products/detail/raspberry-pi/SC0721/24627135) | 19.34 |
| 1 | Official Raspberry Pi micro-USB power supply, EU plug (100–240V: works in the US with a plug adapter) | [SC0624](https://www.digikey.nl/en/products/detail/raspberry-pi/SC0624/15298145) | 8.59 |
| 1 | 32GB microSD card (skip it if you have one) | [MIKROE-5172](https://www.digikey.nl/en/products/detail/mikroelektronika/MIKROE-5172/16528243) | 32.11 |
| 1 | Adafruit USB Audio Adapter | [1475](https://www.digikey.nl/en/products/detail/adafruit-industries-llc/1475/7244940) | 5.31 |
| 1 | Micro-USB OTG cable | [Adafruit 1099](https://www.digikey.nl/en/products/detail/adafruit-industries-llc/1099/5875794) | 2.69 |
| 1 | **Silvertel AG1171** line interface | [AG1171](https://www.digikey.nl/en/products/detail/silvertel/AG1171/21187236) | 9.14 |
| 1 | 3.3V 1A regulator | [Traco TSR 1-2433](https://www.digikey.nl/en/products/detail/traco-power/TSR-1-2433/9383776) | 6.74 |
| 1 | 470µF 16V capacitor | [EEU-FR1C471](https://www.digikey.nl/en/products/detail/panasonic-industry/EEU-FR1C471/2433528) | 0.76 |
| 2 | 100nF capacitor | [C320C104K5R5TA](https://www.digikey.nl/en/products/detail/kemet/C320C104K5R5TA/818040) | 1.60 |
| 2 | 10nF capacitor | [C320C103K5R5TA](https://www.digikey.nl/en/products/detail/kemet/C320C103K5R5TA/3726059) | 0.53 |
| 2 | 1µF capacitor | [C322C105K5R5TA7301](https://www.digikey.nl/en/products/detail/kemet/C322C105K5R5TA7301/18117082) | 1.97 |
| 4 | 1N4004 diode | [1N4004G](https://www.digikey.nl/en/products/detail/onsemi/1N4004G/1485474) | 0.28 |
| 1 | 82V protection diode | [P6KE82A](https://www.digikey.nl/en/products/detail/littelfuse-inc/P6KE82A/688097) | 0.81 |
| 1 | 10k trimmer | [3362P-1-103LF](https://www.digikey.nl/en/products/result?keywords=3362P-1-103LF) | 1.49 |
| 1 | RJ11 jack (the phone plugs in here) | [MTJ-642BX2](https://www.digikey.nl/en/products/detail/adam-tech/MTJ-642BX2/9832240) | 0.39 |
| 1 | Prototype board 70 × 50 mm | [Adafruit 4786](https://www.digikey.nl/en/products/detail/adafruit-industries-llc/4786/13617527) | 3.17 |
| 1 | Jumper wires (one pack is enough for several phones) | [Adafruit 1950](https://www.digikey.nl/en/products/detail/adafruit-industries-llc/1950/6827084) | 2.09 |

**Stock (19 Nov 2026):** the **Pi Zero 2 WH is out of stock everywhere**; DigiKey expects 420 on 1 Mar 2027. The **AG1171** arrives at DigiKey on 23 Nov (60 units). Everything else is in stock. DigiKey ships what's in stock first and backorders the rest. If the Pi turns up sooner elsewhere (for example [Kiwi](https://www.kiwi-electronics.com/en/search?search=raspberry+pi+zero+2)), buy it there and leave it out of this order.

### 3. Tools, once

A soldering iron, solder and a multimeter. The line board needs about 20 solder joints. Never connect it to an outside phone line.

### What it costs

| | € |
|---|---|
| Restored FeTAp 611, shipped | ~114 |
| Electronics kit | ~102 |
| **One Homephone** | **~€215** |
| With a second-hand phone and your own SD card | ~€100–125 |

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
