"""A real call through a LiveKit server: two mock phones, real WebRTC.

Skipped unless HOMEPHONE_E2E_LIVEKIT_URL is set. The Docker test service
sets it:  docker compose --profile test run --rm test
"""

import asyncio
import os

import pytest

from homephone.identity import DeviceIdentity
from homephone.phone.audio import MockHandset, MockRinger
from homephone.phone.controller import PhoneController, State
from homephone.phone.hook import MockHook
from homephone.phone.media import LiveKitMedia
from homephone.phone.signaling import Signaling
from homephone.server.app import ServerConfig, create_app
from homephone.server.households import Directory, Household

from .test_end_to_end import free_port, wait_for

URL = os.environ.get("HOMEPHONE_E2E_LIVEKIT_URL")
pytestmark = pytest.mark.skipif(not URL, reason="needs a LiveKit server (see compose.yaml)")


async def test_two_phones_hear_each_other():
    import uvicorn

    a_id, b_id = DeviceIdentity.generate("Phone A"), DeviceIdentity.generate("Phone B")
    directory = Directory(households=[
        Household("house-a", "A", {a_id.address: "Phone A"}),
        Household("house-b", "B", {b_id.address: "Phone B"}),
    ])
    config = ServerConfig(URL, os.environ["HOMEPHONE_E2E_API_KEY"], os.environ["HOMEPHONE_E2E_API_SECRET"])
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(config, directory), port=port, log_level="warning"))
    srv = asyncio.create_task(server.serve())
    await wait_for(lambda: server.started)
    ws_url = f"ws://127.0.0.1:{port}/ws"

    phones, tasks = [], []
    for ident, target in ((a_id, "house-b"), (b_id, None)):
        hook, handset = MockHook(), MockHandset()
        sig = Signaling(ws_url, ident, ident.name)
        ctl = PhoneController(hook, handset, MockRinger(), LiveKitMedia(handset), sig.send,
                              default_call=target, dial_delay=0.05)
        ctl.attach(asyncio.get_running_loop())
        tasks.append(asyncio.create_task(sig.run(ctl.on_message, ctl.on_disconnect)))
        await asyncio.wait_for(sig.connected.wait(), 5)
        phones.append((ctl, hook, handset))
    (a, a_hook, a_set), (b, b_hook, b_set) = phones

    try:
        a_hook.set(True)                       # A lifts: rings house B
        await wait_for(lambda: b.state == State.RINGING, 10)
        b_hook.set(True)                       # B picks up
        await wait_for(lambda: a.state == State.IN_CALL and b.state == State.IN_CALL, 20)
        # Each mock mic sends pips; each earpiece should hear the other's.
        await wait_for(lambda: a_set.received_bytes > 48_000 and b_set.received_bytes > 48_000, 20)
        assert a_set.sent_frames > 0 and b_set.sent_frames > 0
        # Pips are sent at RMS ~0.14; anything well above silence proves audio flows.
        await wait_for(lambda: a_set.peak_level > 0.02 and b_set.peak_level > 0.02, 10)
        a_hook.set(False)                      # A hangs up
        await wait_for(lambda: b.state == State.ENDED, 10)
    finally:
        for t in tasks:
            t.cancel()
        for ctl, *_ in phones:
            await ctl.media.leave()
        server.should_exit = True
        await srv
