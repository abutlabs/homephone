"""Telephone tones, generated so there are no sound files to ship.

European (CEPT) style: 425 Hz dial tone, ringback 1 s on / 4 s off, busy
0.5 s on / 0.5 s off. The bell for the ringer is a 20 Hz warbled two-tone.
All buffers are mono int16 at 48 kHz and are meant to be played in a loop.
"""

from __future__ import annotations

import numpy as np

RATE = 48_000


def _t(seconds: float) -> np.ndarray:
    return np.arange(int(RATE * seconds)) / RATE


def _pcm(x: np.ndarray, volume: float) -> np.ndarray:
    return (np.clip(x, -1, 1) * volume * 32767).astype(np.int16)


def _sine(freq: float, seconds: float) -> np.ndarray:
    return np.sin(2 * np.pi * freq * _t(seconds))


def _silence(seconds: float) -> np.ndarray:
    return np.zeros(int(RATE * seconds))


def dial_tone(volume: float = 0.3) -> np.ndarray:
    return _pcm(_sine(425, 1.0), volume)


def ringback(volume: float = 0.3) -> np.ndarray:
    return _pcm(np.concatenate([_sine(425, 1.0), _silence(4.0)]), volume)


def busy(volume: float = 0.3) -> np.ndarray:
    return _pcm(np.concatenate([_sine(425, 0.5), _silence(0.5)]), volume)


def bell(volume: float = 0.8) -> np.ndarray:
    """An electronic take on a bell: 2 s of warbling ring, 4 s quiet."""
    t = _t(2.0)
    warble = np.sign(np.sin(2 * np.pi * 20 * t))  # 20 Hz like a bell hammer
    tone = np.where(warble > 0, np.sin(2 * np.pi * 800 * t), np.sin(2 * np.pi * 1000 * t))
    envelope = np.minimum(1, np.minimum(t, 2.0 - t) * 50)  # soft edges, no clicks
    return _pcm(np.concatenate([tone * envelope, _silence(4.0)]), volume)


def test_pips(volume: float = 0.2) -> np.ndarray:
    """What the mock handset 'says' into a call: a short pip every 2 s."""
    return _pcm(np.concatenate([_sine(660, 0.3), _silence(1.7)]), volume)


TONES = {"dial": dial_tone, "ringback": ringback, "busy": busy}
