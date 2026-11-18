"""The phone's behaviour, as a small state machine.

    idle --lift--> dialing --(auto-dial)--> calling --answered--> in_call
    idle --ring--> ringing --lift--> (answer) --join--> in_call
    in_call --far end hangs up--> ended (busy tone until you hang up)
    any off-hook state --hang up--> idle

Milestone 1 has no keypad: lifting the handset rings ``default_call`` (a
household id) after a short dial tone, like a hotline.
"""

from __future__ import annotations

import asyncio
import enum
import logging
from typing import Any, Awaitable, Callable, Protocol

from .audio import Handset, Ringer
from .hook import Hook
from .media import Media

log = logging.getLogger("homephone.phone")


class State(str, enum.Enum):
    IDLE = "idle"
    DIALING = "dialing"
    CALLING = "calling"
    RINGING = "ringing"
    ANSWERING = "answering"
    IN_CALL = "in_call"
    ENDED = "ended"


class Sender(Protocol):
    def __call__(self, type_: str, **fields: Any) -> Awaitable[None]: ...


class PhoneController:
    def __init__(
        self,
        hook: Hook,
        handset: Handset,
        ringer: Ringer,
        media: Media,
        send: Sender,
        default_call: str | None = None,
        dial_delay: float = 1.5,
        livekit_url_override: str | None = None,
    ):
        self.hook = hook
        self.handset = handset
        self.ringer = ringer
        self.media = media
        self.send = send
        self.default_call = default_call
        self.dial_delay = dial_delay
        self.livekit_url_override = livekit_url_override
        self.state = State.IDLE
        self.call_id: str | None = None
        self.on_state: Callable[[State], None] | None = None
        self._dial_task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = asyncio.Lock()

    # ---- wiring ---------------------------------------------------------
    def attach(self, loop: asyncio.AbstractEventLoop) -> None:
        """Listen to the hook switch. Its callbacks may come from another thread."""
        self._loop = loop

        def changed(off_hook: bool) -> None:
            fut = asyncio.run_coroutine_threadsafe(self.on_hook(off_hook), loop)
            fut.add_done_callback(_log_errors)

        self.hook.on_change(changed)

    def _set(self, state: State) -> None:
        if state != self.state:
            log.info("%s -> %s", self.state.value, state.value)
        self.state = state
        if self.on_state:
            self.on_state(state)

    async def report_status(self) -> None:
        await self.send(
            "status",
            state=self.state.value,
            off_hook=self.hook.off_hook,
            audio_level=round(self.handset.level, 4),
        )

    # ---- hook switch ----------------------------------------------------
    async def on_hook(self, off_hook: bool) -> None:
        async with self._lock:
            if off_hook:
                await self._lifted()
            else:
                await self._hung_up()
        await self.report_status()

    async def _lifted(self) -> None:
        if self.state == State.RINGING:
            self.ringer.stop()
            self._set(State.ANSWERING)
            await self.send("answer", call_id=self.call_id)
        elif self.state == State.IDLE:
            self._set(State.DIALING)
            self.handset.play_tone("dial")
            if self.default_call:
                self._dial_task = asyncio.get_running_loop().create_task(self._auto_dial())

    async def _auto_dial(self) -> None:
        await asyncio.sleep(self.dial_delay)
        if self.state == State.DIALING and self.hook.off_hook:
            await self.send("call", to=self.default_call)

    async def _hung_up(self) -> None:
        if self._dial_task:
            self._dial_task.cancel()
            self._dial_task = None
        if self.call_id and self.state in (State.CALLING, State.IN_CALL, State.ANSWERING):
            await self.send("hangup", call_id=self.call_id)
        if self.state != State.RINGING:
            await self._reset()

    async def _reset(self) -> None:
        self.ringer.stop()
        self.handset.stop_tone()
        await self.media.leave()
        self.call_id = None
        self._set(State.IDLE)

    # ---- server messages ------------------------------------------------
    async def on_message(self, msg: dict[str, Any]) -> None:
        async with self._lock:
            await self._handle(msg)
        if msg["type"] != "welcome":
            await self.report_status()

    def _url(self, msg: dict[str, Any]) -> str:
        return self.livekit_url_override or msg["url"]

    async def _handle(self, msg: dict[str, Any]) -> None:
        t = msg["type"]
        call_id = msg.get("call_id")
        if t == "welcome":
            log.info("joined household '%s'", msg.get("household"))
        elif t == "ring":
            if self.state == State.IDLE and not self.hook.off_hook:
                self.call_id = call_id
                self._set(State.RINGING)
                self.ringer.start()
                log.info("incoming call from %s", msg.get("from"))
            else:
                # Busy: someone is using this phone. Decline so others can answer.
                await self.send("hangup", call_id=call_id)
        elif t == "calling":
            if self.state != State.DIALING or not self.hook.off_hook:
                await self.send("hangup", call_id=call_id)
                return
            self.call_id = call_id
            self._set(State.CALLING)
            self.handset.play_tone("ringback")
            await self.media.join(self._url(msg), msg["token"])
        elif t == "answered" and call_id == self.call_id:
            self.handset.stop_tone()
            self.media.start_audio()
            self._set(State.IN_CALL)
        elif t == "join" and call_id == self.call_id:
            if not self.hook.off_hook:
                await self.send("hangup", call_id=call_id)
                await self._reset()
                return
            await self.media.join(self._url(msg), msg["token"])
            self.media.start_audio()
            self._set(State.IN_CALL)
        elif t == "stop_ring" and call_id == self.call_id:
            self.ringer.stop()
            if self.hook.off_hook:  # lifted just as someone else answered
                await self.media.leave()
                self.call_id = None
                self.handset.play_tone("busy")
                self._set(State.ENDED)
            else:
                await self._reset()
        elif t == "ended" and (call_id == self.call_id or self.state == State.DIALING):
            log.info("call ended: %s", msg.get("reason"))
            self.ringer.stop()
            await self.media.leave()
            self.call_id = None
            if self.hook.off_hook:
                self.handset.play_tone("busy")
                self._set(State.ENDED)
            else:
                self._set(State.IDLE)
        elif t == "mock_hook":
            set_hook = getattr(self.hook, "set", None)
            if set_hook:
                # Run outside the lock: the hook listener takes it again.
                asyncio.get_running_loop().call_soon(set_hook, bool(msg.get("off_hook")))
        elif t == "error":
            log.error("server: %s", msg.get("message"))

    async def on_disconnect(self) -> None:
        """Lost the server: drop any call and stop ringing."""
        async with self._lock:
            if self.state in (State.RINGING, State.CALLING, State.IN_CALL, State.ANSWERING):
                self.ringer.stop()
                await self.media.leave()
                self.call_id = None
                if self.hook.off_hook:
                    self.handset.play_tone("busy")
                    self._set(State.ENDED)
                else:
                    self._set(State.IDLE)


def _log_errors(fut) -> None:
    exc = fut.exception()
    if exc:
        log.error("hook handler failed", exc_info=exc)
