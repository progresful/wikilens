"""Every SQL statement WikiLens runs, and the functions that run them."""
from __future__ import annotations

import json
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from pymysql.connections import Connection

# A scrub frame: the article as it stood at one moment.
FRAME_SQL = """SELECT para_id, hash, rev_id
FROM paragraph FOR SYSTEM_TIME AS OF TIMESTAMP %s
WHERE page_id = %s
ORDER BY pos, para_id"""

# Ask: rank every wording this article ever had, including ones deleted since.
RANK_SQL = """SELECT p.para_id, MIN(VEC_DISTANCE_COSINE(v.embedding, VEC_FromText(%s))) AS distance
FROM paragraph FOR SYSTEM_TIME ALL AS p
JOIN wording_vector AS v ON v.hash = p.hash
WHERE p.page_id = %s
GROUP BY p.para_id
ORDER BY distance, p.para_id
LIMIT %s"""

# Nearest wordings across all articles, through the vector index.
NEAREST_SQL = """SELECT hash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(%s)) AS distance
FROM wording_vector
ORDER BY distance
LIMIT %s"""


@dataclass(frozen=True)
class FrameBlock:
    para_id: int
    hash: bytes
    rev_id: int


@dataclass(frozen=True)
class FrameResult:
    blocks: tuple[FrameBlock, ...]
    sql: str       # FRAME_SQL with the bound values written in, for display only
    db_ms: float   # time the database took, measured here


def vector_literal(v: Sequence[float]) -> str:
    """MariaDB reads a vector from text like '[0.1,0.2]' with VEC_FromText()."""
    return json.dumps([float(x) for x in v], separators=(",", ":"))


def frame_at(con: Connection, page_id: int, t: datetime) -> FrameResult:
    with con.cursor() as cur:
        shown = cur.mogrify(FRAME_SQL, (t, page_id))
        started = time.perf_counter()
        cur.execute(FRAME_SQL, (t, page_id))
        rows = cur.fetchall()
        db_ms = (time.perf_counter() - started) * 1000
    blocks = tuple(FrameBlock(para_id, bytes(block_hash), rev_id) for para_id, block_hash, rev_id in rows)
    return FrameResult(blocks=blocks, sql=shown, db_ms=db_ms)


def rank_paragraphs(con: Connection, page_id: int, vector: Sequence[float], limit: int = 3) -> list[tuple[int, float]]:
    """(para_id, distance), closest first. A paragraph's distance is that of its closest wording."""
    with con.cursor() as cur:
        cur.execute(RANK_SQL, (vector_literal(vector), page_id, limit))
        return [(para_id, float(distance)) for para_id, distance in cur.fetchall()]


def wordings_by_hash(con: Connection, hashes: Sequence[bytes]) -> dict[bytes, tuple[str, str]]:
    """hash -> (kind, text) for the hashes that exist."""
    wanted = list(dict.fromkeys(hashes))
    if not wanted:
        return {}
    marks = ", ".join(["%s"] * len(wanted))
    with con.cursor() as cur:
        cur.execute(f"SELECT hash, kind, text FROM wording WHERE hash IN ({marks})", wanted)
        return {bytes(block_hash): (kind, text) for block_hash, kind, text in cur.fetchall()}


def nearest_wordings(con: Connection, vector: Sequence[float], limit: int = 10) -> list[tuple[bytes, float]]:
    with con.cursor() as cur:
        cur.execute(NEAREST_SQL, (vector_literal(vector), limit))
        return [(bytes(block_hash), float(distance)) for block_hash, distance in cur.fetchall()]
