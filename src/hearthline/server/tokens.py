"""LiveKit access tokens. The API secret stays on the server."""

from __future__ import annotations

from datetime import timedelta

from livekit import api


def make_token(
    api_key: str, api_secret: str, room: str, identity: str, name: str, ttl_minutes: int = 120
) -> str:
    return (
        api.AccessToken(api_key, api_secret)
        .with_identity(identity)
        .with_name(name)
        .with_ttl(timedelta(minutes=ttl_minutes))
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=False,
            )
        )
        .to_jwt()
    )
