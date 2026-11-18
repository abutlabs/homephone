"""WebSocket link from the phone to the ringing server.

Connects, signs the server's challenge with the device's Polkadot key, then
passes every message to a handler. Reconnects with backoff if the network
drops.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

import websockets

from ..identity import DeviceIdentity
from ..protocol import decode, encode

log = logging.getLogger("hearthline.signaling")

Handler = Callable[[dict[str, Any]], Awaitable[None]]


class AuthError(Exception):
    pass


class Signaling:
    def __init__(
        self,
        url: str,
        identity: DeviceIdentity,
        name: str,
        household: str | None = None,
        mock: bool = False,
    ):
        self.url = url
        self.identity = identity
        self.name = name
        self.household = household
        self.mock = mock
        self._ws = None
        self.connected = asyncio.Event()

    async def send(self, type_: str, **fields: Any) -> None:
        if self._ws is None:
            log.warning("not connected; dropped %s", type_)
            return
        try:
            await self._ws.send(encode(type_, **fields))
        except websockets.ConnectionClosed:
            log.warning("connection closed; dropped %s", type_)

    async def run(self, handler: Handler, on_disconnect: Callable[[], Awaitable[None]] | None = None) -> None:
        delay = 1.0
        while True:
            try:
                async with websockets.connect(self.url, ping_interval=20) as ws:
                    challenge = decode(await ws.recv())
                    hello: dict[str, Any] = {
                        "kind": "phone",
                        "name": self.name,
                        "address": self.identity.address,
                        "signature": self.identity.sign_hello(challenge["nonce"]),
                        "mock": self.mock,
                    }
                    if self.household:
                        hello["household"] = self.household
                    await ws.send(encode("hello", **hello))
                    first = decode(await ws.recv())
                    if first["type"] == "error":
                        raise AuthError(first.get("message"))
                    self._ws = ws
                    self.connected.set()
                    delay = 1.0
                    log.info("connected to %s as %s", self.url, self.identity.address)
                    await handler(first)
                    async for raw in ws:
                        await handler(decode(raw))
            except AuthError as e:
                log.error("server refused this phone: %s", e)
                delay = 30.0
            except (OSError, websockets.WebSocketException) as e:
                log.warning("server unreachable (%s); retrying in %.0fs", e, delay)
            finally:
                was_connected = self._ws is not None
                self._ws = None
                self.connected.clear()
                if was_connected and on_disconnect:
                    await on_disconnect()
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)
