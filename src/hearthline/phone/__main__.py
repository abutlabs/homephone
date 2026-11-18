"""Run the phone: ``hearthline-phone`` (or ``python -m hearthline.phone``).

Settings come from environment variables (see ``.env.example``) and can be
overridden with flags. ``--mock`` runs without any hardware: the hook switch
is driven from the keyboard (press Enter) or the laptop web page, the
microphone sends test pips, and the ringer prints to the log.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

from ..identity import DEFAULT_KEYFILE, DeviceIdentity
from .audio import MockHandset, MockRinger
from .controller import PhoneController, State
from .hook import MockHook
from .media import LiveKitMedia
from .signaling import Signaling

log = logging.getLogger("hearthline")


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    env = os.environ.get
    p = argparse.ArgumentParser(prog="hearthline-phone")
    p.add_argument("--server", default=env("HEARTHLINE_SERVER", "ws://localhost:8080/ws"),
                   help="ringing server WebSocket URL")
    p.add_argument("--name", default=env("HEARTHLINE_PHONE_NAME", "Pi phone"))
    p.add_argument("--household", default=env("HEARTHLINE_HOUSEHOLD"),
                   help="household to join (only used if the server allows auto-enroll)")
    p.add_argument("--call", default=env("HEARTHLINE_DEFAULT_CALL", "laptop"),
                   help="household to ring when the handset is lifted")
    p.add_argument("--keyfile", type=Path, default=DEFAULT_KEYFILE)
    p.add_argument("--livekit-url", default=env("HEARTHLINE_LIVEKIT_URL"),
                   help="override the LiveKit URL the server hands out")
    p.add_argument("--mock", default=env("HEARTHLINE_MOCK", ""), nargs="?", const="all",
                   help="mock hardware: 'all', or a comma list of hook,audio,ringer")
    p.add_argument("--hook-pin", type=int, default=int(env("HEARTHLINE_HOOK_PIN", "17")))
    p.add_argument("--off-hook-when", choices=["open", "closed"],
                   default=env("HEARTHLINE_OFF_HOOK_WHEN", "open"),
                   help="switch state that means the handset is lifted")
    p.add_argument("--handset-device", default=env("HEARTHLINE_HANDSET_DEVICE", "USB Audio"))
    p.add_argument("--ringer-device", default=env("HEARTHLINE_RINGER_DEVICE"))
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args(argv)


def mocked(args: argparse.Namespace, part: str) -> bool:
    parts = {s.strip() for s in (args.mock or "").split(",") if s.strip()}
    return "all" in parts or part in parts


def build_hardware(args: argparse.Namespace):
    if mocked(args, "hook"):
        hook = MockHook()
    else:
        from .hook import GpioHook

        hook = GpioHook(args.hook_pin, args.off_hook_when)
    if mocked(args, "audio"):
        handset = MockHandset()
    else:
        from .audio import SoundDeviceHandset

        handset = SoundDeviceHandset(args.handset_device)
    if mocked(args, "ringer") or (mocked(args, "audio") and not args.ringer_device):
        ringer = MockRinger()
    else:
        from .audio import SoundDeviceRinger

        ringer = SoundDeviceRinger(args.ringer_device)
    return hook, handset, ringer


async def keyboard(hook: MockHook) -> None:
    """Press Enter to lift or hang up the mock handset."""
    loop = asyncio.get_running_loop()
    print("Mock phone: press Enter to lift / hang up the handset.", flush=True)
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            return
        hook.toggle()


async def run(args: argparse.Namespace) -> None:
    identity = DeviceIdentity.load_or_create(args.keyfile, args.name)
    log.info("device account %s", identity.address)
    hook, handset, ringer = build_hardware(args)
    media = LiveKitMedia(handset)
    sig = Signaling(args.server, identity, args.name, args.household, mock=mocked(args, "hook"))
    phone = PhoneController(
        hook, handset, ringer, media, sig.send,
        default_call=args.call or None,
        livekit_url_override=args.livekit_url,
    )
    phone.attach(asyncio.get_running_loop())

    async def heartbeat() -> None:
        # Lets the laptop dashboard show whether audio is arriving.
        while True:
            await asyncio.sleep(1.0)
            if sig.connected.is_set() and phone.state == State.IN_CALL:
                await phone.report_status()

    async def on_message(msg):
        await phone.on_message(msg)
        if msg["type"] == "welcome":
            await phone.report_status()

    tasks = [sig.run(on_message, phone.on_disconnect), heartbeat()]
    if isinstance(hook, MockHook) and sys.stdin.isatty():
        tasks.append(keyboard(hook))
    try:
        await asyncio.gather(*tasks)
    finally:
        await media.leave()
        ringer.close()
        handset.close()
        hook.close()


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(name)s %(message)s",
    )
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
