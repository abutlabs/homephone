"""Handset and ringer audio.

The handset is a USB sound card: earpiece on the headphone jack, microphone on
the mic jack. The ringer is a second USB device (a small USB speaker). Keeping
them separate means the ring is loud in the room while call audio stays in the
earpiece.

Call audio is 48 kHz mono int16 in 10 ms frames (480 samples), which is what
LiveKit uses, so nothing needs resampling.

``Mock*`` classes stand in for the hardware so the whole phone runs on a
laptop or in CI: the mock microphone sends short pips, and the mock earpiece
measures how loud the incoming audio is.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Callable

import numpy as np

from . import tones

log = logging.getLogger("hearthline.audio")

RATE = 48_000
FRAME = 480  # 10 ms
MicCallback = Callable[[np.ndarray], None]  # int16 array of FRAME samples


def rms_level(pcm: np.ndarray) -> float:
    """0..1 loudness of an int16 buffer."""
    if pcm.size == 0:
        return 0.0
    return float(np.sqrt(np.mean((pcm.astype(np.float32) / 32768.0) ** 2)))


class _Jitter:
    """A small buffer between the network and the sound card."""

    def __init__(self, max_ms: int = 200):
        self._buf = bytearray()
        self._lock = threading.Lock()
        self._max = RATE * 2 * max_ms // 1000

    def push(self, data: bytes) -> None:
        with self._lock:
            self._buf.extend(data)
            if len(self._buf) > self._max:  # drop the oldest audio, keep latency low
                del self._buf[: len(self._buf) - self._max]

    def pull(self, nbytes: int) -> bytes:
        with self._lock:
            out = bytes(self._buf[:nbytes])
            del self._buf[:nbytes]
        return out + b"\x00" * (nbytes - len(out))


class Handset:
    """Interface. ``level`` is the loudness of what the caller hears (0..1)."""

    level: float = 0.0

    def play_tone(self, name: str) -> None: ...
    def stop_tone(self) -> None: ...
    def start_call_audio(self, on_mic: MicCallback) -> None: ...
    def play_call_audio(self, pcm: bytes) -> None: ...
    def stop_call_audio(self) -> None: ...
    def close(self) -> None:
        self.stop_tone()
        self.stop_call_audio()


class Ringer:
    ringing: bool = False

    def start(self) -> None: ...
    def stop(self) -> None: ...
    def close(self) -> None:
        self.stop()


# ---------------------------------------------------------------------------
# Real hardware (sounddevice / PortAudio over ALSA)
# ---------------------------------------------------------------------------


def find_device(name_hint: str | None, kind: str) -> int | str | None:
    """Pick a sound device by part of its name, e.g. 'USB Audio' or 'UACDemo'."""
    import sounddevice as sd

    if not name_hint:
        return None
    if name_hint.isdigit():
        return int(name_hint)
    key = "max_output_channels" if kind == "output" else "max_input_channels"
    for i, dev in enumerate(sd.query_devices()):
        if name_hint.lower() in dev["name"].lower() and dev[key] > 0:
            return i
    raise RuntimeError(f"no {kind} sound device matching '{name_hint}'. Run: python -m sounddevice")


class _Loop:
    """Plays an int16 buffer on repeat on one output device."""

    def __init__(self, device, pcm: np.ndarray):
        import sounddevice as sd

        self._pcm = pcm
        self._pos = 0

        def cb(outdata, frames, _time, _status):
            out = np.empty(frames, dtype=np.int16)
            filled = 0
            while filled < frames:
                n = min(frames - filled, len(self._pcm) - self._pos)
                out[filled : filled + n] = self._pcm[self._pos : self._pos + n]
                filled += n
                self._pos = (self._pos + n) % len(self._pcm)
            outdata[:, 0] = out

        self._stream = sd.OutputStream(
            device=device, samplerate=RATE, channels=1, dtype="int16", callback=cb
        )
        self._stream.start()

    def close(self) -> None:
        self._stream.stop()
        self._stream.close()


class SoundDeviceHandset(Handset):
    def __init__(self, device_hint: str | None = None):
        self.out_dev = find_device(device_hint, "output")
        self.in_dev = find_device(device_hint, "input")
        self._tone: _Loop | None = None
        self._stream = None
        self._jitter = _Jitter()

    def play_tone(self, name: str) -> None:
        self.stop_tone()
        self._tone = _Loop(self.out_dev, tones.TONES[name]())

    def stop_tone(self) -> None:
        if self._tone:
            self._tone.close()
            self._tone = None

    def start_call_audio(self, on_mic: MicCallback) -> None:
        import sounddevice as sd

        self.stop_tone()  # ALSA devices are usually single-stream
        self._jitter = _Jitter()

        def cb(indata, outdata, frames, _time, _status):
            on_mic(indata[:, 0].copy())
            data = self._jitter.pull(frames * 2)
            pcm = np.frombuffer(data, dtype=np.int16)
            self.level = 0.8 * self.level + 0.2 * rms_level(pcm)
            outdata[:, 0] = pcm

        self._stream = sd.Stream(
            device=(self.in_dev, self.out_dev),
            samplerate=RATE,
            blocksize=FRAME,
            channels=1,
            dtype="int16",
            callback=cb,
        )
        self._stream.start()

    def play_call_audio(self, pcm: bytes) -> None:
        self._jitter.push(pcm)

    def stop_call_audio(self) -> None:
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        self.level = 0.0


class SoundDeviceRinger(Ringer):
    def __init__(self, device_hint: str | None = None):
        self.dev = find_device(device_hint, "output")
        self._loop: _Loop | None = None

    def start(self) -> None:
        if not self._loop:
            self._loop = _Loop(self.dev, tones.bell())
            self.ringing = True

    def stop(self) -> None:
        if self._loop:
            self._loop.close()
            self._loop = None
        self.ringing = False


# ---------------------------------------------------------------------------
# Mocks
# ---------------------------------------------------------------------------


class MockHandset(Handset):
    def __init__(self) -> None:
        self.tone: str | None = None
        self.received_bytes = 0
        self.sent_frames = 0
        self.peak_level = 0.0  # loudest incoming frame, for tests
        self._task: asyncio.Task | None = None

    def play_tone(self, name: str) -> None:
        if name not in tones.TONES:
            raise KeyError(name)
        self.tone = name
        log.info("[mock earpiece] %s tone", name)

    def stop_tone(self) -> None:
        self.tone = None

    def start_call_audio(self, on_mic: MicCallback) -> None:
        self.stop_tone()
        pips = tones.test_pips()

        async def mic() -> None:
            pos = 0
            loop = asyncio.get_running_loop()
            next_t = loop.time()
            while True:
                frame = np.take(pips, range(pos, pos + FRAME), mode="wrap")
                pos = (pos + FRAME) % len(pips)
                on_mic(frame)
                self.sent_frames += 1
                next_t += FRAME / RATE
                await asyncio.sleep(max(0, next_t - loop.time()))

        self._task = asyncio.get_running_loop().create_task(mic())

    def play_call_audio(self, pcm: bytes) -> None:
        self.received_bytes += len(pcm)
        frame_level = rms_level(np.frombuffer(pcm, dtype=np.int16))
        self.peak_level = max(self.peak_level, frame_level)
        self.level = 0.8 * self.level + 0.2 * frame_level

    def stop_call_audio(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        self.level = 0.0


class MockRinger(Ringer):
    def start(self) -> None:
        if not self.ringing:
            log.info("[mock ringer] brrring brrring")
        self.ringing = True

    def stop(self) -> None:
        self.ringing = False
