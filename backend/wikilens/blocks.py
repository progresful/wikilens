"""A block is one paragraph, list item or heading of an article."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Literal

Kind = Literal["p", "li", "h"]


@dataclass(frozen=True)
class Block:
    kind: Kind
    text: str
    hash: bytes   # 16 bytes; the same kind and text always give the same hash

    @staticmethod
    def of(kind: Kind, text: str) -> Block:
        digest = hashlib.md5(f"{kind}\n{text}".encode(), usedforsecurity=False).digest()
        return Block(kind=kind, text=text, hash=digest)
