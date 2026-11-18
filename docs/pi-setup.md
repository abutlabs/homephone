# Set up a Pi phone (first time with a Raspberry Pi)

This takes about an hour. Nothing needs soldering. Each part is tested on its own before the next, so if something fails you know which part it is.

You need: the parts from build A or B in the [README](../README.md#build-a-phone), a laptop on the same Wi-Fi, and a microSD card reader (many laptops have one, or use a cheap USB one).

## 1. Put Raspberry Pi OS on the SD card

1. Install **Raspberry Pi Imager** on your laptop from <https://www.raspberrypi.com/software/>.
2. Open it and choose:
   * **Device:** your Pi (Raspberry Pi Zero 2 W, 4 or 5).
   * **Operating system:** *Raspberry Pi OS (other)* → **Raspberry Pi OS Lite (64-bit)**. Lite has no desktop, which saves memory.
   * **Storage:** your microSD card.
3. When it asks about OS customisation, choose **Edit settings** and set:
   * **Hostname:** `homephone-1` (phone 2 becomes `homephone-2`).
   * **Username and password:** username `pi` and a password you'll remember. The service file assumes `pi`.
   * **Wireless LAN:** your Wi-Fi name and password, and country **NL**.
   * **Services** tab: **Enable SSH**, with password authentication.
4. Write the card. It takes a few minutes.

## 2. First boot and logging in

1. Put the card in the Pi and plug in the power. Give it 2–3 minutes the first time.
2. On your laptop, open a terminal (on a Mac: the *Terminal* app) and run:
   ```sh
   ssh pi@homephone-1.local
   ```
   Type `yes` to the fingerprint question, then your password. You're now typing on the Pi.
   If `homephone-1.local` isn't found, look up the Pi's address in your router's device list and use `ssh pi@<that address>`.
3. Update it:
   ```sh
   sudo apt update && sudo apt full-upgrade -y
   ```

## 3. Install Homephone

```sh
sudo apt install -y git python3-venv python3-gpiozero python3-lgpio libportaudio2 alsa-utils
git clone https://github.com/abutlabs/homephone.git
cd homephone
python3 -m venv --system-site-packages .venv   # system packages give the venv GPIO access
. .venv/bin/activate
pip install -e ".[pi]"
homephone-identity
```

`homephone-identity` creates the phone's Polkadot account and prints its address. Keep that address for step 8. The secret stays in `~/.config/homephone/device-key.json`; never copy that file anywhere.

On a Pi Zero, `pip install` can take 10–20 minutes. That's normal.

## 4. Handset audio

1. Plug the Adafruit USB sound card into the hub (Zero) or a USB port (Pi 4/5), and the handset into it. If the handset has one 4-pole plug, it needs a TRRS splitter into the sound card's headphone and mic jacks.
2. List the sound devices:
   ```sh
   arecord -l
   aplay -l
   ```
   The sound card shows as something like `card 1: Device [USB Audio Device]`.
3. Record 5 seconds while talking into the handset, then play it back through the earpiece:
   ```sh
   arecord -D plughw:1,0 -f S16_LE -r 48000 -c 1 -d 5 test.wav
   aplay -D plughw:1,0 test.wav
   ```
   Use the card number from step 2. If it's quiet, run `alsamixer`, press **F6** to choose the USB card, and raise *Mic* and *Speaker*. Save the levels with `sudo alsactl store`.

## 5. Ringer

Plug the USB speaker into the hub. Find its name with `aplay -l` (Adafruit's speaker shows as `UACDemo`). Test it:

```sh
speaker-test -D plughw:2,0 -c 2 -t sine -f 800 -l 1
```

## 6. Hook switch

Power the Pi off first: `sudo poweroff`, wait for the light to stop, then unplug.

Connect the reed switch's two wires, with female jumper wires or the screw-terminal HAT:

| Switch wire | Pi pin |
|---|---|
| one side | **GPIO 17** (physical pin 11) |
| other side | **GND** (physical pin 9) |

Pin 1 is the corner pin nearest the SD card slot, on the inside row. Glue the magnet into the handset and the switch under where it rests. Either wire can go to either pin.

Power on, log in again, and test:

```sh
cd homephone && . .venv/bin/activate
python -c "from gpiozero import Button; from signal import pause; b=Button(17); b.when_pressed=lambda:print('closed'); b.when_released=lambda:print('open'); pause()"
```

Lift and replace the handset. With a reed switch it usually prints `open` when you lift it. If it prints `closed` when lifted, set `HOMEPHONE_OFF_HOOK_WHEN=closed` in step 7. Press Ctrl+C to stop.

## 7. Configure the phone

```sh
cp .env.example .env
nano .env
```

Set the phone part:

* `HOMEPHONE_SERVER=ws://<your laptop's address>:8080/ws`. Find the laptop's address in its Wi-Fi settings, for example `192.168.1.20`.
* `HOMEPHONE_PHONE_NAME=Kitchen phone`
* `HOMEPHONE_DEFAULT_CALL=laptop`
* `HOMEPHONE_HANDSET_DEVICE=USB Audio` and `HOMEPHONE_RINGER_DEVICE=UACDemo`, or part of the names that `python -m sounddevice` lists.

Leave the LiveKit lines empty on the Pi. Only the server needs them.

Save with Ctrl+O, Enter, then Ctrl+X.

## 8. First call

On your **laptop**, start the ringing server with LiveKit Cloud ([docs/livekit-cloud.md](livekit-cloud.md)) and add the phone to a household:

```sh
homephone-server enroll --household home --address <the Pi's address from step 3> --name "Kitchen phone"
homephone-server run
```

Open the link it prints and click **Start test phone**.

On the **Pi**:

```sh
set -a; . ./.env; set +a
homephone
```

You should see `joined household 'home'`. Now:

* Lift the handset: dial tone, then the laptop rings. Answer it on the laptop.
* Or click **Call** next to *home* on the laptop: the USB speaker rings. Lift the handset to answer.

**No LiveKit account?** You can use the Docker LiveKit on your laptop instead. Start it with `LIVEKIT_NODE_IP=<laptop address> docker compose up`, and on the Pi add `HOMEPHONE_LIVEKIT_URL=ws://<laptop address>:7880` and `HOMEPHONE_HOUSEHOLD=home` to `.env` and point `HOMEPHONE_SERVER` at the laptop as above. The Docker server lets the phone join `home` by itself.

## 9. Start on boot

```sh
sudo cp deploy/homephone.service /etc/systemd/system/
sudo systemctl enable --now homephone
journalctl -u homephone -f
```

The phone now starts by itself after a power cut. Stop it with `sudo systemctl stop homephone`.

## Troubleshooting

| Problem | Try |
|---|---|
| `no output sound device matching 'USB Audio'` | `python -m sounddevice` lists names; put part of the right one in `.env`. |
| You hear nothing in the earpiece | `alsamixer`, F6, pick the USB card, raise *Speaker*; check the plug is in the headphone jack. |
| The other side can't hear you | Raise *Mic* in `alsamixer`; check the plug is in the mic jack. |
| Hook state is backwards | Flip `HOMEPHONE_OFF_HOOK_WHEN` between `open` and `closed`. |
| `server unreachable` | Check the laptop's address, that the server is running, and that the laptop firewall allows port 8080. |
| `unknown phone` | Run the `enroll` command on the laptop with the address from `homephone-identity`. |
| Pi Zero runs out of memory | Check with `free -h` during a call. If it's tight, move to build B (Pi 4 or 5). Please note the numbers in an issue; it answers an open question. |
