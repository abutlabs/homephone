"""The Pi answering a call made with the Polkadot App's own call protocol.

A pretend Android caller (aiortc, following the App's exact sequence) calls the
Pi:

1. data-channel offer as SCALE MinimalSetup, through the same codec Desktop uses;
2. the Pi answers, also as MinimalSetup; the data channel opens;
3. the caller renegotiates over the data channel with an *audio and video*
   offer, as Android does even for audio calls;
4. the Pi answers with audio sendrecv and video inactive;
5. audio flows both ways.

Skipped if aiortc or Node 22.18+ isn't installed.
"""

from __future__ import annotations

import asyncio
import subprocess

import numpy as np
import pytest

pytest.importorskip("aiortc")

from homephone.phone import appcall  # noqa: E402
from homephone.phone.appcall import (  # noqa: E402
    RENEGOTIATION, AppCall, IceCandidateInit, decode_frame, decode_signal, encode_frame, encode_signal,
)
from homephone.phone.audio import MockHandset  # noqa: E402

from .test_webrtc import NODE, ROOT, needs_node, wait_until  # noqa: E402

CLI = ROOT / "packages" / "linked-device" / "bin" / "minimal-setup.ts"


def through_minimal_setup(sdp: str) -> str:
    """Local SDP -> SCALE(MinimalSetup) -> the SDP the far end rebuilds."""
    def run(cmd, data):
        return subprocess.run([NODE, str(CLI), cmd], input=data, capture_output=True, text=True, check=True).stdout

    return run("decode", run("encode", sdp))


def test_frame_codecs_round_trip():
    sdp = "v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\n"
    assert decode_signal(decode_frame(encode_frame(RENEGOTIATION, encode_signal("offer", sdp)))[1]) == ("offer", sdp)
    cands = [IceCandidateInit("candidate:1 1 udp 2122260223 192.168.1.2 5000 typ host", 0, "0"),
             IceCandidateInit("candidate:2 1 udp 1 10.0.0.1 9 typ host", 1, None)]
    assert decode_signal(encode_signal("candidates", cands)) == ("candidates", cands)
    # SCALE compact edge cases, checked against the spec's encoding.
    assert appcall.enc_compact(0) == b"\x00"
    assert appcall.enc_compact(63) == b"\xfc"
    assert appcall.enc_compact(64) == b"\x01\x01"
    assert appcall.enc_compact(2**30) == b"\x03\x00\x00\x00\x40"
    for n in (0, 63, 64, 16383, 16384, 2**30 - 1, 2**30, 4611731400430051336):
        assert appcall.Reader(appcall.enc_compact(n)).compact() == n


class ToneTrack:
    """The caller's microphone: a steady 440 Hz tone."""

    def __new__(cls):
        import fractions

        import av
        from aiortc import MediaStreamTrack

        class Tone(MediaStreamTrack):
            kind = "audio"

            def __init__(self):
                super().__init__()
                self.t = 0
                self.start = None

            async def recv(self):
                loop = asyncio.get_running_loop()
                self.start = self.start or loop.time()
                target = self.start + self.t / 48000
                await asyncio.sleep(max(0, target - loop.time()))
                n = np.arange(self.t, self.t + 960)
                pcm = (8000 * np.sin(2 * np.pi * 440 * n / 48000)).astype(np.int16)
                frame = av.AudioFrame.from_ndarray(pcm.reshape(1, -1), format="s16", layout="mono")
                frame.sample_rate = 48000
                frame.pts = self.t
                frame.time_base = fractions.Fraction(1, 48000)
                self.t += 960
                return frame

        return Tone()


@needs_node
async def test_pi_answers_an_android_style_call():
    from aiortc import RTCPeerConnection, RTCSessionDescription

    handset = MockHandset()
    pi = AppCall(handset)
    caller = RTCPeerConnection()
    heard_by_caller: list[float] = []
    try:
        # 1-2. Data channel, set up through MinimalSetup both ways.
        channel = caller.createDataChannel("dataChannel")
        await caller.setLocalDescription(await caller.createOffer())
        answer = await pi.answer(through_minimal_setup(caller.localDescription.sdp))
        assert "a=fingerprint:sha-256" in answer
        await caller.setRemoteDescription(RTCSessionDescription(through_minimal_setup(answer), "answer"))
        await wait_until(lambda: channel.readyState == "open" and pi.channel is not None)

        # 3. Android's media offer: audio plus a video section, sent over the data channel.
        @caller.on("track")
        def on_track(track):
            async def listen():
                while True:
                    frame = await track.recv()
                    pcm = frame.to_ndarray().astype(np.float64)
                    heard_by_caller.append(float(np.sqrt(np.mean(pcm**2))) / 32768)
            asyncio.ensure_future(listen())

        got_answer = asyncio.Event()

        @channel.on("message")
        def on_message(message):
            use_case, data = decode_frame(message)
            if use_case != RENEGOTIATION:
                return  # e.g. the Pi's "microphone on" media-state frame
            kind, sdp = decode_signal(data)
            assert kind == "answer"
            asyncio.ensure_future(caller.setRemoteDescription(RTCSessionDescription(sdp, "answer"))).add_done_callback(
                lambda _: got_answer.set())

        caller.addTrack(ToneTrack())
        caller.addTransceiver("video", direction="sendrecv")
        await caller.setLocalDescription(await caller.createOffer())
        assert "m=video" in caller.localDescription.sdp
        channel.send(encode_frame(RENEGOTIATION, encode_signal("offer", caller.localDescription.sdp)))
        await asyncio.wait_for(got_answer.wait(), 10)

        # 4. The Pi answered audio both ways and video inactive.
        kinds = {t.kind: t.currentDirection or t.direction for t in pi.pc.getTransceivers()}
        assert kinds["video"] == "inactive"
        assert kinds["audio"] == "sendrecv"

        # 5. Lift the handset: both ends hear each other.
        pi.start_audio()
        try:
            await wait_until(lambda: handset.peak_level > 0.05 and max(heard_by_caller, default=0) > 0.05, timeout=10)
        except TimeoutError:
            pytest.fail(f"Pi heard {handset.peak_level:.3f}, caller heard {max(heard_by_caller, default=0):.3f}")
    finally:
        await pi.close()
        await caller.close()


from .chrome_caller import ChromeCaller, find_chrome  # noqa: E402

CHROME = find_chrome()


@needs_node
@pytest.mark.skipif(CHROME is None, reason="needs Chrome or Chromium (set HOMEPHONE_CHROME)")
async def test_pi_answers_a_libwebrtc_caller():
    """Same sequence, with Chrome's libwebrtc (what the App's phones use) as the caller."""
    import json

    handset = MockHandset()
    pi = AppCall(handset)
    chrome = ChromeCaller(CHROME)
    try:
        await chrome.start()
        offer = await chrome.eval("hp.offer()")
        answer = await pi.answer(through_minimal_setup(offer))
        state = await chrome.eval(f"hp.applyAnswer({json.dumps(through_minimal_setup(answer))})")
        assert state in ("connecting", "connected")

        media = await chrome.eval("hp.addMedia()")
        assert media["offerHasVideo"]
        kinds = {t.kind: t.direction for t in pi.pc.getTransceivers()}
        assert kinds == {"audio": "sendrecv", "video": "inactive"}, kinds

        pi.start_audio()
        heard = {"packets": 0, "peak": 0.0}
        for _ in range(100):
            heard = await chrome.eval("hp.heard()")
            if handset.peak_level > 0.05 and heard["peak"] > 0.02:
                break
            await asyncio.sleep(0.1)
        assert handset.peak_level > 0.05, f"Pi heard {handset.peak_level:.3f}"
        assert heard["peak"] > 0.02, f"Chrome heard {heard}"
    finally:
        await chrome.close()
        await pi.close()
