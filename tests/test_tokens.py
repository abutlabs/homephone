from livekit import api

from hearthline.server.tokens import make_token


def test_token_grants_only_one_room():
    secret = "secret-that-is-long-enough-for-hs256"
    jwt = make_token("devkey", secret, "call-abc", "phone:1abc", "Kitchen")
    claims = api.TokenVerifier("devkey", secret).verify(jwt)
    assert claims.identity == "phone:1abc"
    assert claims.name == "Kitchen"
    assert claims.video.room == "call-abc"
    assert claims.video.room_join is True
