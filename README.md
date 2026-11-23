# Homephone

A homephone for the internet age: a Raspberry Pi that turns a classic telephone into a Polkadot housephone.

The old family landline, but only people you're connected to in the Polkadot App, and have approved, can make it ring. There is no monthly bill: Polkadot carries identity and contacts.

**Status:** testnet only and early. A real Polkadot App call has been answered by the house phone program with two-way audio (on a laptop standing in for the Pi). The phone hardware is being built now. See [ROADMAP.md](ROADMAP.md).

## How it works

```
 Polkadot App (anyone's phone)                         Homephone (classic phone + Pi)
 ┌──────────────────────────┐   normal App call       ┌──────────────────────────────┐
 │ contact: "landline.01"   │────────────────────────►│ Pi: answers as the house     │
 │ (your house's account)   │   signalling: Polkadot  │ FeTAp 611: real bell, dial,  │
 └──────────────────────────┘   voice: direct WebRTC  │ handset                      │
                                                      └──────────────────────────────┘
```

* **Your house has its own Polkadot account**, for example `landline.01`. People add it as a contact and press **Call** in the Polkadot App, like calling a person.
* **The Pi answers as the house.** It speaks the Polkadot App's own chat and call protocol, so the real bell rings and lifting the handset answers.
* **Only the house's contacts can call it.** The App only allows calls between accepted contacts.
* **Voice goes directly between the two ends** (WebRTC). Calls are set up over Polkadot; audio never goes through a blockchain.

Details: [docs/polkadot.md](docs/polkadot.md) (the design), [docs/linked-device-spec.md](docs/linked-device-spec.md) (the App's call protocol), [docs/restore-spec.md](docs/restore-spec.md) (house account keys).

## Build a phone

The phone stays **completely original**. You build a tiny telephone exchange, a "line board", and the phone plugs into it with its normal cord:

```
 FeTAp 611 (untouched) ── phone cord ── [ line board ] ── [ Raspberry Pi ] ── Wi-Fi ── Polkadot
                                         powers the line,   the brain: calls,
                                         rings the bell,    contacts, Polkadot
                                         reads hook & dial
```

**No soldering.** Everything pushes into a breadboard. The Pi and line board fit in a box next to the phone (a cigar box works: at least 18 × 13 × 4.5 cm inside).

## What you need

Prices include VAT unless noted, checked 23 Nov 2026.

### 1. The phone: FeTAp 611

The German Bundespost rotary phone of the 1970s. Every Homephone uses this model, so they're all the same inside ([why](docs/hardware.md#the-phone-fetap-611)).

* **Restored and tested:** [Telefonmanufaktur](https://telefonmanufaktur.de/de/startseite/83-fetap-611-restauriert-designklassiker-in-verschiedenen-farbvarianten.html), €98 + €16.25 shipping. Skip their pulse-to-tone converter.
* **Second-hand:** [Vinted](https://www.vinted.nl/catalog?search_text=fetap%20611) or [Marktplaats](https://www.marktplaats.nl/q/fetap+611/), €20–60. Ask the seller whether **the bell rings** and **both handset capsules** are present. Originals have "Deutsche Bundespost" underneath.
* **A TAE wall socket with screw terminals** (*TAE-F* or *TAE-NFN Aufputzdose mit Schraubklemmen*, ~€4–6 at a hardware store, e.g. Hama). Its terminals 1 and 2 connect to the breadboard. Most second-hand FeTAp 611s have the flat TAE-F plug and fit it directly. If your phone has an **RJ11** cord instead (Telefonmanufaktur's do), add an *RJ11-Buchse auf TAE-F-Stecker* adapter (~€3) and plug it into the same socket. Avoid phones with the old wide pre-TAE plug.

### 2. The Pi

* **Prototype: Raspberry Pi 3 Model B**, second-hand (~€25 on Marktplaats, often with SD card and case).
* **Final: Raspberry Pi Zero 2 W with header.** Sold out across the EU until about Feb–Mar 2027. Then add a USB OTG cable ([DigiKey 1528-1585-ND](https://www.digikey.nl/en/products/detail/adafruit-industries-llc/1099/5875794)) and a 32–64 GB microSD card from a regular shop (not DigiKey: their SD cards cost €50).

### 3. Everything else: one DigiKey order, ~€55 before VAT

Order at **[DigiKey NL](https://www.digikey.nl)** and choose **UPS or FedEx** at checkout so duties are prepaid. Delivery is free from €75 before VAT. You can add the final Pi to the same order (`1, 2648-SC0721-ND`, €15.98, backordered to about March 2027); at checkout, ship in-stock items now and the Pi follows. Paste this into the cart's **Bulk Add** box:

```
1, 5061-AG1171-ND
1, 1951-2742-ND
1, P14394-ND
2, 399-4264-ND
1, 399-9772-ND
1, 399-C322C105K5R5TA7301CT-ND
1, DF04MDI-ND
1, P6KE82ALFCT-ND
1, 3362P-103LF-ND
1, 1528-239-ND
1, 1528-1154-ND
1, 1528-1424-ND
1, 2648-SC0624-ND
1, 1528-1475-ND
2, 1528-2866-ND
```

| Qty | Part | What it does |
|---|---|---|
| 1 | **Silvertel AG1171** | **The exchange on a chip.** Powers the phone line, makes the ~60 V that rings the bell, and tells the Pi when the handset is lifted or the dial turns |
| 1 | Traco TSR 1-2433 regulator | Turns the Pi's 5 V into the clean 3.3 V the AG1171 needs |
| 1 | 470 µF capacitor | A small power reservoir for the bursts the AG1171 draws while ringing |
| 2 | 100 nF capacitor | One smooths the power; one passes the caller's voice from the AG1171 to the mic level knob |
| 1 | 10 nF capacitor | Passes your voice from the Pi into the AG1171 |
| 1 | 1 µF capacitor | Keeps the sound card's mic voltage away from the level knob |
| 1 | DF04M bridge rectifier | Protection: four diodes in one chip that steer any surge on the phone wires into the clamp below |
| 1 | P6KE82A protection diode | The clamp: absorbs anything on the phone wires above 82 V |
| 1 | 10 kΩ trimmer | **The mic level knob**: how loud you sound to the other person. Set once with a screwdriver |
| 1 | Breadboard | Everything pushes into it: no soldering |
| 1 | **Pi T-Cobbler Plus** (assembled) | A ribbon cable that brings all 40 Pi pins onto the breadboard, **labelled** (5V, GND, GPIO17…) |
| 1 | Jumper wires, male-male | Every link on the breadboard, plus the wires to the socket and audio plugs |
| 1 | Official Pi power supply (micro-USB) | Powers the Pi and the line board |
| 1 | USB sound card | Gives the Pi an earpiece output and a microphone input |
| 2 | 3.5 mm plug with screw terminals | Plugs into the sound card; a jumper wire screws into each terminal |

### 4. Tools

A **multimeter** and a **small screwdriver**. Nothing needs stripping or soldering.

## Wire the line board

Unplug the Pi's power whenever you add or move parts. Do one step at a time, and do the check before going on.

**The breadboard:** the long numbered **columns** (1–63) each connect the 5 holes in their half (rows a–e, or f–j). The **rails** along the top and bottom edges connect along their whole length: we use **+ for 3.3 V** and **− for ground**.

**The Pi connects through the T-Cobbler.** Push the T-Cobbler into the **left end** of the breadboard, straddling the middle channel (it takes about columns 1–22). Connect its ribbon cable to the Pi's 40-pin header with the cable's **coloured stripe at pin 1**, the corner of the header nearest the SD card. Every Pi pin now has a **labelled column** on the breadboard: **5V, GND, GPIO17, GPIO27, GPIO22**. The steps below say "the 5V column" and so on.

If a rail's red or blue line has a **gap in the middle** of the board, the two halves aren't connected: bridge each gap with a short jumper.

**The whole circuit:**

```
 Pi 5V ──► [TSR 1-2433] ──► 3.3 V rail ─────────────┬─────────┬──► AG1171 pin 13 (+V)
           (pin 2 = GND)                             470µF+   100nF
                                                     │         │
 Pi GND ─────────────────── ground rail ─────────────┴─────────┴──► AG1171 pin 12 (GND)

 Pi GPIO17 ◄── AG1171 pin 5 (SHK)     Pi GPIO27 ──► pin 4 (RM)     Pi GPIO22 ──► pin 3 (F/R)

 sound card HEADPHONE (tip) ──[10nF]──► AG1171 pin 9 (VIN)          plug sleeves ──► ground
 sound card MIC (tip) ◄──[1µF]── trimmer middle  ┤ trimmer ├ one end ◄──[100nF]── AG1171 pin 10 (VOUT)
                                                           other end ──► ground

 phone socket a ◄── AG1171 pin 2 (TIP)     phone socket b ◄── AG1171 pin 1 (RING)
 AG1171 pins 6, 7, 8, 11 and 14: leave empty.
```

### Step 1: power

1. **Regulator:** push the TSR 1-2433 into **c26, c27, c28**, printed side facing you (pin 1 = input on the left, pin 2 = ground, pin 3 = 3.3 V out).
2. **Jumpers:** **a27 → top − rail**; **a28 → top + rail**.
3. **Link the rails:** top + to bottom +, and top − to bottom −, at the right end.
4. **From the T-Cobbler:** the **5V column → b26**; a **GND column → top − rail**.

**Check:** power the Pi. The multimeter between **top + and top −** reads **3.2–3.4 V**. Unplug again.

### Step 2: the AG1171

1. Push the AG1171 into **row j**, pin 1 at **column 30**, its pins pointing down into the board. Each pin gets its own column; there's a gap with no pins, which is normal. **Write each pin's column on a strip of masking tape** below the board. The steps below say "the pin 13 column" and so on.
2. **Pin 13 column → bottom + rail** (male-male jumper). **Pin 12 column → bottom − rail.**
3. **470 µF:** long leg (+) in the **pin 13 column**, short leg (stripe, −) in the **bottom − rail**. The stripe side must go to −.
4. **100 nF:** one leg in the **pin 13 column**, the other in the **bottom − rail**.
5. Leave **pin 14** (PD) and pins 6, 7, 8, 11 **empty**.

**Check:** power the Pi. Still 3.2–3.4 V on the rails, and nothing gets warm. Unplug.

### Step 3: Pi control and the phone

1. **Jumpers from the T-Cobbler:** the **GPIO17 column → pin 5 (SHK) column**; **GPIO27 → pin 4 (RM) column**; **GPIO22 → pin 3 (F/R) column**.
2. **Phone line:** a jumper from the **pin 2 column (TIP)** and one from the **pin 1 column (RING)** to the two line terminals of the phone socket: **a and b**, or on a TAE socket terminals **1 and 2**. Plug in the phone.

**Check, on the Pi:**

```sh
python3 scripts/linetest.py hook    # lift → "lifted", replace → "on hook"
python3 scripts/linetest.py ring    # the real bell rings 3 times; lift the handset to stop it
python3 scripts/linetest.py dial    # lift, dial 4 → "digit 4"
```

### Step 4: audio

1. **Find the terminals:** each 3.5 mm plug has three screw terminals. With the multimeter's beep mode, find which terminal connects to the plug's **tip** (the very end of the plug) and which to its **sleeve** (the long part nearest the body). The third (ring) stays empty.
2. **Your voice to the phone (headphone):** screw a male-male jumper into plug 1's **tip** terminal and push its other end into **column 40, top half**. Put the **10 nF** between **column 40** and **column 42**. Jumper **column 42 → the pin 9 (VIN) column**. Jumper plug 1's **sleeve** terminal to the **top − rail**. Plug it into the sound card's **headphone** jack (green).
3. **The caller's voice to the Pi (mic):** jumper the **pin 10 (VOUT) column → column 46, top half**. Put the **100 nF** between **column 46** and **column 48**. Push the **trimmer** into **columns 48, 49, 50**, middle leg in 49. Jumper **column 50 → top − rail**. Put the **1 µF** between **column 49** and **column 53**. Jumper plug 2's **tip** terminal to **column 53** and its **sleeve** terminal to the **top − rail**. Plug it into the sound card's **mic** jack (pink).

**Check, on the Pi:**

```sh
aplay -l                                            # note the USB sound card's number, e.g. card 1
speaker-test -D plughw:1 -c 1 -t sine -f 440 -l 1   # lift the handset: you hear a tone
arecord -D plughw:1 -f S16_LE -r 48000 -d 5 test.wav && aplay -D plughw:1 test.wav
                                                    # speak into the handset, then hear it played back
```

If your voice is too quiet or distorted, turn the **trimmer** a little with the screwdriver and try again. `alsamixer` also sets the sound card's levels.

### Step 5: protection

Add this before regular use. It protects the AG1171 from static and spikes on the phone wires (datasheet Figure 4: a diode bridge and an 82 V clamp).

1. Push the **DF04M** across the middle channel at **columns 56 and 58**, like a chip: two legs in row e, two in row f. Its top is printed **~ ~ + −**: note which column each sign is in.
2. Jumper one **~** column → the **pin 2 (TIP) column**, and the other **~** column → the **pin 1 (RING) column**. Either way round works.
3. Jumper the **−** column → a **− rail**.
4. **P6KE82A:** its **striped end** in the **+** column, the plain end in a **− rail**. The stripe matters.

**Check:** the hook, ring, dial and audio tests above still work.

**Safety:** while ringing, the phone wires carry about 60 V AC: low current, but it stings. Don't touch the pin 1 and 2 columns or the socket while it rings, and **never connect the line board to a real phone line**.

## Software

The Pi runs two programs that talk over a pipe:

* **`homephone-dot`** (`packages/linked-device`, Node 22+) is the Polkadot side. It pairs with the house account, receives App calls and sends answers.
* **The phone program** (`src/homephone/phone`, Python) is the hardware side: the bell, hook, dial and handset audio, plus WebRTC voice with aiortc.

Pairing, the house account and running it are in [docs/linked-device-spec.md](docs/linked-device-spec.md) and `packages/linked-device/bin/`. The older milestone-1 test setup (a temporary server and LiveKit, for testing hardware without Polkadot) is described in [docs/architecture.md](docs/architecture.md).

## Development

```sh
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest                          # Python tests, incl. a call against headless Chrome if installed
npm install && npm test         # Node tests (Node 22.18+)
```

## Repository

```
packages/linked-device/   The Pi's Polkadot side: pairing, chat, call setup (TypeScript)
packages/protocol/        Our own call protocol (fallback route)
packages/product/         The homephone.dot page
src/homephone/phone/      The phone program: hook, ringer, audio, WebRTC
scripts/linetest.py       Line-board tests (hook, ring, dial)
docs/                     Design, hardware, Polkadot notes
```

## Keys and secrets

Everything secret lives in `.secrets/`, which git ignores: the house account's recovery phrase, the Pi's pairing keys and the `homephone.dot` owner key. Back them up offline; never commit them.

## License

MIT, see [LICENSE](LICENSE).
