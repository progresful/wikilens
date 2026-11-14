from datetime import datetime, timedelta

from wikilens.timeline import HistoryRow, build_timeline, format_duration

D = datetime
END = D(2026, 10, 1, 23, 59, 59)


def row(h, start, end, sim=None, rule=4):
    return HistoryRow(bytes([h]) * 16, 100 + h, start, end, f"text{h}", rule, sim)


def labels(rows):
    return [s.label for s in build_timeline(rows, END)]


def test_single_row():
    (s,) = build_timeline([row(1, D(2010, 1, 1), None)], END)
    assert (s.label, s.end, s.tone, s.kind) == ("first appears", END, 0, "wording")
    assert (s.text, s.rev_id, s.hash) == ("text1", 101, b"\x01" * 16)


def test_text_changed_and_heavily_rewritten():
    rows = [
        row(1, D(2010, 1, 1), D(2011, 1, 1)),
        row(2, D(2011, 1, 1), D(2012, 1, 1), sim=0.65),
        row(3, D(2012, 1, 1), None, sim=0.55),
    ]
    segs = build_timeline(rows, END)
    assert [s.label for s in segs] == ["first appears", "text changed", "heavily rewritten"]
    assert [s.loose for s in segs] == [False, False, True]
    assert [s.tone for s in segs] == [0, 1, 2]


def test_position_only_rows_merge():
    assert labels([row(1, D(2010, 1, 1), D(2011, 1, 1)), row(1, D(2011, 1, 1), None)]) == ["first appears"]


def test_gap_then_restored_unchanged():
    rows = [row(1, D(2010, 1, 1), D(2011, 1, 1)), row(1, D(2012, 1, 1), None)]
    segs = build_timeline(rows, END)
    assert [s.label for s in segs] == ["first appears", "removed", "restored unchanged"]
    gap = segs[1]
    assert (gap.kind, gap.start, gap.end, gap.hash, gap.text, gap.rev_id, gap.tone) == (
        "gap", D(2011, 1, 1), D(2012, 1, 1), None, None, None, -1)


def test_gap_then_restored_reworded():
    assert labels([row(1, D(2010, 1, 1), D(2011, 1, 1)), row(2, D(2012, 1, 1), None)])[-1] == "restored, reworded"


def test_replaced_then_reverted():
    rows = [
        row(1, D(2011, 1, 1), D(2012, 1, 1, 10, 0)),
        row(9, D(2012, 1, 1, 10, 0), D(2012, 1, 1, 10, 7)),
        row(1, D(2012, 1, 1, 10, 7), None),
    ]
    segs = build_timeline(rows, END)
    assert [s.label for s in segs] == ["first appears", "replaced, reverted after 7 min", "restored unchanged"]
    assert [s.reverted for s in segs] == [False, True, False]
    assert segs[2].tone == segs[0].tone


def test_a_change_before_a_removal_is_not_a_revert():
    rows = [row(1, D(2010, 1, 1), D(2011, 1, 1)), row(2, D(2011, 1, 1), D(2012, 1, 1)), row(1, D(2013, 1, 1), None)]
    segs = build_timeline(rows, END)
    assert [s.label for s in segs] == ["first appears", "text changed", "removed", "restored unchanged"]
    assert not any(s.reverted for s in segs)


def test_trailing_removal_runs_to_corpus_end():
    segs = build_timeline([row(1, D(2010, 1, 1), D(2011, 1, 1))], END)
    assert (segs[-1].kind, segs[-1].label, segs[-1].start, segs[-1].end) == ("gap", "removed", D(2011, 1, 1), END)


def test_sub_millisecond_wording_is_dropped():
    t = D(2016, 1, 1)
    one = timedelta(microseconds=1)
    segs = build_timeline([row(1, D(2010, 1, 1), t), row(2, t, t + one), row(3, t + one, None)], END)
    assert [s.label for s in segs] == ["first appears", "text changed"]
    assert segs[0].end == segs[1].start        # no hole where the dropped wording was


def test_rows_in_any_order():
    rows = [row(2, D(2011, 1, 1), None), row(1, D(2010, 1, 1), D(2011, 1, 1))]
    assert labels(rows) == ["first appears", "text changed"]


def test_no_rows():
    assert build_timeline([], END) == []


def test_format_duration():
    f = format_duration
    assert f(timedelta(seconds=20)) == "under a minute"
    assert f(timedelta(minutes=7)) == "7 min"
    assert f(timedelta(hours=5)) == "5 h"
    assert f(timedelta(days=12)) == "12 days"
    assert f(timedelta(days=1218)) == "3y 4mo"
    assert f(timedelta(days=1096)) == "3y"
    assert f(timedelta(days=90)) == "3mo"
