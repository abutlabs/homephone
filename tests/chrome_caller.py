"""Headless Chrome as a libwebrtc caller, for interop tests.

The Polkadot App's phones use Google's libwebrtc, which aiortc-to-aiortc tests
don't exercise. Chrome uses the same library. We drive a throwaway headless
Chrome (its own temporary profile) over the DevTools protocol, and run the
App's call sequence in page JavaScript.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

CHROME_CANDIDATES = [
    os.environ.get("HOMEPHONE_CHROME", ""),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
]


def find_chrome() -> str | None:
    for c in CHROME_CANDIDATES:
        if c and Path(c).exists():
            return c
    return None


# Page-side helpers: the App's data-channel frames (SCALE) and the call steps.
PAGE_JS = r"""
(() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const compact = (n) => {
    if (n < 64) return [n << 2];
    if (n < 16384) { const v = (n << 2) | 1; return [v & 255, v >> 8]; }
    const v = ((n << 2) | 2) >>> 0; return [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24];
  };
  const bytes = (b) => [...compact(b.length), ...b];
  const frame = (useCase, data) => new Uint8Array([...bytes(enc.encode(useCase)), ...bytes(data)]);
  function reader(u8) {
    let p = 0;
    const r = {
      compact() {
        const m = u8[p] & 3;
        if (m === 0) return u8[p++] >> 2;
        if (m === 1) { const v = (u8[p] | (u8[p + 1] << 8)) >> 2; p += 2; return v; }
        if (m === 2) { const v = (u8[p] | (u8[p+1] << 8) | (u8[p+2] << 16) | (u8[p+3] << 24)) >>> 2; p += 4; return v; }
        throw new Error("big compact");
      },
      bytes() { const n = r.compact(); const out = u8.slice(p, p + n); p += n; return out; },
      str() { return dec.decode(r.bytes()); },
      u8() { return u8[p++]; },
    };
    return r;
  }
  const RENEG = "webrtc_renegotiation_internal_use_case";
  const gathered = (pc) => new Promise((res) => {
    if (pc.iceGatheringState === "complete") return res();
    pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && res());
  });

  window.hp = {
    async offer() {
      // Same config as Desktop and Android: default (balanced) bundle policy, candidate pool of 8.
      const pc = (window.pc = new RTCPeerConnection({ iceCandidatePoolSize: 8 }));
      const dc = (window.dc = pc.createDataChannel("dataChannel"));
      dc.binaryType = "arraybuffer";
      window.answers = [];
      // Measure what we hear: remote audio into an analyser (a muted <audio>
      // element keeps Chrome's remote-stream pipeline running).
      pc.ontrack = (e) => {
        if (e.track.kind !== "audio") return;
        const stream = new MediaStream([e.track]);
        const el = new Audio(); el.muted = true; el.srcObject = stream; el.play().catch(() => {});
        const actx = (window.actx = new AudioContext());
        const an = actx.createAnalyser(); an.fftSize = 2048;
        actx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        window.peak = 0;
        setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0; for (const v of buf) sum += v * v;
          window.peak = Math.max(window.peak, Math.sqrt(sum / buf.length));
        }, 50);
      };
      dc.onmessage = (e) => {
        const r = reader(new Uint8Array(e.data));
        const useCase = r.str(); const data = r.bytes();
        if (useCase !== RENEG) return;
        const s = reader(data); const tag = s.u8();
        if (tag === 1) window.answers.push(s.str());
      };
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      return pc.localDescription.sdp;
    },
    async applyAnswer(sdp) {
      await pc.setRemoteDescription({ type: "answer", sdp });
      await new Promise((res, rej) => {
        if (dc.readyState === "open") return res();
        dc.onopen = res; setTimeout(() => rej(new Error("data channel did not open: " + pc.connectionState)), 10000);
      });
      return pc.connectionState;
    },
    async addMedia() {
      // Android: audio plus a video section (camera off), offered over the data channel.
      const ctx = (window.ctx = new AudioContext());
      const osc = ctx.createOscillator(); osc.frequency.value = 440;
      const gain = ctx.createGain(); gain.gain.value = 0.3;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest); osc.start();
      pc.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
      pc.addTransceiver("video", { direction: "sendrecv" });
      await pc.setLocalDescription(await pc.createOffer());
      const sdp = pc.localDescription.sdp;
      const sig = [0, ...bytes(enc.encode(sdp))];
      dc.send(frame(RENEG, new Uint8Array(sig)));
      for (let i = 0; i < 100 && !window.answers.length; i++) await new Promise((r) => setTimeout(r, 100));
      if (!window.answers.length) throw new Error("no media answer over the data channel");
      await pc.setRemoteDescription({ type: "answer", sdp: window.answers[0] });
      return { offerHasVideo: sdp.includes("m=video"), answer: window.answers[0] };
    },
    async heard() {
      const stats = await pc.getStats();
      let packets = 0;
      stats.forEach((s) => { if (s.type === "inbound-rtp" && s.kind === "audio") packets = s.packetsReceived || 0; });
      return { packets, peak: window.peak || 0 };
    },
    close() { try { pc.close(); ctx && ctx.close(); window.actx && actx.close(); } catch (e) {} },
  };
  return true;
})()
"""


class ChromeCaller:
    def __init__(self, chrome: str):
        self.chrome = chrome
        self.proc: subprocess.Popen | None = None
        self.profile = tempfile.mkdtemp(prefix="homephone-chrome-")
        self.ws = None
        self._id = 0

    async def start(self) -> None:
        import websockets

        self.proc = subprocess.Popen(
            [
                self.chrome, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={self.profile}",
                "--no-first-run", "--no-default-browser-check", "--disable-extensions",
                "--autoplay-policy=no-user-gesture-required",
                # Real host IPs instead of mDNS names, which MinimalSetup can't carry.
                "--disable-features=WebRtcHideLocalIpsWithMdns",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        port_file = Path(self.profile) / "DevToolsActivePort"
        for _ in range(100):
            if port_file.exists() and port_file.read_text().strip():
                break
            await asyncio.sleep(0.1)
        port = int(port_file.read_text().split()[0])
        pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list"))
        url = next(p["webSocketDebuggerUrl"] for p in pages if p["type"] == "page")
        self.ws = await websockets.connect(url, max_size=None)
        await self.eval(PAGE_JS)

    async def eval(self, expression: str):
        self._id += 1
        msg_id = self._id
        await self.ws.send(json.dumps({"id": msg_id, "method": "Runtime.evaluate", "params": {
            "expression": expression, "awaitPromise": True, "returnByValue": True}}))
        while True:
            reply = json.loads(await self.ws.recv())
            if reply.get("id") == msg_id:
                break
        result = reply["result"]
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"].get("exception", {}).get("description")
                               or result["exceptionDetails"].get("text"))
        return result["result"].get("value")

    async def close(self) -> None:
        try:
            if self.ws:
                await self.eval("hp.close()")
                await self.ws.close()
        except Exception:
            pass
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)
