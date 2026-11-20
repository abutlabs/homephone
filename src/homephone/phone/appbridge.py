"""The house phone answering Polkadot App calls (route A').

    python -m homephone.phone.appbridge --mock all --auto-answer 3

Runs the Node daemon (packages/linked-device/bin/daemon.ts), which is the Pi's
Polkadot side: it receives call offers addressed to the house account and
sends our answers. This program is the phone: when an offer arrives the bell
rings; lifting the handset answers; hanging up ends the call. It uses the same
Hook, Ringer and Handset interfaces as the rest of the phone program, so on the
Pi the real rotary phone (through the line board) rings and answers.

``--mock all`` uses stand-ins: ``--auto-answer N`` lifts the pretend handset
after N seconds, and the pretend microphone sends test beeps.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import shutil
import sys
from pathlib import Path

from .appcall import AppCall
from .audio import Handset, Ringer
from .hook import Hook, MockHook

log = logging.getLogger("homephone.app")
ROOT = Path(__file__).resolve().parents[3]
DAEMON = ROOT / "packages" / "linked-device" / "bin" / "daemon.ts"


class AppPhone:
    def __init__(self, hook: Hook, handset: Handset, ringer: Ringer, daemon_cmd: list[str],
                 auto_answer: float | None = None, hangup_after: float | None = None):
        self.hook, self.handset, self.ringer = hook, handset, ringer
        self.daemon_cmd = daemon_cmd
        self.auto_answer = auto_answer
        self.hangup_after = hangup_after
        self.proc: asyncio.subprocess.Process | None = None
        self.ringing: tuple[str, str, str] | None = None  # (callId, from, offer sdp)
        self.call: AppCall | None = None
        self.call_id: str | None = None
        self.pending_ice: list[str] = []
        self._lock = asyncio.Lock()
        self._tasks: set[asyncio.Task] = set()

    # ---- daemon link -------------------------------------------------------
    async def send(self, **cmd) -> None:
        assert self.proc and self.proc.stdin
        self.proc.stdin.write((json.dumps(cmd) + "\n").encode())
        await self.proc.stdin.drain()

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        self.hook.on_change(lambda off: asyncio.run_coroutine_threadsafe(self.on_hook(off), loop))
        self.proc = await asyncio.create_subprocess_exec(
            *self.daemon_cmd, cwd=ROOT, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=None, limit=1 << 20,
        )
        assert self.proc.stdout
        async for raw in self.proc.stdout:
            try:
                ev = json.loads(raw)
            except ValueError:
                continue
            await self.on_event(ev)
        log.error("daemon exited (%s)", await self.proc.wait())

    async def on_event(self, ev: dict) -> None:
        kind = ev.get("event")
        async with self._lock:
            if kind == "ready":
                log.info("listening for calls to the house")
            elif kind == "offer":
                if self.call or self.ringing or self.hook.off_hook:
                    log.info("busy: ignoring call from %s", ev["from"])  # send nothing (spec §3.4)
                    return
                self.ringing = (ev["callId"], ev["from"], ev["sdp"])
                self.pending_ice = []
                log.info("RING RING: call from %s", ev["from"])
                self.ringer.start()
                if self.auto_answer is not None and isinstance(self.hook, MockHook):
                    self._spawn(self._lift_after(self.auto_answer, ev["callId"]))
            elif kind == "ice":
                if self.call and ev["callId"] == self.call_id:
                    await self.call.add_remote_candidates(ev["candidates"])
                elif self.ringing and ev["callId"] == self.ringing[0]:
                    self.pending_ice += ev["candidates"]
            elif kind == "closed":
                if self.ringing and ev["callId"] == self.ringing[0]:
                    log.info("caller gave up")
                    self.ringer.stop()
                    self.ringing = None
                elif self.call and ev["callId"] == self.call_id:
                    log.info("caller hung up")
                    await self._end(send_hangup=False)
            elif kind == "sent":
                log.info("sent %s: %s", ev.get("what"), ev.get("result"))

    async def _lift_after(self, seconds: float, call_id: str) -> None:
        await asyncio.sleep(seconds)
        if self.ringing and self.ringing[0] == call_id:
            log.info("(mock) lifting the handset")
            self.hook.set(True)  # type: ignore[attr-defined]

    # ---- the hook switch ----------------------------------------------------
    async def on_hook(self, off_hook: bool) -> None:
        async with self._lock:
            if off_hook and self.ringing:
                call_id, who, sdp = self.ringing
                self.ringing = None
                self.ringer.stop()
                self.call, self.call_id = AppCall(self.handset), call_id
                self.call.on_state = lambda st: log.info("connection %s", st)
                answer = await self.call.answer(sdp)
                await self.send(cmd="answer", callId=call_id, sdp=answer)
                if self.pending_ice:
                    await self.call.add_remote_candidates(self.pending_ice)
                log.info("answered %s; waiting for audio", who)
                self._spawn(self._audio_when_ready(self.call))
            elif not off_hook and self.call:
                await self._end(send_hangup=True)

    async def _audio_when_ready(self, call: AppCall) -> None:
        try:
            await asyncio.wait_for(call.media_ready.wait(), 20)
        except asyncio.TimeoutError:
            log.warning("no audio negotiated within 20 s (connection %s)", call.state)
            return
        call.start_audio()
        log.info("IN CALL: audio flowing")
        if self.hangup_after is not None and isinstance(self.hook, MockHook):
            self._spawn(self._hang_up_after(self.hangup_after))
        while self.call is call:
            await asyncio.sleep(2)
            log.info("connection %s, earpiece level %.3f", call.state, getattr(self.handset, "level", 0.0))

    async def _hang_up_after(self, seconds: float) -> None:
        await asyncio.sleep(seconds)
        log.info("(mock) hanging up")
        self.hook.set(False)  # type: ignore[attr-defined]

    async def _end(self, send_hangup: bool) -> None:
        if self.call:
            if send_hangup and self.call_id:
                await self.send(cmd="hangup", callId=self.call_id)
            await self.call.close()
        self.call, self.call_id = None, None
        log.info("call ended")

    def _spawn(self, coro) -> None:
        t = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)


def node_binary() -> str:
    node = os.environ.get("HOMEPHONE_NODE") or shutil.which("node")
    if not node:
        raise SystemExit("needs Node 22.18+ (set HOMEPHONE_NODE)")
    return node


def main(argv: list[str] | None = None) -> None:
    from .__main__ import build_hardware

    p = argparse.ArgumentParser(prog="homephone-app")
    p.add_argument("--session", default=".secrets/house-device.json")
    p.add_argument("--contacts", default=".secrets/house-contacts.json")
    p.add_argument("--account", default=".secrets/house-account.json",
                   help="house account recovery phrase file; if present, sign as the house identity (no phone needed)")
    p.add_argument("--mock", nargs="?", const="all", default=os.environ.get("HOMEPHONE_MOCK", ""))
    p.add_argument("--auto-answer", type=float, help="(mock) lift the handset N seconds after it rings")
    p.add_argument("--hangup-after", type=float, help="(mock) hang up N seconds into the call")
    p.add_argument("--hook-pin", type=int, default=17)
    p.add_argument("--off-hook-when", choices=["open", "closed"], default="open")
    p.add_argument("--handset-device", default="USB Audio")
    p.add_argument("--ringer-device", default=None)
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(name)s %(message)s", datefmt="%H:%M:%S")
    hook, handset, ringer = build_hardware(args)
    cmd = [node_binary(), str(DAEMON), "--session", args.session, "--contacts", args.contacts]
    if args.account and (ROOT / args.account).exists():
        cmd += ["--account", args.account]
    phone = AppPhone(hook, handset, ringer, cmd, args.auto_answer, args.hangup_after)
    try:
        asyncio.run(phone.run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main(sys.argv[1:])
