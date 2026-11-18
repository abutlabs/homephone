import asyncio

import pytest

from hearthline.phone.audio import MockHandset, MockRinger
from hearthline.phone.controller import PhoneController, State
from hearthline.phone.hook import MockHook
from hearthline.phone.media import FakeMedia


class Phone:
    def __init__(self, default_call="laptop"):
        self.hook = MockHook()
        self.handset = MockHandset()
        self.ringer = MockRinger()
        self.media = FakeMedia()
        self.sent = []

        async def send(type_, **fields):
            self.sent.append((type_, fields))

        self.ctl = PhoneController(self.hook, self.handset, self.ringer, self.media, send,
                                   default_call=default_call, dial_delay=0.01)

    def types(self):
        return [t for t, _ in self.sent if t != "status"]

    async def lift(self):
        self.hook._off_hook = True
        await self.ctl.on_hook(True)

    async def hang_up(self):
        self.hook._off_hook = False
        await self.ctl.on_hook(False)


async def test_lift_dials_default_household():
    p = Phone()
    await p.lift()
    assert p.ctl.state == State.DIALING and p.handset.tone == "dial"
    await asyncio.sleep(0.05)
    assert ("call", {"to": "laptop"}) in p.sent

    await p.ctl.on_message({"type": "calling", "call_id": "c1", "url": "ws://lk", "token": "t", "room": "r"})
    assert p.ctl.state == State.CALLING and p.handset.tone == "ringback"
    assert p.media.joined == [("ws://lk", "t")]

    await p.ctl.on_message({"type": "answered", "call_id": "c1", "by": "Laptop"})
    assert p.ctl.state == State.IN_CALL and p.handset.tone is None
    assert p.media.audio_started == 1

    await p.hang_up()
    assert ("hangup", {"call_id": "c1"}) in p.sent
    assert p.ctl.state == State.IDLE and p.media.left == 1


async def test_incoming_call_rings_and_lift_answers():
    p = Phone()
    await p.ctl.on_message({"type": "ring", "call_id": "c2", "room": "r", "from": {"name": "Laptop"}})
    assert p.ctl.state == State.RINGING and p.ringer.ringing
    await p.lift()
    assert not p.ringer.ringing and ("answer", {"call_id": "c2"}) in p.sent
    await p.ctl.on_message({"type": "join", "call_id": "c2", "url": "ws://lk", "token": "t2", "room": "r"})
    assert p.ctl.state == State.IN_CALL and p.media.joined == [("ws://lk", "t2")]

    await p.ctl.on_message({"type": "ended", "call_id": "c2", "reason": "hung_up"})
    assert p.ctl.state == State.ENDED and p.handset.tone == "busy" and p.media.left == 1
    await p.hang_up()
    assert p.ctl.state == State.IDLE and p.handset.tone is None


async def test_ring_stops_when_answered_elsewhere():
    p = Phone()
    await p.ctl.on_message({"type": "ring", "call_id": "c3", "room": "r", "from": {}})
    await p.ctl.on_message({"type": "stop_ring", "call_id": "c3", "reason": "answered_elsewhere"})
    assert p.ctl.state == State.IDLE and not p.ringer.ringing


async def test_busy_phone_declines_second_call():
    p = Phone(default_call=None)
    await p.lift()
    await p.ctl.on_message({"type": "ring", "call_id": "c4", "room": "r", "from": {}})
    assert ("hangup", {"call_id": "c4"}) in p.sent and not p.ringer.ringing


async def test_nobody_home_gives_busy_tone():
    p = Phone()
    await p.lift()
    await p.ctl.on_message({"type": "ended", "call_id": "x", "reason": "unavailable"})
    assert p.ctl.state == State.ENDED and p.handset.tone == "busy"


async def test_hang_up_during_dial_tone_cancels_call():
    p = Phone()
    p.ctl.dial_delay = 0.2
    await p.lift()
    await p.hang_up()
    await asyncio.sleep(0.3)
    assert "call" not in p.types() and p.ctl.state == State.IDLE


async def test_losing_server_drops_call():
    p = Phone()
    await p.ctl.on_message({"type": "ring", "call_id": "c5", "room": "r", "from": {}})
    await p.ctl.on_disconnect()
    assert p.ctl.state == State.IDLE and not p.ringer.ringing
