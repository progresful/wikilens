"""Proof that MariaDB does what the design leans on: real edit times in a system-versioned
table, half-open AS OF reads, a gap under one key, and vector ranking over all history."""
from datetime import datetime

import pytest

from wikilens.db import enable_history_insert
from wikilens.queries import closest_wordings, frame_at, nearest_wordings, rank_paragraphs, vector_literal

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


def test_closest_wording_of_a_paragraph_can_be_one_it_no_longer_has(con):
    # Paragraph 1 reads H2 today; the question matches H1, which it stopped being in 2012.
    assert closest_wordings(con, PAGE, unit(0), [1, 2]) == {1: H1, 2: H3}
    assert closest_wordings(con, PAGE, unit(1), [1]) == {1: H2}


def test_closest_wording_prefers_todays_on_a_tie_and_skips_one_too_brief_to_draw(con):
    """Page 8. Paragraph 1: H4 2010-2012, H5 from 2012, both with the same vector.
    Paragraph 2: H6 for half a millisecond in 2011 (the question's exact match), then H7."""
    h4, h5, h6, h7 = b"\x04" * 16, b"\x05" * 16, b"\x06" * 16, b"\x07" * 16
    enable_history_insert(con)
    cur = con.cursor()
    columns = "page_id, para_id, pos, hash, rev_id, match_rule, similarity, row_start"
    cur.executemany(
        f"INSERT INTO paragraph ({columns}, row_end) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        [
            (8, 1, 1.0, h4, 201, 1, None, T("2010-01-01"), T("2012-01-01")),
            (8, 2, 2.0, h6, 203, 1, None, T("2011-01-01 00:00:00"), T("2011-01-01 00:00:00.000500")),
        ],
    )
    cur.executemany(
        f"INSERT INTO paragraph ({columns}) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        [(8, 1, 1.0, h5, 202, 4, 0.9, T("2012-01-01")), (8, 2, 2.0, h7, 204, 4, 0.9, T("2011-01-01 00:00:00.000500"))],
    )
    cur.executemany("INSERT INTO wording (hash, kind, text) VALUES (%s, %s, %s)",
                    [(h4, "p", "neljä"), (h5, "p", "viisi"), (h6, "p", "kuusi"), (h7, "p", "seitsemän")])
    cur.executemany(
        "INSERT INTO wording_vector (hash, embedding) VALUES (%s, VEC_FromText(%s))",
        [(h4, vector_literal(unit(3))), (h5, vector_literal(unit(3))),
         (h6, vector_literal(unit(4))), (h7, vector_literal(unit(5)))],
    )
    con.commit()
    # Equally close: the wording the paragraph has today is named, not an old one that sorts first.
    assert closest_wordings(con, 8, unit(3), [1]) == {1: h5}
    # The exact match stood under a millisecond and is never drawn on the timeline, so it is not named.
    assert closest_wordings(con, 8, unit(4), [2]) == {2: h7}


def test_closest_wording_of_no_paragraphs_asks_nothing(con):
    assert closest_wordings(con, PAGE, unit(0), []) == {}


def test_vector_index_on_plain_table(con):
    assert nearest_wordings(con, unit(2), limit=1)[0][0] == H3
