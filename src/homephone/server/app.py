"""The ringing server.

A small FastAPI app that

* serves the laptop test client (``/``),
* keeps one WebSocket per device (``/ws``) and checks who it is,
* rings every device in a household when someone calls it, and
* hands out LiveKit tokens for the call's room.

Calls are 1:1 between the caller and whoever picks up first. Audio goes
through LiveKit, never through this server.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import secrets
from dataclasses import dataclass, field
from importlib import resources
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

from ..identity import verify_hello
from ..protocol import decode, encode
from .households import Directory, valid_household_id
from .tokens import make_token

log = logging.getLogger("homephone.server")


@dataclass
class ServerConfig:
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    web_key: str = field(default_factory=lambda: secrets.token_urlsafe(12))
    ring_timeout: float = 45.0
    # Dev only: phones that name a household in their hello join it
    # automatically. Off by default; the Docker test setup turns it on.
    auto_enroll: bool = False
    # Dev only: lets the web page lift and hang up mock phones.
    allow_mock_control: bool = True


@dataclass(eq=False)
class Conn:
    ws: WebSocket
    id: int
    kind: str = ""
    household: str = ""
    name: str = ""
    address: str = ""
    mock: bool = False
    call_id: str | None = None
    status: dict[str, Any] = field(default_factory=dict)

    @property
    def identity(self) -> str:
        return f"phone:{self.address}" if self.kind == "phone" else f"web:{self.id}"

    async def send(self, type_: str, **fields: Any) -> None:
        try:
            await self.ws.send_text(encode(type_, **fields))
        except Exception:  # connection already gone
            pass


@dataclass(eq=False)
class Call:
    id: str
    room: str
    caller: Conn
    to: str
    ringing: set[Conn] = field(default_factory=set)
    answerer: Conn | None = None
    timeout: asyncio.Task | None = None

    @property
    def members(self) -> list[Conn]:
        return [c for c in (self.caller, self.answerer) if c is not None]


class Hub:
    def __init__(self, config: ServerConfig, directory: Directory):
        self.config = config
        self.directory = directory
        self.conns: set[Conn] = set()
        self.calls: dict[str, Call] = {}
        self._ids = itertools.count(1)

    # ---- helpers --------------------------------------------------------
    def token_for(self, conn: Conn, room: str) -> str:
        return make_token(
            self.config.livekit_api_key,
            self.config.livekit_api_secret,
            room,
            conn.identity,
            conn.name or conn.identity,
        )

    def household_conns(self, hid: str) -> list[Conn]:
        return [c for c in self.conns if c.household == hid and c.kind]

    async def broadcast_phones(self) -> None:
        phones = [
            {
                "address": c.address,
                "name": c.name,
                "household": c.household,
                "mock": c.mock,
                **c.status,
            }
            for c in self.conns
            if c.kind == "phone"
        ]
        for c in list(self.conns):
            if c.kind == "web":
                await c.send("phones", phones=phones)

    # ---- connection lifecycle ---------------------------------------------
    async def handle(self, ws: WebSocket) -> None:
        await ws.accept()
        conn = Conn(ws, next(self._ids))
        nonce = secrets.token_hex(16)
        await conn.send("challenge", nonce=nonce)
        try:
            hello = decode(await asyncio.wait_for(ws.receive_text(), 15))
            if not await self.authenticate(conn, hello, nonce):
                await ws.close()
                return
            self.conns.add(conn)
            log.info("%s %s joined household %s", conn.kind, conn.name, conn.household)
            await conn.send(
                "welcome",
                household=conn.household,
                households=self.directory.summary(),
                mock=conn.mock,
                livekit_url=self.config.livekit_url,
            )
            await self.broadcast_phones()
            while True:
                msg = decode(await ws.receive_text())
                await self.dispatch(conn, msg)
        except (WebSocketDisconnect, asyncio.TimeoutError):
            pass
        except Exception:
            log.exception("connection %s failed", conn.id)
        finally:
            await self.disconnect(conn)

    async def authenticate(self, conn: Conn, hello: dict, nonce: str) -> bool:
        if hello.get("type") != "hello":
            await conn.send("error", message="expected hello")
            return False
        kind = hello.get("kind")
        conn.name = str(hello.get("name") or kind or "device")[:40]
        if kind == "web":
            # Laptop test client: a shared key printed when the server starts.
            if not secrets.compare_digest(str(hello.get("key", "")), self.config.web_key):
                await conn.send("error", message="wrong web key")
                return False
            hid = str(hello.get("household") or "laptop")
            if not valid_household_id(hid):
                await conn.send("error", message="bad household id")
                return False
            self.directory.ensure_household(hid)
            conn.kind, conn.household = "web", hid
            return True
        if kind == "phone":
            address = str(hello.get("address", ""))
            if not verify_hello(address, nonce, str(hello.get("signature", ""))):
                await conn.send("error", message="bad signature")
                return False
            conn.address = address
            conn.mock = bool(hello.get("mock"))
            household = self.directory.household_of(address)
            wanted = hello.get("household")
            if household is None and self.config.auto_enroll and wanted:
                if not valid_household_id(str(wanted)):
                    await conn.send("error", message="bad household id")
                    return False
                household = self.directory.enroll(str(wanted), address, conn.name)
            if household is None:
                await conn.send(
                    "error",
                    message=f"unknown phone {address}: add it with "
                    f"'homephone-server enroll --household <id> --address {address}'",
                )
                return False
            conn.kind, conn.household = "phone", household.id
            return True
        await conn.send("error", message="unknown kind")
        return False

    async def disconnect(self, conn: Conn) -> None:
        if conn not in self.conns:
            return
        self.conns.discard(conn)
        for call in list(self.calls.values()):
            if conn in call.members:
                await self.end_call(call, "hung_up", by=conn)
            elif conn in call.ringing:
                call.ringing.discard(conn)
                if not call.ringing and call.answerer is None:
                    await self.end_call(call, "unavailable")
        await self.broadcast_phones()

    # ---- call handling ----------------------------------------------------
    async def dispatch(self, conn: Conn, msg: dict) -> None:
        t = msg["type"]
        if t == "call":
            await self.place_call(conn, str(msg.get("to", "")))
        elif t == "answer":
            await self.answer(conn, str(msg.get("call_id", "")))
        elif t == "hangup":
            call = self.calls.get(str(msg.get("call_id", "")))
            if call and (conn in call.members or conn in call.ringing):
                if conn in call.ringing and call.answerer is None:
                    # Declining only stops this device; others keep ringing.
                    call.ringing.discard(conn)
                    await conn.send("stop_ring", call_id=call.id, reason="declined")
                    if not call.ringing:
                        await self.end_call(call, "declined")
                else:
                    await self.end_call(call, "hung_up", by=conn)
        elif t == "status" and conn.kind == "phone":
            conn.status = {
                "state": str(msg.get("state", "")),
                "off_hook": bool(msg.get("off_hook")),
                "audio_level": float(msg.get("audio_level", 0.0)),
            }
            await self.broadcast_phones()
        elif t == "mock_hook" and conn.kind == "web" and self.config.allow_mock_control:
            target = next(
                (c for c in self.conns if c.kind == "phone" and c.mock
                 and c.address == msg.get("address")),
                None,
            )
            if target:
                await target.send("mock_hook", off_hook=bool(msg.get("off_hook")))
        else:
            await conn.send("error", message=f"unexpected {t}")

    async def place_call(self, caller: Conn, to: str) -> None:
        if caller.call_id:
            await caller.send("error", message="already in a call")
            return
        if self.directory.get(to) is None:
            await caller.send("ended", call_id=None, reason="no_such_household")
            return
        targets = [c for c in self.household_conns(to) if c is not caller and not c.call_id]
        call_id = secrets.token_hex(6)
        if not targets:
            await caller.send("ended", call_id=call_id, reason="unavailable")
            return
        call = Call(call_id, f"call-{call_id}", caller, to, ringing=set(targets))
        self.calls[call_id] = call
        caller.call_id = call_id
        await caller.send(
            "calling",
            call_id=call_id,
            to=to,
            room=call.room,
            url=self.config.livekit_url,
            token=self.token_for(caller, call.room),
        )
        from_info = {"household": caller.household, "name": caller.name}
        for t in targets:
            await t.send("ring", call_id=call_id, room=call.room, **{"from": from_info})
        call.timeout = asyncio.create_task(self._ring_timeout(call))
        log.info("call %s: %s -> %s (%d devices)", call_id, caller.name, to, len(targets))

    async def _ring_timeout(self, call: Call) -> None:
        await asyncio.sleep(self.config.ring_timeout)
        if call.answerer is None and call.id in self.calls:
            await self.end_call(call, "no_answer")

    async def answer(self, conn: Conn, call_id: str) -> None:
        call = self.calls.get(call_id)
        if not call or conn not in call.ringing:
            await conn.send("stop_ring", call_id=call_id, reason="gone")
            return
        if call.answerer is not None:
            await conn.send("stop_ring", call_id=call_id, reason="answered_elsewhere")
            return
        call.answerer = conn
        conn.call_id = call_id
        call.ringing.discard(conn)
        if call.timeout:
            call.timeout.cancel()
        await conn.send(
            "join",
            call_id=call_id,
            room=call.room,
            url=self.config.livekit_url,
            token=self.token_for(conn, call.room),
        )
        await call.caller.send("answered", call_id=call_id, by=conn.name)
        for other in call.ringing:
            await other.send("stop_ring", call_id=call_id, reason="answered_elsewhere")
        call.ringing.clear()

    async def end_call(self, call: Call, reason: str, by: Conn | None = None) -> None:
        if self.calls.pop(call.id, None) is None:
            return
        if call.timeout and call.timeout is not asyncio.current_task():
            call.timeout.cancel()
        for c in call.ringing:
            await c.send("stop_ring", call_id=call.id, reason=reason)
        for c in call.members:
            c.call_id = None
            if c is not by:
                await c.send("ended", call_id=call.id, reason=reason)
        log.info("call %s ended: %s", call.id, reason)


def create_app(config: ServerConfig, directory: Directory) -> FastAPI:
    app = FastAPI(title="Homephone ringing server")
    hub = Hub(config, directory)
    app.state.hub = hub
    web = resources.files("homephone") / "web"

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(str(web / "index.html"))

    @app.get("/static/{name}")
    async def static(name: str):
        if name not in {"app.js", "style.css", "ring.js"}:
            return JSONResponse({"error": "not found"}, status_code=404)
        return FileResponse(str(web / name))

    @app.get("/api/health")
    async def health() -> dict:
        return {
            "ok": True,
            "devices": len(hub.conns),
            "calls": len(hub.calls),
            "households": directory.summary(),
        }

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        await hub.handle(ws)

    return app
