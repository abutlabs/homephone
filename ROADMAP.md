# Roadmap

**Mission:** make a Raspberry Pi in an old landline phone a first-class Polkadot App device, a Polkadot housephone. Family members call it from the Polkadot App they already use, and it rings the house.

Last updated: 18 Nov 2026. Polkadot is the foundation here, not something added later. Read [docs/polkadot.md](docs/polkadot.md) first: it maps every part of Homephone onto the Polkadot platform and compares three ways a Pi can be on Polkadot. [docs/polkadot-dev-notes.md](docs/polkadot-dev-notes.md) has the facts from a full read of the developer docs, with links. [docs/calling-stack.md](docs/calling-stack.md) covers the voice side, including why we don't build on Jami.

## Principles

* **Polkadot provides identity, contacts, signalling and encryption.** Accounts are Polkadot accounts, ringing goes over the People chain Statement Store, and the user-facing app is a Polkadot Product (`homephone.dot`) inside the Polkadot App.
* **Voice goes peer to peer** over WebRTC, with TURN only when two networks can't reach each other. Live audio never goes through a chain.
* **No Homephone server in the call path.** Anything we run (TURN, a dev relay) is plumbing that can't read or decide anything.
* **The Pi never needs a transaction in normal use.** Anything on-chain happens at setup, approved on the owner's phone.
* **The family graph stays private.** Membership and contacts are signed and encrypted, not published in a contract.
* **Testnet first.** Polkadot's production network isn't open to Products yet. We target the `devnet` network, pinned to Product SDK 0.39.0 (TrUAPI 0.25), and move when production opens.

## Milestones

### M0. Polkadot foundations *(now, no hardware needed)*

Learn the platform by using it, before writing more phone code.

* Install the Polkadot App **devnet build** ([TestFlight](https://testflight.apple.com/join/HnBX59vz) or the [Android tester group](https://appdistribution.firebase.dev/i/f3b79521380b40b9); the store releases are a different network) and claim a username. Pair Polkadot Desktop.
* **Voice-in-a-Product test (first, the biggest risk):** can a Product in the mobile App open WebRTC and use the microphone? TrUAPI documents no voice API. Test on iOS and Android separately.
* **Desktop ringing test:** call an account that is paired with Desktop. Does Desktop ring? If so, study its linked-device protocol as a way for the Pi to ring for ordinary App calls.
* **Notification test:** can a closed Product alert the phone (`getNotificationManager`)?
* Register `homephone.dot` on `devnet` and publish a "hello" Product from the [playground template](https://github.com/Polkadot-Community-Foundation/playground-app-template) with `pad`.
* **Ringing spike:** a Node process on the laptop pairs with your phone (`@parity/product-sdk-auth`), gets a Statement Store allowance slot, and rings the Homephone Product open in the App. The Product answers. Measure the delay, and how long the allowance lasts.
* **TURN:** if WebRTC works in a Product, does it get TURN from the platform?
* **Route C experiment:** run the Android App (vanilla APK) on an emulator to see where it breaks without device attestation.
* **Start the conversation** with the Polkadot Community Foundation and Parity about enrolling non-phone devices (route A). Ask on [#polkadot-products-public](https://matrix.to/#/#polkadot-products-public:matrix.org) how to get a Statement Store allowance.

**Done when:** a statement from a process on the laptop makes the Homephone Product on your phone ring within about 2 seconds, and answering in the Product reaches the laptop. The answers to the M0 questions in [docs/polkadot.md](docs/polkadot.md#open-questions-resolve-in-m0) are written down.

### M1. Phone hardware *(in progress)*

Prove the phone hardware and the Pi Zero 2 W with the code already in this repo, where voice goes through LiveKit. LiveKit and the ringing server are only for testing the hardware. M2 replaces both.

* Done so far: the software, tests, and a Docker setup that runs the whole call on a laptop with a mock phone.
* Left: the parts arrive after 24 Nov. Build the bench phone ([docs/pi-setup.md](docs/pi-setup.md)) and measure the Zero's memory and CPU.
* **Line board prototype** ([docs/hardware.md](docs/hardware.md)): build the AG1171 board on prototype board, plug in a restored FeTAp 611, and work through the prototype checklist: hook, rotary dial, real bell ringing, audio levels, power, echo. Add `Hook` and `Ringer` implementations for the line board behind the phone program's existing interfaces.

**Done when:** an unmodified FeTAp 611 plugged into the line board rings a laptop when its handset is lifted, the laptop rings the FeTAp's real bell, and both sides hear each other clearly, without echo, for 5 minutes.

### M2. Ringing over Polkadot (route B)

The Pi joins Polkadot as an extension of its owner's account.

* **`homephone-dot`**, a Node sidecar on the Pi, pairs with the owner's App and holds the Statement Store allowance slot. It publishes and receives encrypted, signed ring, offer, answer and hangup statements: primary topic `homephone`, `topic2` = household inbox. The compact offer is about 210 bytes. Rings repeat until answered, and the callee acknowledges.
* **The Python phone program** keeps the hook, ringer and audio, uses aiortc for WebRTC, and talks to the sidecar over a local socket.
* **The `homephone.dot` Product** calls and answers with the browser's WebRTC.
* **TURN:** the platform's if Products get it (an M0 answer), otherwise our own coturn as a fallback.
* The ringing server and LiveKit are removed.

**Done when:** the Pi in one home and the Polkadot App in another ring each other and talk clearly for 5 minutes. The Pi on a phone hotspot forces a hard NAT. No Homephone server is involved in setting up the call.

### M3. Households and contacts

Build phone 2.

* A household is created by its owner's Homephone account in the Product. The owner adds people (their Homephone accounts) and devices (paired Pis). Calling a household rings every device and member at once, and the first pickup wins.
* **Only people you're connected to in the Polkadot App, and have approved, can ring your house.** You invite them with a one-time link sent in the App chat; they join from Homephone; you approve. Every device keeps the allowlist and silently drops rings from anyone else ([how it works](docs/polkadot.md#who-can-ring-your-home)).
* Display names come from Polkadot usernames when people allow it, for example "alicia.07's house".
* Dial a household with the phone's own dial: rotary pulses from the line board, or tones from push-button phones decoded in software. Speed-dial digits map to households (1 = Grandma's house). Missed-call light and do-not-disturb, if wanted.

**Done when:** a contact you invited through the App chat and approved can ring your house; calling rings both phones and the members' Apps, and picking up on one silences the rest; and a Polkadot account you haven't approved can't make anything ring.

### M4. Setup without a laptop

* Set up a new Pi from the Polkadot App: Wi-Fi, then pairing. The Product guides it. The Pi serves its pairing code locally until the App supports a pairing link.
* Ring family members even when Homephone isn't open in their App. Products only get local notifications today, so this depends on Parity adding remote notifications for Products, or on the chat bot route working in the background.
* If the owner's allowance expires, the Pi signals it (light and voice prompt) and re-pairs in a couple of taps.

**Done when:** someone who has never seen the project unboxes a phone, sets it up from the Polkadot App in under 10 minutes, and receives a call on the phone and in the App.

### M5. Polkadot housephone (route A, if Polkadot adds support)

Route B is the plan. This milestone happens only if Polkadot supports it. The Pi becomes its own Polkadot account: a contact in people's Apps that they call with the App's own call button.

* Depends on the Polkadot Community Foundation and Parity: enrolling a non-phone device (voucher) for a device identity, a username and a Statement Store allowance.
* Run the App's chat and call engine on the Pi, either as the Android App on a Pi 4/5 or as a headless Linux build (the natural contribution back to Polkadot).
* Households, contacts, the call protocol and the hardware carry over from M2–M4. Only the Pi's identity changes.

**Done when:** someone with the stock Polkadot App calls the housephone from its contact page, and the house rings.

### M6. Flash-ready image

An open-source SD-card image built on Raspberry Pi OS Lite. A new phone needs no terminal: flash, boot, set up from the App (M4).

**Done when:** a blank SD card flashed with the published image becomes a working phone after setup, with no command line.

## Later

* **Mainnet.** Move from `devnet` to Polkadot when the production network opens to Products.
* **Group calls.** Three or more people at once needs a media server (an SFU), only for conference calls.
* **Community TURN.** Households with a public address relay for their family.
* **JAM.** Move to Polkadot's JAM when it is ready.
* **Public line.** Let a household opt in to calls from anyone with the Polkadot App.
* **The Homephone board.** One small board on the Pi Zero's header: AG1171, regulator, protection, phone jack and a sound codec, replacing the prototype board, USB adapter and sound card. Then a small case, aiming well under €100 a unit including the phone.
* **Power cuts.** A battery HAT so the phone keeps working in an outage.

## Open questions

The Polkadot-side questions, with how to answer each, are in [docs/polkadot.md](docs/polkadot.md#open-questions-resolve-in-m0). Hardware and voice:

* aiortc on the Pi Zero 2 W: enough CPU and memory alongside the Node sidecar? (M1, M2)
* Is echo cancellation needed with a handset? (M1)
* AG1171 or AG1171-S, and where to buy reliably? Both were out of stock at most EU shops on 19 Nov 2026. (M1)
* Where in the FeTAp 611 do the Pi and line board fit, and what does the 3D-printed mount look like? (M1)
