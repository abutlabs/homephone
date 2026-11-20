"""Look up Polkadot App users on the People chain (devnet, para 1004).

    python -m homephone.people abutlabs.01 [more usernames...] > contacts.json

Prints each user's identity account and chat public key: the on-chain facts a
linked device needs to open the identity-level chat channel with them.
"""

from __future__ import annotations

import json
import sys

DEVNET_PEOPLE = "wss://people-paseo.rotko.net"


def lookup(usernames: list[str], url: str = DEVNET_PEOPLE) -> list[dict]:
    from substrateinterface import Keypair, SubstrateInterface

    chain = SubstrateInterface(url=url)
    chain.init_runtime()
    out = []
    for name in usernames:
        account = chain.query("Resources", "UsernameOwnerOf", [name]).value
        if not account:
            raise SystemExit(f"{name}: not registered on this network")
        consumer = chain.query("Resources", "Consumers", [account]).value or {}
        key = bytes.fromhex(consumer.get("identifier_key", "0x")[2:])
        if len(key) < 33 or key[0] != 0:
            raise SystemExit(f"{name}: no chat identity key on-chain")
        out.append({
            "username": name,
            "account": account,
            "id": "0x" + Keypair(ss58_address=account).public_key.hex(),
            "chatPub": "0x" + key[1:33].hex(),
            "credibility": consumer.get("credibility"),
        })
    return out


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    json.dump(lookup(sys.argv[1:]), sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
