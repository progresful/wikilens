from datetime import datetime, timedelta

from wikilens.blocks import Block
from wikilens.history_rows import advance, assign_valid_from
from wikilens.matcher import PageState, Para, Rule

t1, t2, t3 = datetime(2010, 1, 1), datetime(2011, 1, 1), datetime(2012, 1, 1)


def us(n):
    return timedelta(microseconds=n)


def para(i, text, pos=None, rule=Rule.NEW, sim=None):
    return Para(i, pos or float(i), Block.of("p", text), rule, sim)


def st(rev, *paras):
    return PageState(rev, tuple(paras))


def test_same_second_revisions_one_microsecond_apart():
    assert assign_valid_from([(5, t1), (3, t1), (9, t1)]) == [(3, t1), (5, t1 + us(1)), (9, t1 + us(2))]


def test_distinct_times_are_kept_and_sorted():
    assert assign_valid_from([(2, t2), (1, t1)]) == [(1, t1), (2, t2)]


def test_a_later_revision_never_precedes_a_nudged_one():
    assert assign_valid_from([(1, t1), (2, t1), (3, t1 + us(1))]) == [(1, t1), (2, t1 + us(1)), (3, t1 + us(2))]


def test_unchanged_paragraph_emits_nothing():
    o, _ = advance(7, {}, st(1, para(1, "a")), t1)
    o2, closed = advance(7, o, st(2, para(1, "a", rule=Rule.UNCHANGED)), t2)
    assert closed == []
    assert o2[1].row_start == t1


def test_first_state_opens_rows():
    o, closed = advance(7, {}, st(1, para(1, "a"), para(2, "b")), t1)
    assert closed == []
    assert [(r.page_id, r.para_id, r.row_start, r.row_end, r.rev_id) for r in o.values()] == [
        (7, 1, t1, None, 1),
        (7, 2, t1, None, 1),
    ]


def test_edit_closes_and_opens():
    o, _ = advance(7, {}, st(1, para(1, "a")), t1)
    o2, closed = advance(7, o, st(2, para(1, "b", rule=Rule.EDITED, sim=0.7)), t2)
    assert (closed[0].row_start, closed[0].row_end) == (t1, t2)
    assert closed[0].hash == Block.of("p", "a").hash
    new = o2[1]
    assert (new.row_start, new.row_end, new.rev_id, new.match_rule, new.similarity) == (t2, None, 2, 4, 0.7)
    assert new.hash == Block.of("p", "b").hash


def test_position_only_change_closes_and_opens():
    o, _ = advance(7, {}, st(1, para(1, "a", pos=1.0)), t1)
    o2, closed = advance(7, o, st(2, para(1, "a", pos=0.5, rule=Rule.MOVED)), t2)
    assert len(closed) == 1
    assert o2[1].pos == 0.5


def test_removal_closes_and_restore_reopens_same_para_id():
    o, _ = advance(7, {}, st(1, para(1, "a"), para(2, "b")), t1)
    o, closed = advance(7, o, st(2, para(1, "a")), t2)
    assert [c.para_id for c in closed] == [2]
    assert 2 not in o
    o, closed = advance(7, o, st(3, para(1, "a"), para(2, "b", rule=Rule.RESTORED)), t3)
    assert closed == []
    assert o[2].row_start == t3


def test_carry_forward_state_changes_nothing():
    o, _ = advance(7, {}, st(1, para(1, "a")), t1)
    o2, closed = advance(7, o, PageState(2, (para(1, "a"),), text_missing=True), t2)
    assert closed == []
    assert o2[1].rev_id == 1


def test_open_rows_passed_in_are_not_altered():
    o, _ = advance(7, {}, st(1, para(1, "a")), t1)
    before = dict(o)
    advance(7, o, st(2, para(1, "b")), t2)
    assert dict(o) == before
