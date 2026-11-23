#!/usr/bin/env python3
"""Test the breadboard line board, one step at a time (README: "Wire the line board").

    python3 scripts/linetest.py hook    # shows "lifted" / "on hook" as you lift and replace the handset
    python3 scripts/linetest.py ring    # rings the bell 3 times (1 s on, 4 s off); lift the handset to stop it
    python3 scripts/linetest.py dial    # lift the handset and dial; prints each digit

Runs on the Pi (Raspberry Pi OS). Uses gpiozero, which Raspberry Pi OS includes.

Pins (BCM numbers, physical pin in brackets):
    GPIO17 [11]  <- AG1171 SHK  (high = handset lifted; pulses while dialling)
    GPIO27 [13]  -> AG1171 RM   (high only while ringing)
    GPIO22 [15]  -> AG1171 F/R  (toggled at 25 Hz to ring; high otherwise)

Safety rules from the AG1171 datasheet, enforced here: RM is high at most 1 s in
every 5 s (20%, limit 33%), and ringing stops when the handset is lifted.
"""

from __future__ import annotations

import sys
import time

SHK, RM, FR = 17, 27, 22
RING_HZ = 25  # German phones ring at 25 Hz
RING_ON, RING_OFF = 1.0, 4.0


def pins():
    from gpiozero import DigitalInputDevice, DigitalOutputDevice

    shk = DigitalInputDevice(SHK, pull_up=None, active_state=True)  # the AG1171 drives SHK
    rm = DigitalOutputDevice(RM, initial_value=False)
    fr = DigitalOutputDevice(FR, initial_value=True)
    return shk, rm, fr


def hook() -> None:
    shk, _, _ = pins()
    print("Lift and replace the handset (Ctrl-C to stop).")
    last = None
    while True:
        now = shk.value
        if now != last:
            print("lifted" if now else "on hook", flush=True)
            last = now
        time.sleep(0.01)


def ring(times: int = 3) -> None:
    shk, rm, fr = pins()
    if shk.value:
        print("Hang up first: the handset is lifted.")
        return
    half = 1 / (2 * RING_HZ)
    for n in range(times):
        print(f"ring {n + 1}/{times}", flush=True)
        rm.on()
        end = time.monotonic() + RING_ON
        answered = False
        while time.monotonic() < end:
            fr.toggle()
            time.sleep(half)
            if shk.value:  # lifted mid-ring ("ring trip")
                answered = True
                break
        fr.on()
        time.sleep(0.05)  # datasheet: drop RM 10-500 ms after F/R goes high
        rm.off()
        if answered:
            print("answered: ringing stopped")
            return
        time.sleep(RING_OFF)
    print("done")


def dial() -> None:
    shk, _, _ = pins()
    print("Lift the handset, then dial (Ctrl-C to stop).")
    while not shk.value:
        time.sleep(0.01)
    print("lifted: dial a number")
    pulses, low_since, high_since = 0, None, time.monotonic()
    while True:
        lifted = shk.value
        t = time.monotonic()
        if not lifted:
            if low_since is None:
                low_since = t
            elif t - low_since > 0.5:  # a long break is hanging up, not a dial pulse
                print("hung up")
                return
        else:
            if low_since is not None:
                if t - low_since > 0.01:  # debounce: count breaks longer than 10 ms
                    pulses += 1
                low_since, high_since = None, t
            elif pulses and t - high_since > 0.3:  # a pause ends the digit
                print(f"digit {pulses % 10}", flush=True)
                pulses = 0
        time.sleep(0.002)


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    actions = {"hook": hook, "ring": ring, "dial": dial}
    if cmd not in actions:
        print(__doc__)
        sys.exit(2)
    try:
        actions[cmd]()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
