"""Who belongs to which household.

Milestone 1 keeps this in a JSON file (``households.json``) on the server. In
M3 it is replaced by grants signed by household owners' Polkadot accounts and
checked on each device, so no server knows who belongs to whom (see
``docs/polkadot.md``).
Keep this interface small so that swap is easy.
"""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Household:
    id: str
    name: str
    phones: dict[str, str] = field(default_factory=dict)  # address -> phone name

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "phones": [{"address": a, "name": n} for a, n in self.phones.items()],
        }


_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def valid_household_id(hid: str) -> bool:
    return bool(_ID_RE.match(hid))


class Directory:
    """Households from a JSON file. Thread-safe enough for one server process."""

    def __init__(self, path: Path | None = None, households: list[Household] | None = None):
        self.path = path
        self._lock = threading.Lock()
        self.households: dict[str, Household] = {}
        if households:
            for h in households:
                self.households[h.id] = h
        elif path and path.exists():
            self._load()

    def _load(self) -> None:
        data = json.loads(self.path.read_text())  # type: ignore[union-attr]
        for h in data.get("households", []):
            hh = Household(h["id"], h.get("name", h["id"]))
            for p in h.get("phones", []):
                hh.phones[p["address"]] = p.get("name", "phone")
            self.households[hh.id] = hh

    def save(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {"households": [h.to_json() for h in self.households.values()]}
        self.path.write_text(json.dumps(data, indent=2) + "\n")

    def get(self, hid: str) -> Household | None:
        return self.households.get(hid)

    def household_of(self, address: str) -> Household | None:
        for h in self.households.values():
            if address in h.phones:
                return h
        return None

    def ensure_household(self, hid: str, name: str | None = None) -> Household:
        with self._lock:
            h = self.households.get(hid)
            if h is None:
                h = Household(hid, name or hid)
                self.households[hid] = h
                self.save()
            return h

    def enroll(self, hid: str, address: str, phone_name: str) -> Household:
        """Add a phone to a household (dev auto-enroll and the CLI use this)."""
        h = self.ensure_household(hid)
        with self._lock:
            for other in self.households.values():
                if other is not h:
                    other.phones.pop(address, None)
            h.phones[address] = phone_name
            self.save()
        return h

    def summary(self) -> list[dict]:
        return [{"id": h.id, "name": h.name} for h in self.households.values()]
