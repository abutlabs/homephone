import json

import pytest
from fastapi.testclient import TestClient

from homephone.identity import DeviceIdentity
from homephone.server.app import create_app


def recv(ws):
    return json.loads(ws.receive_text())


def recv_type(ws, type_):
    """Receive until a message of this type arrives (skipping dashboard updates)."""
    for _ in range(20):
        msg = recv(ws)
        if msg["type"] == type_:
            return msg
    raise AssertionError(f"no {type_}")


def hello_web(ws, household="laptop", key="test-key"):
    ch = recv(ws)
    ws.send_text(json.dumps({"type": "hello", "kind": "web", "key": key, "household": household, "name": "Laptop"}))
    return recv(ws)


def hello_phone(ws, ident, **extra):
    ch = recv(ws)
    ws.send_text(json.dumps({
        "type": "hello", "kind": "phone", "name": ident.name, "address": ident.address,
        "signature": ident.sign_hello(ch["nonce"]), **extra,
    }))
    return recv(ws)


@pytest.fixture
def client(config, directory):
    return TestClient(create_app(config, directory))


def test_health_and_index(client):
    assert client.get("/api/health").json()["ok"] is True
    assert "Homephone" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/../app.py").status_code == 404


def test_web_needs_key(client):
    with client.websocket_connect("/ws") as ws:
        assert hello_web(ws, key="wrong")["type"] == "error"


def test_phone_signature_checked(client, phone_ident):
    with client.websocket_connect("/ws") as ws:
        recv(ws)
        ws.send_text(json.dumps({"type": "hello", "kind": "phone", "address": phone_ident.address, "signature": "0x00"}))
        assert recv(ws)["type"] == "error"


def test_unknown_phone_rejected_without_auto_enroll(client):
    with client.websocket_connect("/ws") as ws:
        msg = hello_phone(ws, DeviceIdentity.generate(), household="home")
        assert msg["type"] == "error" and "enroll" in msg["message"]


def test_auto_enroll(config, directory):
    config.auto_enroll = True
    client = TestClient(create_app(config, directory))
    new = DeviceIdentity.generate("Attic phone")
    with client.websocket_connect("/ws") as ws:
        msg = hello_phone(ws, new, household="grandma")
        assert msg["type"] == "welcome" and msg["household"] == "grandma"
    assert directory.household_of(new.address).id == "grandma"


def test_phone_calls_laptop_and_laptop_answers(client, phone_ident):
    with client.websocket_connect("/ws") as laptop, client.websocket_connect("/ws") as phone:
        assert hello_web(laptop)["type"] == "welcome"
        assert hello_phone(phone, phone_ident)["household"] == "home"

        phone.send_text(json.dumps({"type": "call", "to": "laptop"}))
        calling = recv_type(phone, "calling")
        assert calling["url"] == "ws://livekit.test:7880" and calling["token"]
        ring = recv_type(laptop, "ring")
        assert ring["call_id"] == calling["call_id"]
        assert ring["from"] == {"household": "home", "name": "Kitchen phone"}

        laptop.send_text(json.dumps({"type": "answer", "call_id": ring["call_id"]}))
        join = recv_type(laptop, "join")
        assert join["room"] == calling["room"] and join["token"] != calling["token"]
        assert recv_type(phone, "answered")["by"] == "Laptop"

        phone.send_text(json.dumps({"type": "hangup", "call_id": ring["call_id"]}))
        assert recv_type(laptop, "ended")["reason"] == "hung_up"


def test_whole_household_rings_and_first_pickup_wins(client):
    with client.websocket_connect("/ws") as caller, \
         client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
        hello_web(caller, household="laptop")
        hello_web(a, household="family")
        hello_web(b, household="family")
        caller.send_text(json.dumps({"type": "call", "to": "family"}))
        call_id = recv_type(caller, "calling")["call_id"]
        assert recv_type(a, "ring")["call_id"] == call_id
        assert recv_type(b, "ring")["call_id"] == call_id
        b.send_text(json.dumps({"type": "answer", "call_id": call_id}))
        recv_type(b, "join")
        assert recv_type(a, "stop_ring")["reason"] == "answered_elsewhere"
        # A late pickup on the other phone gets told it is taken.
        a.send_text(json.dumps({"type": "answer", "call_id": call_id}))
        assert recv_type(a, "stop_ring")["call_id"] == call_id


def test_call_nobody_home(client):
    with client.websocket_connect("/ws") as laptop:
        hello_web(laptop)
        laptop.send_text(json.dumps({"type": "call", "to": "home"}))  # phone not connected
        assert recv_type(laptop, "ended")["reason"] == "unavailable"


async def test_decline_from_only_device_ends_call(config, directory, phone_ident):
    # A real server on one event loop. TestClient runs each websocket on its own
    # loop thread, so a ring sent from the laptop's handler to the phone's socket
    # never wakes the phone's handler, and this test used to hang.
    import asyncio

    import uvicorn
    import websockets

    from .test_end_to_end import free_port, wait_for

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(config, directory), port=port, log_level="warning"))
    task = asyncio.create_task(server.serve())
    await wait_for(lambda: server.started)

    async def until(ws, type_):
        for _ in range(20):
            msg = json.loads(await asyncio.wait_for(ws.recv(), 5))
            if msg["type"] == type_:
                return msg
        raise AssertionError(f"no {type_}")

    url = f"ws://127.0.0.1:{port}/ws"
    try:
        async with websockets.connect(url) as laptop, websockets.connect(url) as phone:
            await until(laptop, "challenge")
            await laptop.send(json.dumps({"type": "hello", "kind": "web", "key": "test-key", "household": "laptop", "name": "Laptop"}))
            await until(laptop, "welcome")
            ch = await until(phone, "challenge")
            await phone.send(json.dumps({
                "type": "hello", "kind": "phone", "name": phone_ident.name, "address": phone_ident.address,
                "signature": phone_ident.sign_hello(ch["nonce"]),
            }))
            await until(phone, "welcome")
            await laptop.send(json.dumps({"type": "call", "to": "home"}))
            ring = await until(phone, "ring")
            await phone.send(json.dumps({"type": "hangup", "call_id": ring["call_id"]}))
            assert (await until(laptop, "ended"))["reason"] == "declined"
    finally:
        server.should_exit = True
        await task


def test_mock_hook_forwarded_to_mock_phone(client, phone_ident):
    with client.websocket_connect("/ws") as laptop, client.websocket_connect("/ws") as phone:
        hello_web(laptop)
        hello_phone(phone, phone_ident, mock=True)
        phones = recv_type(laptop, "phones")["phones"]
        while not phones:
            phones = recv_type(laptop, "phones")["phones"]
        assert phones[0]["mock"] is True
        laptop.send_text(json.dumps({"type": "mock_hook", "address": phone_ident.address, "off_hook": True}))
        assert recv_type(phone, "mock_hook")["off_hook"] is True
