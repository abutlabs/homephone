"""Runs the real server, a mock phone (signed with its Polkadot key) and a
WebSocket 'laptop' together. Only the LiveKit audio is faked."""

import asyncio
import json
import socket

import pytest
import uvicorn
import websockets

from hearthline.phone.audio import MockHandset, MockRinger
from hearthline.phone.controller import PhoneController, State
from hearthline.phone.hook import MockHook
from hearthline.phone.media import FakeMedia
from hearthline.phone.signaling import Signaling
from hearthline.server.app import create_app


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


async def wait_for(cond, timeout=5.0):
    for _ in range(int(timeout / 0.02)):
        if cond():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("timed out")


class Laptop:
    def __init__(self, ws):
        self.ws = ws

    @classmethod
    async def connect(cls, url):
        ws = await websockets.connect(url)
        await ws.recv()
        await ws.send(json.dumps({"type": "hello", "kind": "web", "key": "test-key", "household": "laptop", "name": "Laptop"}))
        assert json.loads(await ws.recv())["type"] == "welcome"
        return cls(ws)

    async def expect(self, type_):
        while True:
            msg = json.loads(await asyncio.wait_for(self.ws.recv(), 5))
            if msg["type"] == type_:
                return msg

    async def send(self, type_, **f):
        await self.ws.send(json.dumps({"type": type_, **f}))


@pytest.fixture
async def stack(config, directory, phone_ident):
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(config, directory), port=port, log_level="warning"))
    srv_task = asyncio.create_task(server.serve())
    await wait_for(lambda: server.started)
    url = f"ws://127.0.0.1:{port}/ws"

    hook, media = MockHook(), FakeMedia()
    sig = Signaling(url, phone_ident, "Kitchen phone", mock=True)
    phone = PhoneController(hook, MockHandset(), MockRinger(), media, sig.send,
                            default_call="laptop", dial_delay=0.05)
    phone.attach(asyncio.get_running_loop())
    sig_task = asyncio.create_task(sig.run(phone.on_message, phone.on_disconnect))
    await asyncio.wait_for(sig.connected.wait(), 5)
    laptop = await Laptop.connect(url)
    yield phone, hook, media, laptop
    await laptop.ws.close()
    sig_task.cancel()
    server.should_exit = True
    await srv_task


async def test_pi_calls_laptop(stack):
    phone, hook, media, laptop = stack
    hook.set(True)  # lift the handset
    ring = await laptop.expect("ring")
    assert ring["from"]["name"] == "Kitchen phone"
    await wait_for(lambda: phone.state == State.CALLING and media.in_room)

    await laptop.send("answer", call_id=ring["call_id"])
    join = await laptop.expect("join")
    assert join["url"] == "ws://livekit.test:7880"
    await wait_for(lambda: phone.state == State.IN_CALL)

    hook.set(False)  # hang up
    assert (await laptop.expect("ended"))["reason"] == "hung_up"
    await wait_for(lambda: phone.state == State.IDLE and not media.in_room)


async def test_laptop_calls_pi_and_lifts_it_remotely(stack):
    phone, hook, media, laptop = stack
    await laptop.send("call", to="home")
    calling = await laptop.expect("calling")
    await wait_for(lambda: phone.state == State.RINGING)

    # The web page's "Lift handset" button for a mock phone:
    await laptop.send("mock_hook", address=phone_ident_address(phone), off_hook=True)
    answered = await laptop.expect("answered")
    assert answered["call_id"] == calling["call_id"]
    await wait_for(lambda: phone.state == State.IN_CALL and media.audio_started == 1)

    await laptop.send("hangup", call_id=calling["call_id"])
    await wait_for(lambda: phone.state == State.ENDED)  # busy tone, handset still up


def phone_ident_address(phone):
    # The Signaling object is bound to send(); recover the identity through it.
    return phone.send.__self__.identity.address
