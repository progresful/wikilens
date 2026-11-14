"""Proof that MariaDB does what the design leans on: real edit times in a system-versioned
table, half-open AS OF reads, a gap under one key, and vector ranking over all history."""
from datetime import datetime

import pytest

from wikilens.db import enable_history_insert
from wikilens.queries import frame_at, nearest_wordings, rank_paragraphs, vector_literal

T = datetime.fromisoformat
H1, H2, H3 = b"\x01" * 16, b"\x02" * 16, b"\x03" * 16
PAGE = 7


def unit(i):
    return [1.0 if k == i else 0.0 for k in range(1024)]


@pytest.fixture(scope="module", autouse=True)
def seeded(con):
    """Page 7. Paragraph 1: H1 2010-2012, H2 2012-2014, absent 2014-2015, H2 again from 2015.
    Paragraph 2: H3 from 2011. Vectors: H1 -> e0, H2 -> e1, H3 -> e2."""
    enable_history_insert(con)
    cur = con.cursor()
    columns = "page_id, para_id, pos, hash, rev_id, match_rule, similarity, row_start"
    cur.executemany(
        f"INSERT INTO paragraph ({columns}, row_end) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        [
            (PAGE, 1, 1.0, H1, 101, 1, None, T("2010-01-01"), T("2012-01-01")),
            (PAGE, 1, 1.0, H2, 102, 4, 0.8, T("2012-01-01"), T("2014-01-01")),
        ],
    )
    cur.executemany(
        f"INSERT INTO paragraph ({columns}) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        [
            (PAGE, 1, 1.0, H2, 104, 5, None, T("2015-01-01")),
            (PAGE, 2, 2.0, H3, 103, 1, None, T("2011-01-01")),
        ],
    )
    cur.executemany(
        "INSERT INTO wording (hash, kind, text) VALUES (%s, %s, %s)",
        [(H1, "p", "yksi"), (H2, "p", "kaksi"), (H3, "p", "kolme")],
    )
    cur.executemany(
        "INSERT INTO wording_vector (hash, embedding) VALUES (%s, VEC_FromText(%s))",
        [(H1, vector_literal(unit(0))), (H2, vector_literal(unit(1))), (H3, vector_literal(unit(2)))],
    )
    con.commit()


def state(con, t):
    return [(b.para_id, b.hash) for b in frame_at(con, PAGE, T(t)).blocks]


def test_as_of_returns_state_at_moment(con):
    assert state(con, "2011-06-01") == [(1, H1), (2, H3)]


def test_boundary_is_half_open(con):
    assert state(con, "2012-01-01 00:00:00") == [(1, H2), (2, H3)]
    assert state(con, "2011-12-31 23:59:59.999999") == [(1, H1), (2, H3)]


def test_gap_then_restore_under_same_key(con):
    assert state(con, "2014-06-01") == [(2, H3)]
    assert state(con, "2015-06-01") == [(1, H2), (2, H3)]


def test_before_first_row_is_empty(con):
    assert state(con, "2009-01-01") == []


def test_frame_reports_sql_and_time(con):
    r = frame_at(con, PAGE, T("2011-06-01"))
    assert "FOR SYSTEM_TIME AS OF TIMESTAMP '2011-06-01 00:00:00" in r.sql
    assert r.db_ms >= 0


def test_rank_over_all_history_finds_a_wording_that_is_gone(con):
    para_id, distance = rank_paragraphs(con, PAGE, unit(0))[0]
    assert para_id == 1
    assert distance == pytest.approx(0.0, abs=1e-6)


def test_vector_index_on_plain_table(con):
    assert nearest_wordings(con, unit(2), limit=1)[0][0] == H3
