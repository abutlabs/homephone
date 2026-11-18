"""The hook switch: is the handset lifted?

On the Pi a reed switch or lever switch sits between a GPIO pin (BCM 17 by
default) and ground, using the Pi's internal pull-up. No resistors, no solder.

Which way round depends on the switch: with a magnet in the handset and a
reed switch in the cradle, the switch is *closed* while the handset rests and
*opens* when it is lifted. That is ``off_hook_when="open"`` (the default).
"""

from __future__ import annotations

import logging
from typing import Callable

log = logging.getLogger("homephone.hook")

Listener = Callable[[bool], None]  # called with off_hook


class Hook:
    def __init__(self) -> None:
        self._listeners: list[Listener] = []
        self._off_hook = False

    @property
    def off_hook(self) -> bool:
        return self._off_hook

    def on_change(self, fn: Listener) -> None:
        self._listeners.append(fn)

    def _emit(self, off_hook: bool) -> None:
        if off_hook == self._off_hook:
            return
        self._off_hook = off_hook
        log.info("handset %s", "lifted" if off_hook else "hung up")
        for fn in self._listeners:
            fn(off_hook)

    def close(self) -> None:
        pass


class MockHook(Hook):
    """A hook switch you drive from code, the keyboard or the web page."""

    def set(self, off_hook: bool) -> None:
        self._emit(off_hook)

    def toggle(self) -> None:
        self._emit(not self._off_hook)


class GpioHook(Hook):
    def __init__(self, pin: int = 17, off_hook_when: str = "open", bounce: float = 0.05):
        super().__init__()
        from gpiozero import Button  # imported here so tests run without a Pi

        if off_hook_when not in {"open", "closed"}:
            raise ValueError("off_hook_when must be 'open' or 'closed'")
        self._button = Button(pin, pull_up=True, bounce_time=bounce)
        self._lift_when_closed = off_hook_when == "closed"
        # gpiozero calls these from its own thread; listeners must cope.
        self._button.when_pressed = lambda: self._emit(self._lift_when_closed)
        self._button.when_released = lambda: self._emit(not self._lift_when_closed)
        self._off_hook = self._button.is_pressed == self._lift_when_closed

    def close(self) -> None:
        self._button.close()
