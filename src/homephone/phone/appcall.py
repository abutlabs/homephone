"""Calls with the Polkadot App's own call protocol (route A').

A call in the App starts as a WebRTC *data channel*: the offer and answer travel
as chat messages carrying ``MinimalSetup`` (handled by the Node sidecar, which
hands us full SDP text). Once the data channel is open, the caller adds audio
by sending a new SDP offer *over the data channel*, and we answer the same way.

Android's media offer always has a video section too, even for audio calls; we
answer it as ``inactive`` so the Pi never sends or decodes video.

Data-channel frames are SCALE-encoded (docs/linked-device-spec.md §3.4):

    DataChannelMessage   = { id: str, data: Bytes }
    PeerConnectionSignal = enum { 0 offer(str), 1 answer(str),
                                  2 candidates(Vec<{sdp: str, sdpMLineIndex: u32, sdpMid: Option<str>}>) }
    MediaStateSignal     = enum { 0 cameraEnabled(bool), 1 microphoneEnabled(bool) }
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Callable

from .audio import Handset
from .webrtc import _HandsetTrack, _aiortc

log = logging.getLogger("homephone.appcall")

RENEGOTIATION = "webrtc_renegotiation_internal_use_case"
MEDIA_STATE = "webrtc_media_state_use_case"


# ---- SCALE, just the parts these frames use ---------------------------------

def enc_compact(n: int) -> bytes:
    if n < 1 << 6:
        return bytes([n << 2])
    if n < 1 << 14:
        return ((n << 2) | 1).to_bytes(2, "little")
    if n < 1 << 30:
        return ((n << 2) | 2).to_bytes(4, "little")
    raw = n.to_bytes((n.bit_length() + 7) // 8, "little")
    return bytes([((len(raw) - 4) << 2) | 3]) + raw


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def take(self, n: int) -> bytes:
        if self.pos + n > len(self.data):
            raise ValueError("truncated SCALE data")
        out = self.data[self.pos : self.pos + n]
        self.pos += n
        return out

    def u8(self) -> int:
        return self.take(1)[0]

    def u32(self) -> int:
        return int.from_bytes(self.take(4), "little")

    def compact(self) -> int:
        b0 = self.data[self.pos] if self.pos < len(self.data) else None
        if b0 is None:
            raise ValueError("truncated SCALE data")
        mode = b0 & 3
        if mode == 0:
            return self.u8() >> 2
        if mode == 1:
            return int.from_bytes(self.take(2), "little") >> 2
        if mode == 2:
            return int.from_bytes(self.take(4), "little") >> 2
        n = (self.u8() >> 2) + 4
        return int.from_bytes(self.take(n), "little")

    def bytes_(self) -> bytes:
        return self.take(self.compact())

    def str_(self) -> str:
        return self.bytes_().decode()

    def done(self) -> None:
        if self.pos != len(self.data):
            raise ValueError("trailing SCALE data")


def enc_bytes(b: bytes) -> bytes:
    return enc_compact(len(b)) + b


def enc_str(s: str) -> bytes:
    return enc_bytes(s.encode())


@dataclass
class IceCandidateInit:
    candidate: str
    sdp_mline_index: int
    sdp_mid: str | None


def encode_frame(use_case: str, data: bytes) -> bytes:
    return enc_str(use_case) + enc_bytes(data)


def decode_frame(frame: bytes) -> tuple[str, bytes]:
    r = Reader(frame)
    use_case, data = r.str_(), r.bytes_()
    r.done()
    return use_case, data


def encode_signal(kind: str, value) -> bytes:
    if kind == "offer":
        return b"\x00" + enc_str(value)
    if kind == "answer":
        return b"\x01" + enc_str(value)
    if kind == "candidates":
        out = b"\x02" + enc_compact(len(value))
        for c in value:
            mid = b"\x00" if c.sdp_mid is None else b"\x01" + enc_str(c.sdp_mid)
            out += enc_str(c.candidate) + c.sdp_mline_index.to_bytes(4, "little") + mid
        return out
    raise ValueError(kind)


def decode_signal(data: bytes):
    r = Reader(data)
    tag = r.u8()
    if tag == 0:
        out = ("offer", r.str_())
    elif tag == 1:
        out = ("answer", r.str_())
    elif tag == 2:
        items = []
        for _ in range(r.compact()):
            cand = r.str_()
            index = r.u32()
            mid = r.str_() if r.u8() == 1 else None
            items.append(IceCandidateInit(cand, index, mid))
        out = ("candidates", items)
    else:
        raise ValueError(f"unknown PeerConnectionSignal {tag}")
    r.done()
    return out


def encode_media_state(microphone: bool) -> bytes:
    return b"\x01" + (b"\x01" if microphone else b"\x00")


def only_sha256_fingerprint(sdp: str) -> str:
    """Drops aiortc's sha-384 and sha-512 fingerprint lines.

    The first answer reached the caller through MinimalSetup, which carries only
    the sha-256 fingerprint. If a later SDP lists other fingerprints, libwebrtc
    can read one of those, decide our certificate changed, and restart DTLS,
    which drops the call. Found with headless Chrome (tests/test_appcall.py).
    """
    lines = sdp.split("\r\n")
    keep = [l for l in lines if not l.startswith("a=fingerprint:") or l.lower().startswith("a=fingerprint:sha-256 ")]
    return "\r\n".join(keep)


# ---- the call ----------------------------------------------------------------

class AppCall:
    """One App-protocol call, answered by (or placed from) this phone."""

    def __init__(self, handset: Handset, ice_servers: list[dict] | None = None):
        self.handset = handset
        # Same public STUN servers Polkadot Desktop uses, so we learn our public
        # address. TURN comes later (our own coturn); the phone brings its own.
        self.ice_servers = ice_servers if ice_servers is not None else [{"urls": ["stun:stun.l.google.com:19302"]}]
        self.pc = None
        self.channel = None
        self.on_state: Callable[[str], None] | None = None
        self.media_ready = asyncio.Event()
        self._track = None
        self._audio_on = False
        self._tasks: set[asyncio.Task] = set()

    def _new_pc(self):
        ai = _aiortc()
        servers = [ai.RTCIceServer(**s) for s in self.ice_servers]
        pc = ai.RTCPeerConnection(ai.RTCConfiguration(iceServers=servers, bundlePolicy=ai.RTCBundlePolicy.MAX_BUNDLE))

        @pc.on("datachannel")
        def _on_channel(channel):
            self._attach(channel)

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

    def _attach(self, channel) -> None:
        self.channel = channel

        @channel.on("message")
        def _on_message(message):
            if isinstance(message, (bytes, bytearray)):
                self._spawn(self._on_frame(bytes(message)))

    # ---- phase 1: the data channel ------------------------------------------
    async def answer(self, offer_sdp: str) -> str:
        """Answers the caller's data-channel offer. Returns our answer SDP (all candidates inline)."""
        ai = _aiortc()
        await self.close()
        pc = self._new_pc()
        await pc.setRemoteDescription(ai.RTCSessionDescription(sdp=offer_sdp, type="offer"))
        await pc.setLocalDescription(await pc.createAnswer())
        return pc.localDescription.sdp

    async def add_remote_candidates(self, lines: list[str]) -> None:
        """Trickled candidates from the caller (chat `dataChannelIceCandidate`)."""
        for line in lines:
            await self._add_candidate(IceCandidateInit(line, 0, "0"))

    async def _add_candidate(self, c: IceCandidateInit) -> None:
        from aiortc.sdp import candidate_from_sdp

        text = c.candidate.removeprefix("a=").removeprefix("candidate:").strip()
        if not text or self.pc is None:
            return
        cand = candidate_from_sdp(text)
        cand.sdpMid = c.sdp_mid
        cand.sdpMLineIndex = c.sdp_mline_index
        await self.pc.addIceCandidate(cand)

    # ---- phase 2: media, renegotiated over the data channel ------------------
    async def _on_frame(self, frame: bytes) -> None:
        try:
            use_case, data = decode_frame(frame)
            if use_case != RENEGOTIATION:
                return  # media state, upgrade consent, device sync: not used here
            kind, value = decode_signal(data)
        except ValueError as e:
            log.warning("bad data-channel frame: %s", e)
            return
        if kind == "offer":
            await self._answer_media(value)
        elif kind == "answer":
            ai = _aiortc()
            await self.pc.setRemoteDescription(ai.RTCSessionDescription(sdp=value, type="answer"))
            self.media_ready.set()
        elif kind == "candidates":
            for c in value:
                await self._add_candidate(c)

    async def _answer_media(self, sdp: str) -> None:
        ai = _aiortc()
        pc = self.pc
        await pc.setRemoteDescription(ai.RTCSessionDescription(sdp=sdp, type="offer"))
        if self._track is None:
            self._track = _HandsetTrack()
            pc.addTrack(self._track)  # takes the offered audio transceiver, now sendrecv
        for t in pc.getTransceivers():
            if t.kind == "video":
                t.direction = "inactive"  # no camera, and don't decode video on a Pi Zero
        await pc.setLocalDescription(await pc.createAnswer())
        self._send(RENEGOTIATION, encode_signal("answer", only_sha256_fingerprint(pc.localDescription.sdp)))
        self.media_ready.set()

    def _send(self, use_case: str, data: bytes) -> None:
        if self.channel is None or self.channel.readyState != "open":
            log.warning("data channel not open; dropped %s", use_case)
            return
        self.channel.send(encode_frame(use_case, data))

    # ---- audio --------------------------------------------------------------
    def start_audio(self) -> None:
        if self._audio_on or self._track is None:
            return
        self._audio_on = True
        loop = asyncio.get_running_loop()
        track = self._track

        def on_mic(pcm) -> None:
            loop.call_soon_threadsafe(track.push, pcm)

        track.live = True
        self.handset.start_call_audio(on_mic)
        self._send(MEDIA_STATE, encode_media_state(True))

    async def _play(self, track) -> None:
        import av

        from .audio import RATE

        resampler = av.AudioResampler(format="s16", layout="mono", rate=RATE)
        while True:
            try:
                frame = await track.recv()
            except Exception:
                return
            if not self._audio_on:
                continue
            for out in resampler.resample(frame):
                self.handset.play_call_audio(out.to_ndarray().tobytes())

    def _spawn(self, coro) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    @property
    def state(self) -> str:
        return self.pc.connectionState if self.pc else "closed"

    async def close(self) -> None:
        for t in list(self._tasks):
            t.cancel()
        self._tasks.clear()
        if self._audio_on:
            self.handset.stop_call_audio()
        self._audio_on = False
        self.media_ready.clear()
        if self.pc is not None:
            pc, self.pc = self.pc, None
            await pc.close()
        self.channel = None
        self._track = None
