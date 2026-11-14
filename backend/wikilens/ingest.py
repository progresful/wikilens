"""Load articles from dataset M into the system-versioned paragraph table.

    python -m wikilens.ingest --pages 1256            # one or more articles by page id
    python -m wikilens.ingest --tier1 --workers 8     # the starter's 50 articles
    python -m wikilens.ingest --all --workers 8       # everything in dataset M
    python -m wikilens.ingest --reset --tier1         # drop every table first

An article is loaded in one transaction: it is either fully there or not at all. Articles
already loaded are skipped. MariaDB cannot delete one article's history from a versioned
table, so loading an article again means --reset.
"""
from __future__ import annotations

import argparse
import logging
import time
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import datetime
from multiprocessing import get_context
from pathlib import Path
from typing import Any

import pymysql
from pymysql.connections import Connection
from pymysql.cursors import Cursor

from wikilens.cleaner import clean
from wikilens.config import REPO_ROOT, load_settings
from wikilens.db import apply_schema, connect, enable_history_insert, schema_exists
from wikilens.history_rows import OpenRows, ParagraphRow, advance, assign_valid_from
from wikilens.matcher import Memory, PageState, carry_forward, match_revision
from wikilens.parquet_source import RawRevision, download_m, iter_pages, tier1_page_ids
from wikilens.queries import frame_at

log = logging.getLogger(__name__)

BATCH_BYTES = 8_000_000   # of wording text sent together; the server accepts 64 MB packets
ROW_BATCH = 5_000
DATA_DIR = REPO_ROOT / "data" / "m"
RETRIES = 3
RETRYABLE_ERRORS = frozenset({1020, 1205, 1213})   # record changed, lock wait timeout, deadlock

_PARAGRAPH_COLUMNS = "page_id, para_id, pos, hash, rev_id, match_rule, similarity, row_start"
INSERT_WORDING = "INSERT IGNORE INTO wording (hash, kind, text) VALUES (%s, %s, %s)"
INSERT_HISTORY = f"INSERT INTO paragraph ({_PARAGRAPH_COLUMNS}, row_end) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
INSERT_CURRENT = f"INSERT INTO paragraph ({_PARAGRAPH_COLUMNS}) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
INSERT_REVISION = (
    "INSERT INTO revision (rev_id, page_id, ts, valid_from, parent_id, user, anonymous, minor, comment, sha1, bytes)"
    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
)
INSERT_ARTICLE = (
    "INSERT INTO article (page_id, title, revisions, first_ts, last_ts, tier, text_missing_revisions)"
    " VALUES (%s, %s, %s, %s, %s, %s, %s)"
)


@dataclass(frozen=True)
class PageReport:
    page_id: int
    title: str
    revisions: int
    paragraph_rows: int
    wordings: int
    text_missing: int
    seconds: float


class AlreadyLoaded(Exception):
    """The article is in the database already."""


class RoundTripError(Exception):
    """The stored state at a revision's moment differs from that revision's cleaned text."""

    def __init__(self, rev_id: int, expected: int, got: int) -> None:
        super().__init__(f"revision {rev_id}: expected {expected} blocks, the database returned {got} or other ones")
        self.rev_id = rev_id
        self.expected = expected
        self.got = got


def _walk(revisions: Sequence[RawRevision]) -> Iterator[tuple[RawRevision, datetime, PageState]]:
    """Each revision in valid-from order with the article's state after it."""
    by_id = {rev.rev_id: rev for rev in revisions}
    prev: PageState | None = None
    memory = Memory()
    ordered = assign_valid_from([(rev.rev_id, rev.timestamp) for rev in revisions])
    for index, (rev_id, valid_from) in enumerate(ordered):
        rev = by_id[rev_id]
        if rev.text_missing:
            state = carry_forward(prev, rev_id)
        else:
            state, memory = match_revision(prev, clean(rev.text), rev_id, rev.sha1, memory, index)
        prev = state
        yield rev, valid_from, state


def _row_values(row: ParagraphRow) -> tuple[Any, ...]:
    values = (row.page_id, row.para_id, row.pos, row.hash, row.rev_id, row.match_rule, row.similarity, row.row_start)
    return values if row.row_end is None else (*values, row.row_end)


def _revision_values(rev: RawRevision, valid_from: datetime) -> tuple[Any, ...]:
    return (rev.rev_id, rev.page_id, rev.timestamp, valid_from, rev.parent_id, rev.user, rev.anonymous,
            rev.minor, rev.comment, rev.sha1, rev.bytes)


def _write(cur: Cursor, revisions: Sequence[RawRevision], tier: int) -> tuple[int, int, int]:
    """Insert everything for one article. Returns (paragraph rows, wordings, missing-text revisions)."""
    page_id = revisions[0].page_id
    open_rows: OpenRows = {}
    seen: set[bytes] = set()
    wordings: list[tuple[bytes, str, str]] = []
    wording_bytes = 0
    history: list[tuple[Any, ...]] = []
    revision_rows: list[tuple[Any, ...]] = []
    paragraph_rows = missing = 0
    for rev, valid_from, state in _walk(revisions):
        revision_rows.append(_revision_values(rev, valid_from))
        missing += state.text_missing
        for para in state.paras:
            if para.block.hash not in seen:
                seen.add(para.block.hash)
                wordings.append((para.block.hash, para.block.kind, para.block.text))
                wording_bytes += len(para.block.text) * 2
        open_rows, closed = advance(page_id, open_rows, state, valid_from)
        history.extend(_row_values(row) for row in closed)
        if wording_bytes > BATCH_BYTES or len(history) >= ROW_BATCH:
            cur.executemany(INSERT_WORDING, sorted(wordings))
            cur.executemany(INSERT_HISTORY, history)
            paragraph_rows += len(history)
            wordings, wording_bytes, history = [], 0, []
    cur.executemany(INSERT_WORDING, sorted(wordings))
    cur.executemany(INSERT_HISTORY, history)
    cur.executemany(INSERT_CURRENT, [_row_values(row) for row in open_rows.values()])
    cur.executemany(INSERT_REVISION, revision_rows)
    timestamps = [rev.timestamp for rev in revisions]
    cur.execute(INSERT_ARTICLE, (page_id, revisions[-1].title, len(revisions), min(timestamps), max(timestamps),
                                 tier, missing))
    return paragraph_rows + len(history) + len(open_rows), len(seen), missing


def ingest_page(con: Connection, revisions: Sequence[RawRevision], tier: int) -> PageReport:
    """Load one article in one transaction."""
    if not revisions:
        raise ValueError("an article needs at least one revision")
    started = time.perf_counter()
    page_id = revisions[0].page_id
    con.rollback()   # start from a clean transaction; nothing of the caller's is pending here
    with con.cursor() as cur:
        # Loaders run side by side and share wordings (common headings). Under the default
        # isolation a wording committed by another loader after this transaction began makes
        # the insert fail with error 1020; READ COMMITTED sees it and ignores the duplicate.
        cur.execute("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
        cur.execute("SELECT 1 FROM article WHERE page_id = %s", (page_id,))
        if cur.fetchone() is not None:
            raise AlreadyLoaded(f"article {page_id} is already loaded")
    enable_history_insert(con)
    try:
        with con.cursor() as cur:
            paragraph_rows, wordings, missing = _write(cur, revisions, tier)
        con.commit()
    except BaseException:
        con.rollback()
        raise
    return PageReport(page_id=page_id, title=revisions[-1].title, revisions=len(revisions),
                      paragraph_rows=paragraph_rows, wordings=wordings, text_missing=missing,
                      seconds=time.perf_counter() - started)


def verify_page(con: Connection, revisions: Sequence[RawRevision], every: int = 25) -> int:
    """Round trip: at the moment of the first, the last and every Nth revision, the stored
    article must equal that revision's cleaned text. Returns how many were checked."""
    with_text = [rev for rev in sorted(revisions, key=lambda r: (r.timestamp, r.rev_id)) if not rev.text_missing]
    if not with_text:
        return 0
    with con.cursor() as cur:
        cur.execute("SELECT rev_id, valid_from FROM revision WHERE page_id = %s", (with_text[0].page_id,))
        valid_from = dict(cur.fetchall())
    picks = sorted({0, len(with_text) - 1, *range(0, len(with_text), max(1, every))})
    for i in picks:
        rev = with_text[i]
        expected = [block.hash for block in clean(rev.text)]
        got = [block.hash for block in frame_at(con, rev.page_id, valid_from[rev.rev_id]).blocks]
        if got != expected:
            raise RoundTripError(rev.rev_id, len(expected), len(got))
    return len(picks)


def _ingest_with_retry(con: Connection, revisions: Sequence[RawRevision], tier: int) -> PageReport:  # pragma: no cover
    """Lock waits and deadlocks between loaders are transient: the article is tried again."""
    for attempt in range(RETRIES):
        try:
            return ingest_page(con, revisions, tier)
        except pymysql.err.OperationalError as error:
            if error.args[0] not in RETRYABLE_ERRORS or attempt == RETRIES - 1:
                raise
            log.warning("article %s: %s, trying again", revisions[0].page_id, error.args[1])
    raise AssertionError("unreachable")


def _unlist(con: Connection, page_id: int) -> None:  # pragma: no cover - CLI worker
    """Take an article that failed its round trip off the list. Its versioned rows cannot be
    deleted one article at a time, so they stay, unreachable, until the next --reset."""
    with con.cursor() as cur:
        cur.execute("DELETE FROM article WHERE page_id = %s", (page_id,))
        cur.execute("DELETE FROM revision WHERE page_id = %s", (page_id,))
    con.commit()


def _ingest_file(task: tuple[str, list[int] | None, list[int], int]) -> list[str]:  # pragma: no cover - CLI worker
    """Worker: load the wanted articles of one Parquet file. Returns one log line per article."""
    path, wanted, tier1, verify_every = task
    con = connect(load_settings())
    lines: list[str] = []
    try:
        with con.cursor() as cur:
            cur.execute("SELECT page_id FROM article")
            loaded = {page_id for (page_id,) in cur.fetchall()}
        for revisions in iter_pages([Path(path)], wanted):
            page_id, title = revisions[0].page_id, revisions[-1].title
            if page_id in loaded:
                lines.append(f"{title}: already loaded, skipped")
                continue
            # One article that cannot be loaded or does not round-trip must not stop the rest.
            try:
                report = _ingest_with_retry(con, revisions, tier=1 if page_id in tier1 else 2)
            except Exception as error:  # noqa: BLE001 - reported per article, the run goes on
                lines.append(f"FAILED {title} (page {page_id}): {type(error).__name__}: {error}")
                continue
            try:
                checked = verify_page(con, revisions, verify_every) if verify_every else 0
            except RoundTripError as error:
                _unlist(con, page_id)
                lines.append(f"FAILED {title} (page {page_id}): round trip: {error}; not listed")
                continue
            lines.append(
                f"{report.title}: {report.revisions} revisions, {report.paragraph_rows} paragraph rows, "
                f"{report.wordings} wordings, {report.text_missing} without text, {report.seconds:.1f} s"
                + (f"; round trip ok: {checked} revisions checked" if verify_every else "")
            )
    finally:
        con.close()
    return lines


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - CLI
    parser = argparse.ArgumentParser(description="Load dataset M into versioned paragraphs.")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--pages", help="comma-separated page ids")
    scope.add_argument("--tier1", action="store_true", help="the starter's 50 articles")
    scope.add_argument("--all", action="store_true", help="every article in dataset M")
    parser.add_argument("--reset", action="store_true", help="drop and recreate the tables first; vectors are kept")
    parser.add_argument("--drop-vectors", action="store_true", help="with --reset: drop the vectors as well")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--verify-every", type=int, default=25, help="round-trip check every Nth revision; 0 = off")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    tier1 = tier1_page_ids()
    wanted = [int(p) for p in args.pages.split(",")] if args.pages else tier1 if args.tier1 else None
    files = download_m(DATA_DIR)
    con = connect(load_settings())
    try:
        if args.reset or not schema_exists(con):
            apply_schema(con, keep_vectors=args.reset and not args.drop_vectors)
            log.info("tables created" if not args.reset else "tables dropped and recreated")
    finally:
        con.close()
    started = time.perf_counter()
    tasks = [(str(path), wanted, tier1 if not args.pages else wanted or [], args.verify_every) for path in files]
    with get_context("spawn").Pool(max(1, args.workers)) as pool:
        loaded = failed = 0
        for lines in pool.imap_unordered(_ingest_file, tasks):
            for line in lines:
                failed += line.startswith("FAILED")
                loaded += "paragraph rows" in line
                if args.all and not line.startswith("FAILED"):
                    continue          # thousands of articles: only failures and the totals are printed
                log.info(line)
    log.info("loaded %s articles, %s failed, in %.0f s", loaded, failed, time.perf_counter() - started)
    return 1 if failed else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
