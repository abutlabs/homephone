"""Polkadot account for each device.

Every phone (and later every app install) owns a Polkadot sr25519 account.
The account is the device's identity:

* it signs the hello message when the phone connects to the ringing server, and
* (milestone 2) it is the member address stored in the household contract on
  Polkadot Hub, see ``contracts/HouseholdRegistry.sol``.

The secret phrase never leaves the device. It is written to a key file with
permissions 0600. Only the public address is shared.
"""

from __future__ import annotations

import argparse
import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path

from Crypto.Hash import keccak
from substrateinterface import Keypair, KeypairType

# SS58 prefix 0 is Polkadot (and Polkadot Hub). 42 is the generic Substrate
# prefix that most testnets show. The public key is the same either way.
POLKADOT_SS58 = 0

DEFAULT_KEYFILE = Path(
    os.environ.get("HOMEPHONE_KEYFILE", "~/.config/homephone/device-key.json")
).expanduser()

HELLO_PREFIX = b"homephone-hello:"


@dataclass
class DeviceIdentity:
    keypair: Keypair
    name: str = "phone"

    @property
    def address(self) -> str:
        """The device's public Polkadot address (SS58)."""
        return self.keypair.ss58_address

    @property
    def hub_address(self) -> str:
        """The 20-byte address Polkadot Hub smart contracts see for this account.

        Polkadot Hub (pallet-revive) maps a 32-byte Substrate account to an
        Ethereum-style H160 as the last 20 bytes of keccak256(account_id).
        That is the value ``msg.sender`` will hold in the household contract.
        Check against the Polkadot Hub docs before relying on it on mainnet.
        """
        return account_to_hub_address(self.keypair.public_key)

    def sign(self, message: bytes) -> str:
        return "0x" + self.keypair.sign(message).hex()

    def sign_hello(self, nonce: str) -> str:
        return self.sign(HELLO_PREFIX + nonce.encode())

    # ---- persistence -------------------------------------------------
    @classmethod
    def generate(cls, name: str = "phone") -> "DeviceIdentity":
        mnemonic = Keypair.generate_mnemonic()
        kp = Keypair.create_from_mnemonic(
            mnemonic, ss58_format=POLKADOT_SS58, crypto_type=KeypairType.SR25519
        )
        ident = cls(kp, name)
        ident._mnemonic = mnemonic  # type: ignore[attr-defined]
        return ident

    def save(self, path: Path) -> None:
        mnemonic = getattr(self, "_mnemonic", None)
        if mnemonic is None:
            raise ValueError("only a freshly generated identity can be saved")
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "version": 1,
            "name": self.name,
            "address": self.address,
            "crypto": "sr25519",
            "mnemonic": mnemonic,
        }
        # Create the file with 0600 from the start, so the secret is never
        # readable by other users even briefly.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)

    @classmethod
    def load(cls, path: Path) -> "DeviceIdentity":
        data = json.loads(path.read_text())
        kp = Keypair.create_from_mnemonic(
            data["mnemonic"], ss58_format=POLKADOT_SS58, crypto_type=KeypairType.SR25519
        )
        ident = cls(kp, data.get("name", "phone"))
        ident._mnemonic = data["mnemonic"]  # type: ignore[attr-defined]
        return ident

    @classmethod
    def load_or_create(cls, path: Path = DEFAULT_KEYFILE, name: str = "phone") -> "DeviceIdentity":
        if path.exists():
            return cls.load(path)
        ident = cls.generate(name)
        ident.save(path)
        return ident


def account_to_hub_address(public_key: bytes) -> str:
    h = keccak.new(digest_bits=256)
    h.update(public_key)
    return "0x" + h.digest()[-20:].hex()


def verify_hello(address: str, nonce: str, signature: str) -> bool:
    """Check that ``signature`` is ``address`` signing the server's nonce."""
    try:
        kp = Keypair(ss58_address=address, ss58_format=POLKADOT_SS58)
        sig = bytes.fromhex(signature.removeprefix("0x"))
        return bool(kp.verify(HELLO_PREFIX + nonce.encode(), sig))
    except Exception:
        return False


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Show or create this device's Polkadot account.")
    p.add_argument("--keyfile", type=Path, default=DEFAULT_KEYFILE)
    p.add_argument("--name", default=os.environ.get("HOMEPHONE_PHONE_NAME", "phone"))
    args = p.parse_args(argv)
    existed = args.keyfile.exists()
    ident = DeviceIdentity.load_or_create(args.keyfile, args.name)
    print(("Loaded" if existed else "Created") + f" device account in {args.keyfile}")
    print(f"  Polkadot address : {ident.address}")
    print(f"  Polkadot Hub H160: {ident.hub_address}")
    print("Share the Polkadot address; never share the key file.")


if __name__ == "__main__":
    main()
