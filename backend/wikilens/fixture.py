"""A small scripted article, "Testisota", used by pytest and by the browser tests.

    python -m wikilens.fixture --db wikilens_e2e     # reset that database and load the fixture

Its first paragraph is the one the tests track. Its life:
  2010-03-01  first appears
  2011-01-01  text changed
  2012-01-01  10:00 replaced, 10:07 reverted
  2013-01-01  removed
  2014-01-01  restored unchanged
  2015-01-01  text changed
The second paragraph changes twice within one second in 2016, and the 2017 revision has no text.
"""
from __future__ import annotations

import argparse
import hashlib
import logging
from collections.abc import Sequence
from datetime import datetime

from pymysql.connections import Connection

from wikilens.config import load_settings
from wikilens.db import apply_schema, connect
from wikilens.embed import embed_missing
from wikilens.embedder import StubEmbedder
from wikilens.ingest import ingest_page
from wikilens.parquet_source import RawRevision

FIXTURE_PAGE_ID = 1
FIXTURE_TITLE = "Testisota"
FIXTURE_MIN_EMBED_CHARS = 20   # the fixture's paragraphs are short; real articles use embed.MIN_EMBED_CHARS

HEADING = "== Tausta =="
FIRST_A = "Talvisota alkoi marraskuussa 1939, kun Neuvostoliitto hyökkäsi Suomeen."
FIRST_B = "Talvisota alkoi 30. marraskuuta 1939, kun Neuvostoliitto hyökkäsi Suomeen."
FIRST_LOL = "Talvisota alkoi 30. marraskuuta 1939, kun Neuvostoliitto hyökkäsi Suomeen lol."
FIRST_C = "Talvisota alkoi 30. marraskuuta 1939, kun Neuvostoliitto hyökkäsi Suomeen ilman sodanjulistusta."
SECOND_A = "Toinen kappale pysyy."
SECOND_B = "Toinen kappale muuttuu."
SECOND_C = "Toinen kappale muuttuu taas."
THIRD = "Kolmas kappale tulee."

_SCRIPT: tuple[tuple[int, datetime, tuple[str, ...] | None], ...] = (
    (101, datetime(2010, 3, 1), (HEADING, FIRST_A, SECOND_A)),
    (102, datetime(2011, 1, 1), (HEADING, FIRST_B, SECOND_A)),
    (103, datetime(2012, 1, 1, 10, 0), (HEADING, FIRST_LOL, SECOND_A)),
    (104, datetime(2012, 1, 1, 10, 7), (HEADING, FIRST_B, SECOND_A)),
    (105, datetime(2013, 1, 1), (HEADING, SECOND_A)),
    (106, datetime(2014, 1, 1), (HEADING, FIRST_B, SECOND_A, THIRD)),
    (107, datetime(2015, 1, 1), (HEADING, FIRST_C, SECOND_A, THIRD)),
    (108, datetime(2016, 1, 1), (HEADING, FIRST_C, SECOND_B, THIRD)),
    (109, datetime(2016, 1, 1), (HEADING, FIRST_C, SECOND_C, THIRD)),
    (110, datetime(2017, 1, 1), None),   # the dump carried no text for this one
)


def fixture_revisions() -> list[RawRevision]:
    revisions: list[RawRevision] = []
    for rev_id, timestamp, lines in _SCRIPT:
        text = "\n".join(lines) if lines is not None else ""
        revisions.append(RawRevision(
            page_id=FIXTURE_PAGE_ID,
            title=FIXTURE_TITLE,
            rev_id=rev_id,
            parent_id=rev_id - 1 if rev_id > 101 else None,
            timestamp=timestamp,
            user="192.0.2.1" if rev_id == 103 else "Testaaja",
            anonymous=rev_id == 103,
            comment=None,
            minor=False,
            sha1=hashlib.sha1(text.encode(), usedforsecurity=False).hexdigest()[:31] if lines is not None else None,
            bytes=len(text.encode()) if lines is not None else 500,
            text=text,
        ))
    return revisions


SECOND_PAGE_ID = 2
SECOND_TITLE = "Toinen artikkeli"


def second_article_revisions() -> list[RawRevision]:
    """A small second article, for tests that move from one article to another. Its paragraph
    numbers overlap the first article's on purpose."""
    script = (
        (201, datetime(2012, 6, 1), ("== Alku ==", "Toisen artikkelin ensimmäinen kappale.", "Toisen artikkelin toinen kappale.")),
        (202, datetime(2014, 6, 1), ("== Alku ==", "Toisen artikkelin ensimmäinen kappale, muokattuna.", "Toisen artikkelin toinen kappale.")),
    )
    revisions: list[RawRevision] = []
    for rev_id, timestamp, lines in script:
        text = "\n".join(lines)
        revisions.append(RawRevision(
            page_id=SECOND_PAGE_ID, title=SECOND_TITLE, rev_id=rev_id, parent_id=rev_id - 1 if rev_id > 201 else None,
            timestamp=timestamp, user="Testaaja", anonymous=False, comment=None, minor=False,
            sha1=hashlib.sha1(text.encode(), usedforsecurity=False).hexdigest()[:31], bytes=len(text.encode()), text=text,
        ))
    return revisions


def load_fixture(con: Connection, two_articles: bool = False) -> None:
    """Drop every table, load the fixture article (and the second one if asked), and give
    their paragraphs stub vectors."""
    apply_schema(con)
    ingest_page(con, fixture_revisions(), tier=1)
    page_ids = [FIXTURE_PAGE_ID]
    if two_articles:
        ingest_page(con, second_article_revisions(), tier=1)
        page_ids.append(SECOND_PAGE_ID)
    embed_missing(con, StubEmbedder(), page_ids, min_chars=FIXTURE_MIN_EMBED_CHARS)


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - CLI
    parser = argparse.ArgumentParser(description="Reset a database and load the test article.")
    parser.add_argument("--db", required=True, help="database name, e.g. wikilens_e2e")
    parser.add_argument("--two-articles", action="store_true", help="also load a small second article")
    args = parser.parse_args(argv)
    if not args.db.startswith("wikilens_"):
        parser.error("refusing to reset a database that is not a wikilens_ test database")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    con = connect(load_settings(), database=args.db)
    try:
        load_fixture(con, two_articles=args.two_articles)
    finally:
        con.close()
    logging.getLogger(__name__).info("fixture loaded into %s", args.db)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
