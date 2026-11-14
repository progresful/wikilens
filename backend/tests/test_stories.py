from datetime import datetime

from wikilens.fixture import load_fixture
from wikilens.stories import find_candidates, render_candidates, render_life

END = datetime(2026, 10, 1, 23, 59, 59)


def test_fixture_top_candidate_is_the_edited_paragraph(con):
    load_fixture(con)
    best = find_candidates(con, 1, END, min_chars=0)[0]
    assert (best.para_id, best.wordings, best.reverted, best.gaps) == (2, 4, 1, 1)
    assert "ilman sodanjulistusta" in best.latest_text
    assert (best.first, best.last) == (datetime(2010, 3, 1), datetime(2015, 1, 1))


def test_candidates_are_ordered_by_score_and_limited(con):
    load_fixture(con)
    found = find_candidates(con, 1, END, top=2, min_chars=0)
    assert [c.para_id for c in found] == [2, 3]
    assert find_candidates(con, 1, END, min_chars=200) == []      # the fixture's paragraphs are short


def test_render_candidates_is_a_markdown_table(con):
    load_fixture(con)
    text = render_candidates("Testisota", 1, find_candidates(con, 1, END, min_chars=0))
    assert text.startswith("## Testisota (page 1)")
    assert "| 2 | 4 | 1 | 1 |" in text


def test_render_life_lists_every_segment_with_a_revision_link(con):
    load_fixture(con)
    text = render_life(con, 1, 2, END)
    assert text.count("\n- ") == 7
    assert "replaced, reverted after 7 min" in text
    assert "https://fi.wikipedia.org/?oldid=103" in text
    assert "removed" in text
