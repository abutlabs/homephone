# Roadmap

Homephone is a family-and-friends proof of concept first, and maybe a product later. Each milestone ends with something you can pick up and use. The plan is to build two phones: phone 1 is tested against a laptop, then phone 2 joins.

Last updated: 18 Nov 2026.

## Milestones

### M1. One Pi phone calls a laptop *(in progress)*

The Pi program, ringing server and laptop test page in this repo. Lifting the handset rings the laptop; the laptop can ring the phone; audio both ways over LiveKit. Each device has a Polkadot account and signs in with it.

* Done so far: the software, tests, and a Docker setup that runs the whole call on a laptop with a mock phone (no hardware needed).
* Left: the parts arrive after 24 Nov. Then build phone 1 ([docs/pi-setup.md](docs/pi-setup.md)), confirm the Pi Zero 2 W has enough memory, and tune handset audio levels.

**Done when:** a real Pi phone in a box rings a laptop on LiveKit Cloud when its handset is lifted, the laptop can ring it back, and both sides hear each other clearly for 5 minutes.

### M2. Second phone and household ringing

Build phone 2. Put two phones (or a phone and a laptop) in one household and a third device in another, so calling a household rings every device in it and the first pickup wins. Add a missed-call light and a do-not-disturb switch if wanted. Decide whether a keypad is needed to choose a household, or one button per household.

**Done when:** calling a household with two devices rings both, picking up on one silences the other, and phones in two different homes can call each other.

### M3. Phone app with pairing

One cross-platform phone app (iOS and Android) that can call and answer like a housephone, and that sets up a new Pi: it sends the Wi-Fi details over Bluetooth, the Pi creates its Polkadot key, and the app adds it to a household. Needs an Apple Developer account ($99/year) for iOS. Open question: build our own app, or start from an existing app for v1.

**Done when:** someone who has never seen the project can unbox a phone, pair it with the app in under 10 minutes, and receive a call on both the phone and the app.

### M4. Households on Polkadot Hub

Move household membership from `households.json` to the [HouseholdRegistry contract](contracts/HouseholdRegistry.sol) on Polkadot Hub testnet. Creating a household, inviting and accepting happen from the app, signed with each person's or device's Polkadot account. The ringing server reads the contract and only rings members. Only account addresses go on-chain: no names, numbers or call records.

**Done when:** a household is created and a phone is invited and accepted on Polkadot Hub testnet, and the server rings it based on the contract alone.

### M5. Flash-ready image

An open-source SD-card image built on Raspberry Pi OS Lite with Raspberry Pi's image tools, so a new phone needs no terminal at all: flash, boot, pair with the app (M3).

**Done when:** a blank SD card flashed with the published image becomes a working phone after pairing, with no command line.

## Later

* **Vintage shell.** Move a proven phone into a thrifted 1970s–80s desk phone, swap the carbon microphone, and ring its real bell with a solenoid (build C in the README).
* **Polkadot-native ringing.** Send the ring and answer messages over Polkadot's own messaging (the People chain Statement Store) instead of our server. Needs an allowance we don't have yet.
* **JAM.** Move to Polkadot's JAM when it is ready. No date yet.
* **Public number.** Let a household opt in to calls from outside the family group.
* **Self-hosted LiveKit** (~€5–10/month) if the free tier runs out or for privacy. Open question.
* **Product hardware.** A custom board (sound, ringer driver, switch inputs) and a moulded shell, aiming well under €100 a unit.
* **Power cuts.** A battery HAT so the phone keeps working in an outage.

## Open questions

* Custom app or an existing app for v1 (M3)?
* LiveKit Cloud or self-hosted?
* Rotary dial, keypad, or one button per household?
* Is the Pi Zero 2 W's 512MB enough? (Answered in M1.)
