"""Ingest of the scripted fixture article, checked against the cleaner's own output."""
import hashlib
from datetime import UTC, datetime, timedelta

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from wikilens import ingest
from wikilens.cleaner import clean
from wikilens.db import apply_schema
from wikilens.fixture import FIXTURE_PAGE_ID, fixture_revisions, load_fixture
from wikilens.ingest import AlreadyLoaded, RoundTripError, ingest_page, verify_page
from wikilens.parquet_source import ChecksumError, iter_pages, parse_checksums, verify_checksums
from wikilens.queries import frame_at, wordings_by_hash


def texts(con, t):
    blocks = frame_at(con, FIXTURE_PAGE_ID, t).blocks
    wordings = wordings_by_hash(con, [b.hash for b in blocks])
    return [wordings[b.hash] for b in blocks]


def valid_from(con, rev_id):
    cur = con.cursor()
    cur.execute("SELECT valid_from FROM revision WHERE rev_id = %s", (rev_id,))
    return cur.fetchone()[0]


def count(con, sql):
    cur = con.cursor()
    cur.execute(sql)
    return cur.fetchone()[0]


def test_round_trip_every_revision(con):
    load_fixture(con)
    for rev in fixture_revisions():
        if rev.text == "":
            continue
        expected = [(b.kind, b.text) for b in clean(rev.text)]
        assert texts(con, valid_from(con, rev.rev_id)) == expected, rev.rev_id


def test_before_first_revision_is_empty(con):
    load_fixture(con)
    assert texts(con, datetime(2009, 1, 1)) == []


def test_same_second_revisions_ordered_by_rev_id(con):
    load_fixture(con)
    t = datetime(2016, 1, 1)
    assert ("p", "Toinen kappale muuttuu.") in texts(con, t)
    assert ("p", "Toinen kappale muuttuu taas.") in texts(con, t + timedelta(microseconds=1))


def test_original_timestamp_is_kept(con):
    load_fixture(con)
    cur = con.cursor()
    cur.execute("SELECT ts, valid_from FROM revision WHERE rev_id = 109")
    assert cur.fetchone() == (datetime(2016, 1, 1), datetime(2016, 1, 1, 0, 0, 0, 1))


def test_missing_text_revision_carries_state_and_is_counted(con):
    load_fixture(con)
    assert texts(con, datetime(2017, 6, 1)) == texts(con, datetime(2016, 6, 1))
    cur = con.cursor()
    cur.execute("SELECT revisions, text_missing_revisions, tier, title FROM article WHERE page_id = 1")
    assert cur.fetchone() == (10, 1, 1, "Testisota")


def test_report_counts(con):
    apply_schema(con)
    report = ingest_page(con, fixture_revisions(), tier=1)
    assert (report.page_id, report.title, report.revisions, report.text_missing) == (1, "Testisota", 10, 1)
    assert report.paragraph_rows == count(con, "SELECT COUNT(*) FROM paragraph FOR SYSTEM_TIME ALL")
    assert report.wordings == count(con, "SELECT COUNT(*) FROM wording") == 9


def test_ingest_twice_raises_already_loaded(con):
    load_fixture(con)
    with pytest.raises(AlreadyLoaded):
        ingest_page(con, fixture_revisions(), tier=1)


def test_failed_ingest_leaves_nothing_behind(con, monkeypatch):
    apply_schema(con)
    calls = {"n": 0}
    real_advance = ingest.advance

    def failing_advance(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 5:
            raise RuntimeError("boom")
        return real_advance(*args, **kwargs)

    monkeypatch.setattr(ingest, "advance", failing_advance)
    with pytest.raises(RuntimeError):
        ingest_page(con, fixture_revisions(), tier=1)
    for table in ("article", "revision", "wording", "paragraph FOR SYSTEM_TIME ALL"):
        assert count(con, f"SELECT COUNT(*) FROM {table}") == 0, table


def test_verify_page_counts_and_detects_a_wrong_state(con):
    load_fixture(con)
    assert verify_page(con, fixture_revisions(), every=1) == 9
    assert verify_page(con, fixture_revisions(), every=100) == 2   # first and last only
    cur = con.cursor()
    cur.execute("UPDATE revision SET valid_from = '2010-06-01' WHERE rev_id = 107")
    con.commit()
    with pytest.raises(RoundTripError) as error:
        verify_page(con, fixture_revisions(), every=1)
    assert error.value.rev_id == 107


def write_parquet(path, rows):
    schema = pa.schema([
        ("page_id", pa.uint32()), ("title", pa.string()), ("rev_id", pa.uint32()), ("parent_id", pa.uint32()),
        ("timestamp", pa.timestamp("s", tz="UTC")), ("user", pa.string()), ("anonymous", pa.bool_()),
        ("comment", pa.string()), ("minor", pa.bool_()), ("sha1", pa.string()), ("bytes", pa.uint32()),
        ("text", pa.string()),
    ])  # the schema of dataset M (dataset_m.py in MariaDB/mariadb-wikipedia-datasets)
    writer = pq.ParquetWriter(path, schema)
    for page_rows in rows:   # one row group per article, as dataset M is written
        writer.write_table(pa.Table.from_pylist(page_rows, schema))
    writer.close()


def row(page_id, rev_id, ts, text="x"):
    return {"page_id": page_id, "title": f"Sivu {page_id}", "rev_id": rev_id, "parent_id": None,
            "timestamp": ts.replace(tzinfo=UTC), "user": "u", "anonymous": False, "comment": None,
            "minor": False, "sha1": None, "bytes": len(text), "text": text}


def test_iter_pages_groups_by_article_oldest_first(tmp_path):
    path = tmp_path / "versions-01.parquet"
    write_parquet(path, [
        [row(1, 10, datetime(2010, 1, 1)), row(1, 11, datetime(2011, 1, 1))],
        [row(2, 21, datetime(2012, 1, 1)), row(2, 20, datetime(2011, 1, 1))],
    ])
    only_two = list(iter_pages([path], {2}))
    assert [[r.rev_id for r in page] for page in only_two] == [[20, 21]]
    assert only_two[0][0].timestamp == datetime(2011, 1, 1)          # naive UTC
    assert only_two[0][0].parent_id is None and only_two[0][0].title == "Sivu 2"
    assert [[r.rev_id for r in page] for page in iter_pages([path])] == [[10, 11], [20, 21]]


def test_checksums(tmp_path):
    (tmp_path / "versions-01.parquet").write_bytes(b"abc")
    good = hashlib.sha256(b"abc").hexdigest()
    sums = parse_checksums(f"{good}  versions-01.parquet\n")
    assert verify_checksums(tmp_path, sums) == [tmp_path / "versions-01.parquet"]
    with pytest.raises(ChecksumError, match="versions-01.parquet"):
        verify_checksums(tmp_path, {"versions-01.parquet": "0" * 64})
    with pytest.raises(ChecksumError, match="versions-02.parquet"):
        verify_checksums(tmp_path, {"versions-02.parquet": good})
