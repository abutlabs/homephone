"""Messages between devices and the ringing server.

Everything is JSON over one WebSocket per device (``/ws``). Audio never goes
through this server: it flows over WebRTC through LiveKit.

Server -> device
  challenge   {nonce}                         first message on connect
  welcome     {household, households, mock}   after a good hello
  error       {message}
  calling     {call_id, to, room, url, token} you placed a call; join now
  ring        {call_id, from, room}           your household is being called
  join        {call_id, room, url, token}     you answered; join now
  answered    {call_id, by}                   someone picked up your call
  stop_ring   {call_id, reason}               answered elsewhere / cancelled
  ended       {call_id, reason}               call is over
  phones      {phones: [...]}                 (web, dev) live phone states
  mock_hook   {off_hook}                      (mock phones, dev) lift / hang up

Device -> server
  hello       {kind: phone|web, ...}          see server.app for fields
  call        {to}                            ring a household
  answer      {call_id}
  hangup      {call_id}
  status      {state, off_hook, audio_level}  (phones) for the dev dashboard
  mock_hook   {address, off_hook}             (web, dev) drive a mock phone
"""

from __future__ import annotations

import json
from typing import Any


def encode(type_: str, **fields: Any) -> str:
    return json.dumps({"type": type_, **fields})


def decode(raw: str | bytes) -> dict[str, Any]:
    msg = json.loads(raw)
    if not isinstance(msg, dict) or "type" not in msg:
        raise ValueError("message must be an object with a type")
    return msg
