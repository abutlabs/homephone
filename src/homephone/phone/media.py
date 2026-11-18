"""Call media over LiveKit (WebRTC).

``LiveKitMedia`` joins the call's room, publishes the handset microphone and
plays everything it hears into the earpiece. ``FakeMedia`` records what the
controller asked for, for tests.
"""

from __future__ import annotations

import asyncio
import logging

import numpy as np

from .audio import FRAME, RATE, Handset

log = logging.getLogger("homephone.media")


class Media:
    async def join(self, url: str, token: str) -> None: ...
    def start_audio(self) -> None: ...
    async def leave(self) -> None: ...


class LiveKitMedia(Media):
    def __init__(self, handset: Handset):
        self.handset = handset
        self.room = None
        self._source = None
        self._tasks: set[asyncio.Task] = set()
        self._mic_queue: asyncio.Queue[np.ndarray] | None = None

    async def join(self, url: str, token: str) -> None:
        from livekit import rtc

        await self.leave()
        loop = asyncio.get_running_loop()
        room = rtc.Room(loop=loop)
        self.room = room

        @room.on("track_subscribed")
        def _on_track(track, _pub, participant):
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                log.info("hearing %s", participant.identity)
                self._spawn(self._play(track))

        @room.on("disconnected")
        def _on_disconnect(*_):
            log.info("left room")

        await room.connect(url, token)
        self._source = rtc.AudioSource(RATE, 1)
        track = rtc.LocalAudioTrack.create_audio_track("handset", self._source)
        opts = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await room.local_participant.publish_track(track, opts)
        log.info("joined room %s", room.name)

    def start_audio(self) -> None:
        """Open the handset's mic and earpiece for the call."""
        if self._source is None or self._mic_queue is not None:
            return
        loop = asyncio.get_running_loop()
        q: asyncio.Queue[np.ndarray] = asyncio.Queue(maxsize=50)
        self._mic_queue = q

        def on_mic(pcm: np.ndarray) -> None:  # may run on the audio thread
            def put() -> None:
                if q.full():
                    q.get_nowait()
                q.put_nowait(pcm)

            loop.call_soon_threadsafe(put)

        self.handset.start_call_audio(on_mic)
        self._spawn(self._pump_mic(q))

    async def _pump_mic(self, q: asyncio.Queue[np.ndarray]) -> None:
        from livekit import rtc

        while True:
            pcm = await q.get()
            frame = rtc.AudioFrame(pcm.astype(np.int16).tobytes(), RATE, 1, FRAME)
            await self._source.capture_frame(frame)  # type: ignore[union-attr]

    async def _play(self, track) -> None:
        from livekit import rtc

        stream = rtc.AudioStream(track, sample_rate=RATE, num_channels=1)
        try:
            async for event in stream:
                self.handset.play_call_audio(bytes(event.frame.data))
        finally:
            await stream.aclose()

    def _spawn(self, coro) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def leave(self) -> None:
        for t in list(self._tasks):
            t.cancel()
        self._tasks.clear()
        self._mic_queue = None
        self.handset.stop_call_audio()
        if self.room is not None:
            try:
                await self.room.disconnect()
            except Exception:
                log.exception("disconnect failed")
            self.room = None
        self._source = None


class FakeMedia(Media):
    def __init__(self) -> None:
        self.joined: list[tuple[str, str]] = []
        self.audio_started = 0
        self.left = 0
        self.in_room = False

    async def join(self, url: str, token: str) -> None:
        self.joined.append((url, token))
        self.in_room = True

    def start_audio(self) -> None:
        self.audio_started += 1

    async def leave(self) -> None:
        if self.in_room:
            self.left += 1
        self.in_room = False
