"""A real peer-to-peer call between two mock phones on this machine, with no
media server. Both SDPs go through the compact codec in packages/protocol
(the form that travels over the Statement Store), so this also proves that
aiortc accepts the rebuilt SDP.

Skipped if aiortc or Node 22.18+ isn't installed.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
from pathlib import Path

import pytest

pytest.importorskip("aiortc")

from homephone.phone.audio import MockHandset  # noqa: E402
from homephone.phone.webrtc import WebRtcMedia  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "packages" / "protocol" / "bin" / "sdp.ts"


def node_bin() -> str | None:
    node = os.environ.get("HOMEPHONE_NODE") or shutil.which("node")
    if not node:
        return None
    out = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip().lstrip("v")
    major, minor = (int(x) for x in out.split(".")[:2])
    return node if (major, minor) >= (22, 18) else None


NODE = node_bin()
needs_node = pytest.mark.skipif(
    NODE is None or not (ROOT / "node_modules").exists(),
    reason="needs Node 22.18+ and `npm install` (set HOMEPHONE_NODE to pick a binary)",
)


def squeeze(sdp: str) -> tuple[str, int]:
    """Full SDP -> compact -> full again, as the far end would rebuild it."""
    def run(cmd: str, data: str) -> str:
        return subprocess.run([NODE, str(CLI), cmd], input=data, capture_output=True, text=True, check=True).stdout

    return run("expand", run("compact", sdp)), int(run("size", sdp))


async def wait_until(cond, timeout=10.0):
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while not cond():
        if loop.time() > end:
            raise TimeoutError
        await asyncio.sleep(0.05)


@needs_node
async def test_two_phones_talk_peer_to_peer_through_compact_sdp():
    a_handset, b_handset = MockHandset(), MockHandset()
    a, b = WebRtcMedia(a_handset), WebRtcMedia(b_handset)
    try:
        offer = await a.create_offer()
        offer_rebuilt, offer_size = squeeze(offer)
        assert offer_size <= 512, f"sealed offer is {offer_size} bytes of statement JSON"

        answer = await b.accept_offer(offer_rebuilt)
        answer_rebuilt, answer_size = squeeze(answer)
        assert answer_size <= 512
        await a.accept_answer(answer_rebuilt)

        await wait_until(lambda: a.state == "connected" and b.state == "connected")
        a.start_audio()
        b.start_audio()
        # Each mock mic plays test pips; each earpiece should hear them.
        await wait_until(lambda: a_handset.peak_level > 0.05 and b_handset.peak_level > 0.05)
        assert a_handset.received_bytes > 0 and b_handset.received_bytes > 0
    finally:
        await a.leave()
        await b.leave()
