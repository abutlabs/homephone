"""Peer-to-peer call audio over WebRTC (aiortc).

This replaces LiveKit from milestone 2: there is no media server, only the two
ends of the call (and a TURN relay if the networks can't reach each other).

The phone never trickles ICE. ``create_offer`` and ``accept_offer`` return the
SDP only after candidate gathering has finished, so one message carries
everything, which suits the Statement Store's small, unordered messages.

Audio: the handset delivers 10 ms frames of 48 kHz mono int16. We send 20 ms
frames, Opus's usual size. Before ``start_audio`` (while ringing or hearing
ringback) we send silence, so the connection is up and the first words
aren't lost when the handset is lifted.
"""

from __future__ import annotations

import asyncio
import fractions
import logging
from typing import Callable

import numpy as np

from .audio import FRAME, RATE, Handset

log = logging.getLogger("homephone.webrtc")

SEND_SAMPLES = 2 * FRAME  # 20 ms
GATHER_TIMEOUT = 10.0


def _aiortc():
    import aiortc  # optional dependency: pip install homephone[webrtc]

    return aiortc


class _HandsetTrack:
    """An aiortc audio track fed by the handset microphone."""

    def __new__(cls, *args, **kwargs):
        # Subclass aiortc's MediaStreamTrack lazily so importing this module
        # doesn't require aiortc.
        base = _aiortc().MediaStreamTrack

        class HandsetTrack(base):  # type: ignore[misc, valid-type]
            kind = "audio"

            def __init__(self) -> None:
                super().__init__()
                self.queue: asyncio.Queue[np.ndarray] = asyncio.Queue(maxsize=50)
                self.live = False
                self._buf = np.zeros(0, dtype=np.int16)
                self._pts = 0
                self._next: float | None = None

            def push(self, pcm: np.ndarray) -> None:
                if self.queue.full():
                    self.queue.get_nowait()
                self.queue.put_nowait(pcm)

            async def recv(self):
                import av

                loop = asyncio.get_running_loop()
                if self.live:
                    while len(self._buf) < SEND_SAMPLES:
                        self._buf = np.concatenate([self._buf, await self.queue.get()])
                    samples, self._buf = self._buf[:SEND_SAMPLES], self._buf[SEND_SAMPLES:]
                    self._next = None
                else:
                    # Silence, paced in real time.
                    now = loop.time()
                    self._next = (self._next or now) + SEND_SAMPLES / RATE
                    await asyncio.sleep(max(0.0, self._next - now))
                    samples = np.zeros(SEND_SAMPLES, dtype=np.int16)
                frame = av.AudioFrame.from_ndarray(samples.reshape(1, -1), format="s16", layout="mono")
                frame.sample_rate = RATE
                frame.pts = self._pts
                frame.time_base = fractions.Fraction(1, RATE)
                self._pts += SEND_SAMPLES
                return frame

        return HandsetTrack(*args, **kwargs)


class WebRtcMedia:
    """One call's WebRTC connection, between this handset and the far end."""

    def __init__(self, handset: Handset, ice_servers: list[dict] | None = None):
        self.handset = handset
        self.ice_servers = ice_servers or []
        self.pc = None
        self.on_state: Callable[[str], None] | None = None
        self._track = None
        self._audio_on = False
        self._tasks: set[asyncio.Task] = set()

    # ---- setting up the connection ---------------------------------------
    def _new_pc(self):
        ai = _aiortc()
        servers = [ai.RTCIceServer(**s) for s in self.ice_servers]
        pc = ai.RTCPeerConnection(ai.RTCConfiguration(iceServers=servers))
        self._track = _HandsetTrack()
        pc.addTransceiver(self._track, direction="sendrecv")

        @pc.on("track")
        def _on_track(track):
            if track.kind == "audio":
                self._spawn(self._play(track))

        @pc.on("connectionstatechange")
        async def _on_state():
            log.info("connection %s", pc.connectionState)
            if self.on_state:
                self.on_state(pc.connectionState)

        self.pc = pc
        return pc

    async def _local_sdp(self) -> str:
        pc = self.pc
        assert pc is not None
        # aiortc gathers all candidates inside setLocalDescription; wait anyway
        # in case that changes.
        for _ in range(int(GATHER_TIMEOUT * 10)):
            if pc.iceGatheringState == "complete":
                break
            await asyncio.sleep(0.1)
        return pc.localDescription.sdp

    async def create_offer(self) -> str:
        await self.leave()
        pc = self._new_pc()
        await pc.setLocalDescription(await pc.createOffer())
        return await self._local_sdp()

    async def accept_offer(self, sdp: str) -> str:
        ai = _aiortc()
        await self.leave()
        pc = self._new_pc()
        await pc.setRemoteDescription(ai.RTCSessionDescription(sdp=sdp, type="offer"))
        await pc.setLocalDescription(await pc.createAnswer())
        return await self._local_sdp()

    async def accept_answer(self, sdp: str) -> None:
        ai = _aiortc()
        if self.pc is None:
            raise RuntimeError("no offer outstanding")
        await self.pc.setRemoteDescription(ai.RTCSessionDescription(sdp=sdp, type="answer"))

    @property
    def state(self) -> str:
        return self.pc.connectionState if self.pc else "closed"

    # ---- audio -------------------------------------------------------------
    def start_audio(self) -> None:
        """Connect the handset: its mic goes out, the far end goes to the earpiece."""
        if self._audio_on or self._track is None:
            return
        self._audio_on = True
        loop = asyncio.get_running_loop()
        track = self._track

        def on_mic(pcm: np.ndarray) -> None:  # may run on the audio thread
            loop.call_soon_threadsafe(track.push, pcm)

        track.live = True
        self.handset.start_call_audio(on_mic)

    async def _play(self, track) -> None:
        import av

        resampler = av.AudioResampler(format="s16", layout="mono", rate=RATE)
        while True:
            try:
                frame = await track.recv()
            except Exception:  # MediaStreamError when the call ends
                return
            if not self._audio_on:
                continue
            for out in resampler.resample(frame):
                self.handset.play_call_audio(out.to_ndarray().tobytes())

    def _spawn(self, coro) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def leave(self) -> None:
        for t in list(self._tasks):
            t.cancel()
        self._tasks.clear()
        if self._audio_on:
            self.handset.stop_call_audio()
        self._audio_on = False
        if self.pc is not None:
            pc, self.pc = self.pc, None
            await pc.close()
        self._track = None
