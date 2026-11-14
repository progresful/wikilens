import json

import httpx
import pytest

from wikilens.embed import embed_missing
from wikilens.embedder import DIMENSIONS, EmbedderUnavailable, OllamaEmbedder, StubEmbedder
from wikilens.fixture import load_fixture


def cos(a, b):
    return sum(x * y for x, y in zip(a, b, strict=True))


def rows(con, sql):
    cur = con.cursor()
    cur.execute(sql)
    return cur.fetchall()


def clear_vectors(con):
    con.cursor().execute("DELETE FROM wording_vector")
    con.commit()


def test_fixture_embeds_paragraphs_but_not_the_heading(con):
    load_fixture(con)
    by_kind = rows(con, "SELECT w.kind, COUNT(*) FROM wording_vector v JOIN wording w USING (hash) GROUP BY w.kind")
    assert by_kind == (("p", 8),)


def test_short_wordings_are_skipped(con):
    load_fixture(con)
    clear_vectors(con)
    assert embed_missing(con, StubEmbedder(), [1], min_chars=25) == 5   # the four long first-paragraph wordings and one more


def test_rerun_embeds_nothing_new(con):
    load_fixture(con)
    assert embed_missing(con, StubEmbedder(), [1], min_chars=20) == 0


def test_small_batches_cover_everything(con):
    load_fixture(con)
    clear_vectors(con)
    assert embed_missing(con, StubEmbedder(), [1], batch_size=3, min_chars=20) == 8


def test_wrong_dimension_is_rejected_before_any_insert(con):
    class Bad:
        def embed(self, texts):
            return [[0.0, 1.0, 0.0] for _ in texts]

    load_fixture(con)
    clear_vectors(con)
    with pytest.raises(ValueError, match="1024"):
        embed_missing(con, Bad(), [1], min_chars=20)
    assert rows(con, "SELECT COUNT(*) FROM wording_vector") == ((0,),)


def test_stub_is_deterministic_and_overlap_ranks_closer():
    e = StubEmbedder()
    q, a, b = e.embed(["sota alkoi 1939", "Talvisota alkoi 1939", "Toinen kappale"])
    assert e.embed(["x y"]) == e.embed(["x y"])
    assert len(q) == DIMENSIONS == 1024
    assert cos(q, a) > cos(q, b)
    assert cos(q, q) == pytest.approx(1.0)
    assert cos(e.embed(["?!"])[0], e.embed([""])[0]) == pytest.approx(1.0)   # no words: one fixed unit vector


def test_ollama_request_and_response_shape():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"embeddings": [[0.5] * 4, [0.25] * 4]})

    embedder = OllamaEmbedder("http://ollama.test", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert embedder.embed(["a", "b"]) == [[0.5] * 4, [0.25] * 4]
    assert seen["url"] == "http://ollama.test/api/embed"
    assert seen["body"] == {"model": "bge-m3", "input": ["a", "b"], "truncate": True,
                            "options": {"num_ctx": 8192, "num_batch": 8192}}


def test_ollama_error_status_raises():
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(500, text="boom")))
    with pytest.raises(EmbedderUnavailable):
        OllamaEmbedder("http://ollama.test", client=client).embed(["a"])


def test_ollama_unreachable_raises():
    with pytest.raises(EmbedderUnavailable):
        OllamaEmbedder("http://127.0.0.1:9", timeout=1).embed(["a"])


def test_ollama_with_no_texts_makes_no_request():
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(500)))
    assert OllamaEmbedder("http://ollama.test", client=client).embed([]) == []
