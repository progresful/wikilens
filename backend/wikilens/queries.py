"""Every SQL statement WikiLens runs, and the functions that run them."""
from __future__ import annotations

import json
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from pymysql.connections import Connection

from wikilens.timeline import HistoryRow

# A current row's row_end is MariaDB's largest timestamp; anything past this is "still current".
STILL_CURRENT_AFTER = datetime(2037, 1, 1)

# A scrub frame: the article as it stood at one moment.
FRAME_SQL = """SELECT para_id, hash, rev_id
FROM paragraph FOR SYSTEM_TIME AS OF TIMESTAMP %s
WHERE page_id = %s
ORDER BY pos, para_id"""

# Ask: rank every wording this article ever had, including ones deleted since.
# The question's vector is parsed once into a session variable. Written inline as
# VEC_FromText('[...]'), MariaDB parsed the 1024 numbers again for every row: 287 ms instead
# of 14 ms on a 4,359-row article (docs/measurements.md).
SET_QUESTION_SQL = "SET @question = VEC_FromText(%s)"
RANK_SQL = """SELECT p.para_id, MIN(VEC_DISTANCE_COSINE(v.embedding, @question)) AS distance
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
        cur.execute(SET_QUESTION_SQL, (vector_literal(vector),))
        cur.execute(RANK_SQL, (page_id, limit))
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


# Every wording an article ever had, so the browser can hold them all and a scrub never
# waits for a paragraph's text.
ARTICLE_WORDINGS_SQL = """SELECT DISTINCT w.hash, w.kind, w.text
FROM paragraph FOR SYSTEM_TIME ALL AS p
JOIN wording AS w ON w.hash = p.hash
WHERE p.page_id = %s"""


def article_wordings(con: Connection, page_id: int) -> dict[bytes, tuple[str, str]]:
    """hash -> (kind, text) for every wording the article ever had."""
    with con.cursor() as cur:
        cur.execute(ARTICLE_WORDINGS_SQL, (page_id,))
        return {bytes(block_hash): (kind, text) for block_hash, kind, text in cur.fetchall()}


def nearest_wordings(con: Connection, vector: Sequence[float], limit: int = 10) -> list[tuple[bytes, float]]:
    with con.cursor() as cur:
        cur.execute(NEAREST_SQL, (vector_literal(vector), limit))
        return [(bytes(block_hash), float(distance)) for block_hash, distance in cur.fetchall()]


# The whole life of one paragraph, oldest state first.
HISTORY_SQL = """SELECT p.hash, p.rev_id, p.row_start, p.row_end, w.text, p.match_rule, p.similarity
FROM paragraph FOR SYSTEM_TIME ALL AS p
JOIN wording AS w ON w.hash = p.hash
WHERE p.page_id = %s AND p.para_id = %s
ORDER BY p.row_start"""

# Keyword fallback for articles without vectors: full-text match over every wording the article had.
KEYWORD_SQL = """SELECT p.para_id, MAX(MATCH(w.text) AGAINST (%s)) AS score
FROM paragraph FOR SYSTEM_TIME ALL AS p
JOIN wording AS w ON w.hash = p.hash
WHERE p.page_id = %s AND w.kind IN ('p', 'li') AND MATCH(w.text) AGAINST (%s)
GROUP BY p.para_id
ORDER BY score DESC, p.para_id
LIMIT %s"""

HAS_VECTORS_SQL = """SELECT 1
FROM paragraph FOR SYSTEM_TIME ALL AS p
JOIN wording_vector AS v ON v.hash = p.hash
WHERE p.page_id = %s
LIMIT 1"""

BARS_SQL = """SELECT DATE_FORMAT(ts, '%%Y-%%m') AS month, COUNT(*) AS edits
FROM revision
WHERE page_id = %s
GROUP BY month
ORDER BY month"""

# How many distinct wordings each paragraph has had: the tint on the landing page.
CHURN_SQL = """SELECT para_id, COUNT(DISTINCT hash) AS wordings
FROM paragraph FOR SYSTEM_TIME ALL
WHERE page_id = %s
GROUP BY para_id"""


@dataclass(frozen=True)
class ArticleRow:
    page_id: int
    title: str
    revisions: int
    first_ts: datetime
    last_ts: datetime
    tier: int


@dataclass(frozen=True)
class Overview:
    article: ArticleRow
    bars: tuple[tuple[str, int], ...]   # (month "YYYY-MM", edits)
    churn: Mapping[int, int]            # para_id -> distinct wordings
    has_vectors: bool


@dataclass(frozen=True)
class Coverage:
    articles: int
    revisions: int
    paragraph_versions: int
    wordings: int
    vectors: int
    database_bytes: int
    mariadb_version: str


def rank_sql_for_display(page_id: int, limit: int = 3) -> str:
    """The two statements of a ranking as shown on screen; the vector's 1024 numbers are not printed."""
    return "SET @question = VEC_FromText('[the question as 1024 numbers]');\n" + RANK_SQL % (page_id, limit)


def paragraph_history(con: Connection, page_id: int, para_id: int) -> list[HistoryRow]:
    with con.cursor() as cur:
        cur.execute(HISTORY_SQL, (page_id, para_id))
        return [
            HistoryRow(hash=bytes(block_hash), rev_id=rev_id, start=start,
                       end=None if end > STILL_CURRENT_AFTER else end, text=text, rule=rule,
                       similarity=similarity)
            for block_hash, rev_id, start, end, text, rule, similarity in cur.fetchall()
        ]


def keyword_paragraphs(con: Connection, page_id: int, question: str, limit: int = 3) -> list[int]:
    with con.cursor() as cur:
        cur.execute(KEYWORD_SQL, (question, page_id, question, limit))
        return [para_id for para_id, _ in cur.fetchall()]


def has_vectors(con: Connection, page_id: int) -> bool:
    with con.cursor() as cur:
        cur.execute(HAS_VECTORS_SQL, (page_id,))
        return cur.fetchone() is not None


def list_articles(con: Connection) -> list[ArticleRow]:
    with con.cursor() as cur:
        cur.execute("SELECT page_id, title, revisions, first_ts, last_ts, tier FROM article ORDER BY title")
        return [ArticleRow(*row) for row in cur.fetchall()]


def get_article(con: Connection, page_id: int) -> ArticleRow | None:
    with con.cursor() as cur:
        cur.execute("SELECT page_id, title, revisions, first_ts, last_ts, tier FROM article WHERE page_id = %s",
                    (page_id,))
        row = cur.fetchone()
        return ArticleRow(*row) if row is not None else None


def article_overview(con: Connection, page_id: int) -> Overview | None:
    article = get_article(con, page_id)
    if article is None:
        return None
    with con.cursor() as cur:
        cur.execute(BARS_SQL, (page_id,))
        bars = tuple((month, int(edits)) for month, edits in cur.fetchall())
        cur.execute(CHURN_SQL, (page_id,))
        churn = {para_id: int(wordings) for para_id, wordings in cur.fetchall()}
    return Overview(article=article, bars=bars, churn=churn, has_vectors=has_vectors(con, page_id))


def _scalar(con: Connection, sql: str) -> object:
    with con.cursor() as cur:
        cur.execute(sql)
        row = cur.fetchone()
    return row[0] if row is not None else None


def coverage(con: Connection) -> Coverage:
    def one(sql: str) -> int:
        value = _scalar(con, sql)
        return int(value) if value is not None else 0   # type: ignore[call-overload]

    version = str(_scalar(con, "SELECT VERSION()"))
    return Coverage(
        articles=one("SELECT COUNT(*) FROM article"),
        revisions=one("SELECT COUNT(*) FROM revision"),
        paragraph_versions=one("SELECT COUNT(*) FROM paragraph FOR SYSTEM_TIME ALL"),
        wordings=one("SELECT COUNT(*) FROM wording"),
        vectors=one("SELECT COUNT(*) FROM wording_vector"),
        database_bytes=one("SELECT SUM(data_length + index_length) FROM information_schema.tables "
                           "WHERE table_schema = DATABASE()"),
        mariadb_version=version,
    )
