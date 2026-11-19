# Hardware

Decided 19 Nov 2026. **Homephone is the telephone exchange for one ordinary phone.** The phone stays unmodified: you plug its normal cord into Homephone, and its own bell, dial and handset work exactly as they did on a real line.

```
  any landline phone ── phone cord ── [ AG1171 line board ] ── [ Raspberry Pi Zero 2 W ] ── internet / Polkadot
  (unchanged: bell,                    the electrical part      the brain: ringing over
   dial, handset)                      of an exchange           Polkadot, WebRTC voice,
                                                                contacts
```

* **The AG1171 line board** does what the wall socket and the exchange used to do. It puts line power on the phone cord, makes the ~60V that rings the bell, tells the Pi "handset lifted" and "dialled 3", and passes the voice audio both ways.
* **The Raspberry Pi** does everything else: Polkadot, contacts and calls ([polkadot.md](polkadot.md)).

## Why not rewire the phone?

We first planned to open each phone and wire its handset, hook switch, dial and bell straight to the Pi. A build that did exactly that, a German FeTAp 611 turned into a Bluetooth handset ([hackaday.io project 165208](https://hackaday.io/project/165208-an-old-rotary-phone-as-bluetooth-set)), shows the problems:

| What happened when they rewired a phone | Why it matters |
|---|---|
| The bell needs at least 30V AC at 20–25 Hz. They bought a separate $25 ring-generator module, needed a 5V-to-12V step-up and "high valued capacitors" for current peaks, and drove its 12V control input from a 3.3V Pi pin ("somehow I managed to make it work") | Out-of-spec wiring and a pile of extra modules, all for the bell |
| The microphone and earpiece were shorted together by the phone's own circuit; they had to **cut a track** and find the handset wires by trial and error | The fix is different for every model, so it isn't repeatable |
| They kept the carbon microphone, which needs line current to work properly, and accepted poor sound | Carbon microphones can't be read properly by a sound card |
| The hook switch read backwards, and the dial was debounced at 90 ms | Every phone needs its own settings, and 90 ms is too close to the ~100 ms dial pulse to be reliable |

**A line interface (SLIC) avoids all of this.** The phone's own circuit does its job, the bell gets real ringing voltage, carbon microphones get line current, and the Pi only sees clean signals. It's how [Blue POT](https://github.com/danjulio/blue_pot) (unmodified phones to Bluetooth, Teensy) and [The Phone Friend](https://hackaday.io/project/190181-the-phone-friend) (Raspberry Pi Pico W) work, both with the AG1171.

| | Rewire the phone | **Line board (chosen)** |
|---|---|---|
| The phone | Opened, circuit bypassed, wired per model | **Unchanged**; plugs in by its cord |
| Bell | Separate ring generator, marginal at low voltage | **Real ~60V ringing** from the AG1171 |
| Microphone | Electret only; carbon mics sound poor | **Any**, including carbon |
| Dial | Rotary only, wired per model | **Rotary** (pulses on one pin) **and push-button** (tones decoded in software) |
| Works with | One model at a time | **Any analog landline phone** |
| Cost | Solder-free modules | A small board with a few parts and some soldering |

## The AG1171

The [Silvertel AG1171](https://www.silvertel.com/telecom/271-ag1171.html) ([datasheet](https://static.chipdip.ru/lib/300/DOC029300244.pdf)) is a 14-pin SLIC module with its own DC/DC converter and ring generator. It runs from one supply of **3.1–5.5V** and generates the **48V line feed** and **72V for ringing** (about 60Vrms into one phone). It's meant for "on-premise" use: one phone on a short cord, never an outside phone line. **AG1171 and AG1171-S are different parts; check which you order.**

| Pin | Name | Connect to |
|---|---|---|
| 1 | RING | Phone jack, ring (one of the middle two RJ11 pins) |
| 2 | TIP | Phone jack, tip (the other middle pin) |
| 3 | F/R | Pi GPIO 22 (output). Toggled at 20–25 Hz while ringing; held high otherwise |
| 4 | RM | Pi GPIO 27 (output). High only while ringing |
| 5 | SHK | Pi GPIO 17 (input). High = handset lifted; pulses while a rotary digit is dialled. Internal 3.3k pull-up |
| 9 | VIN | Sound card **headphone out** (left), through a 1µF capacitor |
| 10 | VOUT | Sound card **mic in**, through a 1µF capacitor and a 10k trimmer to set the level |
| 12 | GND | Ground (shared with the Pi) |
| 13 | +V | **3.3V from its own regulator** (see below), with 470µF + 100nF to ground |
| 14 | PD | **Leave unconnected.** Never drive it high; it can damage the module |
| 6–8, 11 | NC | Not connected |

### Rules from the datasheet

* **Run it at 3.3V.** At 3.3V its logic matches the Pi's pins: inputs need ≥2.0V and SHK outputs 2.8V. At 5V, SHK outputs 4.5V, which would damage a Pi pin, and the Pi's 3.3V outputs are below its 3.5V input threshold.
* **Give it its own 3.3V regulator.** It draws 70–105 mA idle, up to 450 mA with the handset lifted and up to 500 mA while ringing, at 3.3V. That's more than the Pi's 3.3V pin should supply, and the datasheet stresses a clean supply (absolute maximum 7V). Blue POT uses a separate 3.3V switching regulator with 470µF. Its builder also found the inrush current trips small fuses.
* **Protection is not optional.** Use at minimum the datasheet's circuit: four 1N4004 diodes steering tip and ring into an **82V clamp diode (BZT03C82 or P6KE82)**, and 10nF from tip and ring to ground. Blue POT: "Do not omit including the protection circuitry … as the AG1171 can be damaged." Never connect it to an outside phone line.
* **Ringing:** set RM high, toggle F/R at 20–25 Hz in the ring cadence, then hold F/R high and drop RM. **RM may be high at most 33% of the time** (absolute maximum). The Dutch cadence of 1 s ringing, 4 s silence is 20%.
* **Answering while ringing ("ring trip"):** SHK pulses when the handset is lifted mid-ring. Debounce it for 10 ms, then set F/R high, and drop RM between 10 and 500 ms later.
* **Dialling:** rotary digits arrive as SHK pulses (about 10 per second). Debounce each edge for ~10 ms and count pulses until a ~200 ms gap. Push-button phones send tones, decoded from the VOUT audio in software.

### Audio and echo

The AG1171 converts the phone's 2-wire line to separate in and out audio (a "hybrid") at 0 dB gain and 600Ω. A hybrid always reflects some of the far end's voice back. Since the far end hears that as echo, **echo cancellation is required**, for example WebRTC's echo canceller on the Pi. Set levels with the trimmer on VOUT and the sound card's mixer.

## Parts

Costs, shops and links are in the [README](../README.md#build-a-phone). Per phone:

| Part | Qty | Notes |
|---|---|---|
| Silvertel AG1171 | 1 | The line interface |
| 3.3V 1A switching regulator, 7805-style pinout (e.g. Traco TSR 1-2433 or Recom R-78E3.3-1.0) | 1 | Powers the AG1171 only |
| 470µF 16V electrolytic capacitor | 1 | On the AG1171 supply |
| 100nF ceramic capacitors | 2 | Supply decoupling |
| 10nF ceramic capacitors | 2 | Tip and ring to ground |
| 1µF film or ceramic capacitors | 2 | Audio in and out |
| 1N4004 diodes | 4 | Protection bridge |
| BZT03C82 or P6KE82 clamp diode | 1 | Protection, 82V |
| 10k trimmer | 1 | Microphone level |
| RJ11 (6P4C) PCB jack | 1 | Where the phone plugs in |
| Stripboard ~5 × 7 cm, pin headers, jumper wires | 1 | Prototype board |

Plus the Pi Zero 2 W, power supply, USB hub and USB sound card from the core kit.

## The phone: FeTAp 611

**Our standard phone is the FeTAp 611**, the German Bundespost rotary phone of the 1970s, bought **restored**. One model means every unit is the same inside, so a 3D-printed Pi mount fits every time.

| Why | |
|---|---|
| Real vintage, real bell | A genuine Bundespost phone with its mechanical bell and original rotary dial, not a remake |
| Easy to buy, more than once | [Telefonmanufaktur](https://telefonmanufaktur.de/de/startseite/83-fetap-611-restauriert-designklassiker-in-verschiedenen-farbvarianten.html) (Germany) restores them continuously: €98 incl. VAT, in 5 colours, [€16.25 shipping to NL](https://telefonmanufaktur.de/de/content/8-zahlung-und-versand). An EU shop, so no import tax |
| Rings on two wires | Telefonmanufaktur fits a new RJ11 cord for use on routers' analog ports, which ring on two wires. That's exactly what the line board provides, so there's no UK-style "bell wire" problem |
| Documented by others | A [Pi Zero build in a FeTAp 611](https://hackaday.io/project/165208-an-old-rotary-phone-as-bluetooth-set) (dial, hook switch and handset pins), a [restoration guide](https://www.kahlhans.de/telefonseite/galerie/fetap-611/aufbereitung-fetap-611/), [old phones on a FritzBox](https://kleine-technikwelt.de/alte-telefone-an-der-fritzbox.php), and the [historic-telephone forum](https://wasser.de/telefon-alt/forum/) |
| Made in the millions | Spares and second-hand units are everywhere in the EU, for example on [Vinted.nl](https://www.vinted.nl/catalog?search_text=fetap%20611) and [Marktplaats](https://www.marktplaats.nl/q/fetap+611/) (usually untested) |

**Don't buy Telefonmanufaktur's pulse-to-tone converter** (€82). The line board reads the rotary dial's pulses directly.

### Other phones

The line board works with any analog phone, but we only design and test for the FeTAp 611. Possible second models later: the Socotel S63 (France, restored by [Le Téléphone Vintage](https://www.letelephonevintage.com/pages/Les_socotel_S63_dispos-5521360.html)) and the original Post Office 746 (UK; best documented at [britishtelephones.com](https://www.britishtelephones.com/t746.htm), but refurbished units come from the UK with import tax, and it needs a capacitor for the UK "bell wire"). We ruled out new "retro" remakes: they're not the real thing, and nobody has documented their insides.

### Check on each phone

* **Pulse dialling:** the FeTAp 611 pulses (German: IWV), which is what we want.
* **Dial contacts** on old phones may be dirty. Clean them with paper, not abrasives ([2E0WAW](https://www.qsl.net/2e0waw/intercom.htm)).
* **Second-hand units** (Vinted, Marktplaats) are usually untested: the bell may need adjusting and the carbon microphone capsule replacing. Both are covered in the restoration guide above.

## Prototype checklist (M1)

1. Build the line board on prototype board and power it from a bench supply at 3.3V. Plug in the restored FeTAp 611 by its RJ11 cord.
2. Hook detection: SHK goes high when the handset is lifted and low when it's replaced.
3. Rotary dial: count pulses for each digit 0–9, at least 20 times without a miss.
4. Ringing: the bell rings at 25 Hz with the 1 s on / 4 s off cadence. Lifting the handset mid-ring stops it within 0.5 s.
5. Audio: a tone from the Pi is heard in the earpiece; speech from the handset reaches the Pi. Set the trimmer for no clipping.
6. Power: the Pi doesn't brown out while ringing, measured from a single 5V supply.
7. Echo: on a test call, the far end hears no echo with echo cancellation on.

## Later: the Homephone board

Once the prototype works, turn it into one small board that sits on the Pi Zero's header: AG1171, regulator, protection, phone jack and a sound codec. That would also replace the USB hub and sound card.

## Sources

[AG1171 datasheet](https://static.chipdip.ru/lib/300/DOC029300244.pdf) (V1.6) · [Blue POT](https://github.com/danjulio/blue_pot) (schematic in `eagle/blue_pot_proto.sch`) · [The Phone Friend](https://hackaday.io/project/190181-the-phone-friend) and its [SLIC control log](https://hackaday.io/project/190181/log/217478) · [Old rotary phone as a Bluetooth set](https://hackaday.io/project/165208-an-old-rotary-phone-as-bluetooth-set) ([making it ring](https://hackaday.io/project/165208/log/162522-making-it-ring)) · [Raspberry Pi: Pi Zero 2 W revives an iconic red telephone](https://www.raspberrypi.com/news/raspberry-pi-zero-2-w-revives-iconic-red-telephone-magpimonday/) · [British Telephones: the 746](https://www.britishtelephones.com/t746.htm)
