import pytest

from wikilens.embedder import StubEmbedder
from wikilens.fixture import load_fixture
from wikilens.measure import Percentiles, measure_asks, measure_frames, percentiles, render_markdown, sample_moments
from wikilens.queries import coverage


def test_percentiles():
    p = percentiles([float(n) for n in range(1, 101)])
    assert p.samples == 100
    assert p.p50 == pytest.approx(50.5)
    assert 94 <= p.p95 <= 96


def test_percentiles_of_one_value_and_of_none():
    assert percentiles([3.0]) == Percentiles(3.0, 3.0, 1)
    assert percentiles([]) == Percentiles(0.0, 0.0, 0)


def test_sample_moments_is_repeatable_and_inside_the_article(con):
    load_fixture(con)
    first = sample_moments(con, 5, seed=1)
    assert first == sample_moments(con, 5, seed=1)
    assert first != sample_moments(con, 5, seed=2)
    assert all(page_id == 1 and 2010 <= moment.year <= 2017 for page_id, moment in first)


def test_measure_frames_on_fixture(con):
    load_fixture(con)
    p = measure_frames(con, samples=20)
    assert p.samples == 20
    assert 0 <= p.p50 <= p.p95


def test_measure_asks_times_embedding_and_ranking_separately(con):
    load_fixture(con)
    embed, rank = measure_asks(con, StubEmbedder(), [(1, "sota alkoi"), (1, "toinen kappale")])
    assert embed.samples == rank.samples == 2
    assert embed.p50 >= 0 and rank.p50 >= 0


def test_render_markdown_states_counts_and_hardware(con):
    load_fixture(con)
    text = render_markdown({"Machine": "Apple M1 Pro, 32 GB"}, Percentiles(1.5, 3.25, 200), Percentiles(30.0, 40.0, 6),
                           Percentiles(10.0, 20.0, 6), coverage(con))
    assert "Apple M1 Pro, 32 GB" in text
    assert "| Articles | 1 |" in text and "| Vectors | 8 |" in text
    assert "p95" in text and "3.25" in text and "200 samples" in text


def test_write_section_adds_then_replaces(tmp_path):
    from wikilens.measure import END_MARK, START_MARK, write_section

    path = tmp_path / "measurements.md"
    path.write_text("# Title\n\nEarlier notes.\n")
    write_section(path, "first\n")
    assert path.read_text() == f"# Title\n\nEarlier notes.\n\n{START_MARK}\nfirst\n{END_MARK}\n"
    write_section(path, "second\n")
    text = path.read_text()
    assert "first" not in text and "second" in text and text.count(START_MARK) == 1 and "Earlier notes." in text
