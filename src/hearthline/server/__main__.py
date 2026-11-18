"""Run the ringing server: ``hearthline-server`` (or ``python -m hearthline.server``)."""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from .households import Directory, valid_household_id


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="hearthline-server")
    p.add_argument(
        "--households",
        type=Path,
        default=Path(os.environ.get("HEARTHLINE_HOUSEHOLDS", "households.json")),
    )
    sub = p.add_subparsers(dest="cmd")
    run = sub.add_parser("run", help="run the server (default)")
    run.add_argument("--host", default=os.environ.get("HEARTHLINE_HOST", "0.0.0.0"))
    run.add_argument("--port", type=int, default=int(os.environ.get("HEARTHLINE_PORT", "8080")))
    enroll = sub.add_parser("enroll", help="add a phone to a household")
    enroll.add_argument("--household", required=True)
    enroll.add_argument("--address", required=True, help="the phone's Polkadot address")
    enroll.add_argument("--name", default="phone")
    sub.add_parser("list", help="list households and phones")
    args = p.parse_args(argv)

    directory = Directory(args.households)
    if args.cmd == "enroll":
        if not valid_household_id(args.household):
            sys.exit("household ids are lowercase letters, digits and dashes")
        directory.enroll(args.household, args.address, args.name)
        print(f"Added {args.name} ({args.address}) to household '{args.household}'")
        return
    if args.cmd == "list":
        for h in directory.households.values():
            print(f"{h.id}: {h.name}")
            for a, n in h.phones.items():
                print(f"  {n}: {a}")
        return

    import uvicorn

    from .app import ServerConfig, create_app

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    missing = [k for k in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET") if not os.environ.get(k)]
    if missing:
        sys.exit(f"Set {', '.join(missing)} (see .env.example and docs/livekit-cloud.md)")
    config = ServerConfig(
        livekit_url=os.environ["LIVEKIT_URL"],
        livekit_api_key=os.environ["LIVEKIT_API_KEY"],
        livekit_api_secret=os.environ["LIVEKIT_API_SECRET"],
        ring_timeout=float(os.environ.get("HEARTHLINE_RING_TIMEOUT", "45")),
        auto_enroll=_env_bool("HEARTHLINE_AUTO_ENROLL"),
        allow_mock_control=_env_bool("HEARTHLINE_MOCK_CONTROL", True),
    )
    if os.environ.get("HEARTHLINE_WEB_KEY"):
        config.web_key = os.environ["HEARTHLINE_WEB_KEY"]
    host = getattr(args, "host", "0.0.0.0")
    port = getattr(args, "port", 8080)
    public = os.environ.get("HEARTHLINE_PUBLIC_URL", f"http://localhost:{port}")
    print(f"\n  Laptop test client: {public}/?key={config.web_key}&household=laptop\n", flush=True)
    uvicorn.run(create_app(config, directory), host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
