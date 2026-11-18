import stat

from hearthline.identity import DeviceIdentity, account_to_hub_address, verify_hello


def test_create_persist_and_reload(tmp_path):
    path = tmp_path / "sub" / "device-key.json"
    a = DeviceIdentity.load_or_create(path, "Hall phone")
    assert path.exists()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    b = DeviceIdentity.load_or_create(path)
    assert a.address == b.address
    assert b.name == "Hall phone"
    assert a.address.startswith("1")  # Polkadot SS58 prefix 0


def test_hello_signature_roundtrip():
    ident = DeviceIdentity.generate()
    sig = ident.sign_hello("abc123")
    assert verify_hello(ident.address, "abc123", sig)
    assert not verify_hello(ident.address, "other-nonce", sig)
    assert not verify_hello(DeviceIdentity.generate().address, "abc123", sig)
    assert not verify_hello("not-an-address", "abc123", sig)


def test_hub_address_is_h160():
    ident = DeviceIdentity.generate()
    h = ident.hub_address
    assert h.startswith("0x") and len(h) == 42
    assert h == account_to_hub_address(ident.keypair.public_key)
