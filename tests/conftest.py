import pytest

from homephone.identity import DeviceIdentity
from homephone.server.app import ServerConfig
from homephone.server.households import Directory, Household


@pytest.fixture
def config():
    return ServerConfig(
        livekit_url="ws://livekit.test:7880",
        livekit_api_key="devkey",
        livekit_api_secret="secret-that-is-long-enough-for-hs256",
        web_key="test-key",
        ring_timeout=2.0,
    )


@pytest.fixture
def phone_ident():
    return DeviceIdentity.generate("Kitchen phone")


@pytest.fixture
def directory(phone_ident):
    home = Household("home", "Home")
    home.phones[phone_ident.address] = "Kitchen phone"
    return Directory(households=[home])
