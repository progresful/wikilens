"""The HTTP API, against the fixture article in the test database."""
from dataclasses import replace
from datetime import UTC, datetime

import pymysql
import pytest
from conftest import TEST_DATABASE
from fastapi.testclient import TestClient

from wikilens.api import create_app
from wikilens.cleaner import clean
from wikilens.config import load_settings
from wikilens.db import connect
from wikilens.embedder import EmbedderUnavailable, StubEmbedder
from wikilens.fixture import fixture_revisions, load_fixture

SETTINGS = replace(load_settings(), db_name=TEST_DATABASE)
# The stub embedder scores by shared words, so the test question shares many with the tracked
# paragraph ("When did the Soviet Union attack Finland, when the Winter War began in 1939?").
QUESTION = "Milloin Neuvostoliitto hyökkäsi Suomeen, kun talvisota alkoi 1939?"
LIFE = ["first appears", "text changed", "replaced, reverted after 7 min", "restored unchanged",
        "removed", "restored unchanged", "text changed"]


def ms(*parts):
    return int(datetime(*parts, tzinfo=UTC).timestamp() * 1000)


def ok(response):
    body = response.json()
    assert response.status_code == 200, body
    assert body["success"] is True and body["error"] is None
    return body["data"]


def bad(response, status):
    body = response.json()
    assert response.status_code == status, body
    assert body["success"] is False and body["data"] is None and body["error"]
    return body["error"]


class SpyEmbedder:
    def __init__(self):
        self.calls = 0

    def embed(self, texts):
        self.calls += 1
        return StubEmbedder().embed(texts)


class DeadEmbedder:
    def embed(self, texts):
        raise EmbedderUnavailable("down")


def open_test_connection():
    return connect(SETTINGS)


def dead_connection():
    raise pymysql.err.OperationalError(2003, "Can't connect to MySQL server on '127.0.0.1' (secret detail)")


@pytest.fixture
def spy_embedder():
    return SpyEmbedder()


@pytest.fixture
def client(con, spy_embedder):
    load_fixture(con)
    with TestClient(create_app(SETTINGS, spy_embedder, connect=open_test_connection)) as test_client:
        yield test_client


@pytest.fixture
def client_with_dead_embedder(con):
    load_fixture(con)
    with TestClient(create_app(SETTINGS, DeadEmbedder(), connect=open_test_connection)) as test_client:
        yield test_client


@pytest.fixture
def client_with_dead_db():
    app = create_app(SETTINGS, StubEmbedder(), connect=dead_connection)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def test_articles_envelope(client):
    response = client.get("/api/articles")
    assert set(response.json()) == {"success", "data", "error", "meta"}
    (article,) = ok(response)
    assert (article["pageId"], article["title"], article["revisions"], article["tier"]) == (1, "Testisota", 10, 1)
    assert article["firstTs"] == ms(2010, 3, 1) and article["lastTs"] == ms(2017, 1, 1)
    assert article["reviewed"] is False and article["questions"] == []


def test_frame_is_a_live_as_of_query(client):
    data = ok(client.get(f"/api/articles/1/at?t={ms(2011, 6, 1)}"))
    assert len(data["blocks"]) == 3
    assert "FOR SYSTEM_TIME AS OF TIMESTAMP '2011-06-01 00:00:00" in data["sql"]
    assert data["dbMs"] >= 0 and data["t"] == ms(2011, 6, 1)
    assert set(data["blocks"][0]) == {"paraId", "hash", "revId"}


def test_frame_matches_the_cleaner(client):
    revision_102 = fixture_revisions()[1]
    data = ok(client.get(f"/api/articles/1/at?t={ms(2011, 6, 1)}"))
    assert [b["hash"] for b in data["blocks"]] == [b.hash.hex() for b in clean(revision_102.text)]


def test_frame_before_the_first_revision_is_empty(client):
    assert ok(client.get(f"/api/articles/1/at?t={ms(2009, 1, 1)}"))["blocks"] == []


def test_frame_after_corpus_end_400(client):
    bad(client.get(f"/api/articles/1/at?t={ms(2027, 1, 1)}"), 400)


def test_frame_non_numeric_time_400(client):
    bad(client.get("/api/articles/1/at?t=yesterday"), 400)


def test_frame_without_time_400(client):
    bad(client.get("/api/articles/1/at"), 400)


def test_unknown_article_404(client):
    bad(client.get("/api/articles/999/overview"), 404)
    bad(client.get(f"/api/articles/999/at?t={ms(2011, 6, 1)}"), 404)
    bad(client.post("/api/articles/999/ask", json={"question": "sota"}), 404)


def test_unknown_route_uses_the_envelope(client):
    bad(client.get("/api/nothing-here"), 404)


def test_overview(client):
    data = ok(client.get("/api/articles/1/overview"))
    assert (data["pageId"], data["title"]) == (1, "Testisota")
    assert data["bars"][0] == {"month": "2010-03", "edits": 1}
    assert data["hasVectors"] is True
    assert max(data["churn"].values()) == 4
    assert data["firstTs"] == ms(2010, 3, 1) and data["corpusEnd"] == ms(2026, 10, 1, 23, 59, 59)


def test_ask_returns_the_tracked_paragraph_and_its_life(client):
    data = ok(client.post("/api/articles/1/ask", json={"question": QUESTION}))
    assert data["mode"] == "vector"
    assert data["matches"][0]["weak"] is False
    assert "ilman sodanjulistusta" in data["matches"][0]["preview"]
    assert [segment["label"] for segment in data["timeline"]] == LIFE
    assert data["timeline"][0]["start"] == ms(2010, 3, 1)
    assert data["timeline"][-1]["end"] == ms(2026, 10, 1, 23, 59, 59)
    assert data["timeline"][4] == {"kind": "gap", "start": ms(2013, 1, 1), "end": ms(2014, 1, 1), "hash": None,
                                   "text": None, "revId": None, "label": "removed", "tone": -1, "loose": False,
                                   "reverted": False}
    assert data["embedMs"] >= 0 and data["rankMs"] >= 0 and "VEC_DISTANCE_COSINE" in data["sql"]


def test_other_matches_are_ordered_by_distance_then_paragraph(client):
    data = ok(client.post("/api/articles/1/ask", json={"question": QUESTION}))
    assert [m["paraId"] for m in data["matches"]] == [2, 3, 4]
    assert "Toinen kappale" in data["matches"][1]["preview"]


def test_ask_finds_a_wording_that_no_longer_exists(client):
    data = ok(client.post("/api/articles/1/ask", json={"question": "lol"}))
    assert data["matches"][0]["paraId"] == 2
    assert "lol" in data["timeline"][2]["text"] and data["timeline"][2]["reverted"] is True


def test_weak_match_is_flagged(client):
    assert ok(client.post("/api/articles/1/ask", json={"question": "xyzzy"}))["matches"][0]["weak"] is True


def test_blank_question_400(client, spy_embedder):
    for question in ["", "   ", "?!."]:
        bad(client.post("/api/articles/1/ask", json={"question": question}), 400)
    assert spy_embedder.calls == 0


def test_question_over_300_chars_400(client, spy_embedder):
    bad(client.post("/api/articles/1/ask", json={"question": "a" * 301}), 400)
    bad(client.post("/api/articles/1/ask", json={}), 400)
    assert spy_embedder.calls == 0


def test_embedder_down_503_and_frames_still_work(client_with_dead_embedder):
    assert bad(client_with_dead_embedder.post("/api/articles/1/ask", json={"question": "sota"}), 503) == (
        "embedding service unavailable")
    ok(client_with_dead_embedder.get(f"/api/articles/1/at?t={ms(2011, 6, 1)}"))


def test_without_vectors_ask_uses_keyword_mode(client, con):
    con.cursor().execute("DELETE FROM wording_vector")
    con.commit()
    data = ok(client.post("/api/articles/1/ask", json={"question": "marraskuuta"}))
    assert data["mode"] == "keyword"
    assert data["matches"][0] == {"paraId": 2, "distance": None, "weak": False,
                                  "preview": data["matches"][0]["preview"]}
    assert [segment["label"] for segment in data["timeline"]] == LIFE


def test_paragraph_timeline_and_404(client):
    assert [s["label"] for s in ok(client.get("/api/articles/1/paragraphs/2/timeline"))] == LIFE
    bad(client.get("/api/articles/1/paragraphs/99/timeline"), 404)


def test_wordings(client):
    frame = ok(client.get(f"/api/articles/1/at?t={ms(2011, 6, 1)}"))
    hashes = [b["hash"] for b in frame["blocks"]]
    data = ok(client.get("/api/wordings?hashes=" + ",".join(hashes)))
    assert [data[h] for h in hashes] == [
        {"kind": "h", "text": "Tausta"},
        {"kind": "p", "text": "Talvisota alkoi 30. marraskuuta 1939, kun Neuvostoliitto hyökkäsi Suomeen."},
        {"kind": "p", "text": "Toinen kappale pysyy."},
    ]
    assert ok(client.get("/api/wordings?hashes=")) == {}


def test_wordings_validation(client):
    bad(client.get("/api/wordings?hashes=zz"), 400)
    bad(client.get("/api/wordings?hashes=" + ",".join(["0" * 32] * 201)), 400)


def test_markup_in_wording_is_returned_verbatim(client, con):
    marked = "<script>alert(1)</script>"
    con.cursor().execute("INSERT INTO wording (hash, kind, text) VALUES (%s, 'p', %s)", (b"\x09" * 16, marked))
    con.commit()
    response = client.get("/api/wordings?hashes=" + (b"\x09" * 16).hex())
    assert ok(response)[(b"\x09" * 16).hex()]["text"] == marked
    assert response.headers["content-type"].startswith("application/json")


def test_database_down_503(client_with_dead_db):
    assert bad(client_with_dead_db.get("/api/articles"), 503) == "database unavailable"


def test_error_does_not_leak_exception_text(client_with_dead_db):
    text = client_with_dead_db.get("/api/articles").text
    assert "pymysql" not in text and "Traceback" not in text and "secret detail" not in text


def test_coverage_counts(client):
    data = ok(client.get("/api/coverage"))
    assert (data["articles"], data["revisions"], data["wordings"], data["vectors"]) == (1, 10, 9, 8)
    assert data["paragraphVersions"] > 0 and data["databaseBytes"] > 0
    assert data["mariadbVersion"].startswith("12.") and data["corpusEnd"] == ms(2026, 10, 1, 23, 59, 59)


def test_health(client, client_with_dead_embedder):
    assert ok(client.get("/api/health")) == {"database": True, "embedder": True}
    assert ok(client_with_dead_embedder.get("/api/health")) == {"database": True, "embedder": False}


def test_reviewed_articles_come_first_with_their_questions(con, tmp_path):
    load_fixture(con)
    stories = tmp_path / "stories.json"
    stories.write_text('[{"page_id": 1, "questions": [{"fi": "Milloin sota alkoi?", "en": "When did the war start?"}]}]')
    app = create_app(SETTINGS, StubEmbedder(), connect=open_test_connection, stories_path=stories)
    with TestClient(app) as test_client:
        (article,) = ok(test_client.get("/api/articles"))
    assert article["reviewed"] is True
    assert article["questions"] == [{"fi": "Milloin sota alkoi?", "en": "When did the war start?"}]


def test_reviewed_articles_keep_the_order_of_the_stories_file(con, tmp_path):
    from wikilens.ingest import ingest_page

    load_fixture(con)
    second = [replace(rev, page_id=2, title="Aakkonen", rev_id=rev.rev_id + 1000, parent_id=None)
              for rev in fixture_revisions()]
    ingest_page(con, second, tier=1)
    third = [replace(rev, page_id=3, title="Bertta", rev_id=rev.rev_id + 2000, parent_id=None)
             for rev in fixture_revisions()]
    ingest_page(con, third, tier=1)
    stories = tmp_path / "stories.json"
    stories.write_text('[{"page_id": 1, "questions": []}, {"page_id": 2, "questions": []}]')
    app = create_app(SETTINGS, StubEmbedder(), connect=open_test_connection, stories_path=stories)
    with TestClient(app) as test_client:
        listed = ok(test_client.get("/api/articles"))
    # the lead story first, as the file has it, although "Aakkonen" sorts before "Testisota"; then the rest by title
    assert [(a["pageId"], a["reviewed"]) for a in listed] == [(1, True), (2, True), (3, False)]


def test_all_wordings_of_an_article_in_one_answer(client):
    data = ok(client.get("/api/articles/1/wordings"))
    assert len(data) == 9                                   # every wording the article ever had, deleted ones too
    texts = {entry["text"] for entry in data.values()}
    assert "Talvisota alkoi 30. marraskuuta 1939, kun Neuvostoliitto hyökkäsi Suomeen lol." in texts
    assert {entry["kind"] for entry in data.values()} == {"h", "p"}
    assert all(len(block_hash) == 32 for block_hash in data)
    bad(client.get("/api/articles/999/wordings"), 404)
