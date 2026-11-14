"""The HTTP API.

    python -m wikilens.api                      # http://127.0.0.1:8000
    WIKILENS_EMBEDDER=stub python -m wikilens.api   # no Ollama: test vectors (for the browser tests)

Every response is {success, data, error, meta}. Errors say what is wrong in plain words and
never carry exception text.
"""
from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pymysql
import uvicorn
from fastapi import FastAPI, Query, Request
from fastapi import Path as PathParam
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pymysql.connections import Connection
from starlette.exceptions import HTTPException as StarletteHTTPException

from wikilens import db, queries
from wikilens.config import REPO_ROOT, Settings, load_settings
from wikilens.embedder import DIMENSIONS, Embedder, EmbedderUnavailable, OllamaEmbedder, StubEmbedder
from wikilens.pool import ConnectionPool
from wikilens.schemas import (
    PREVIEW_CHARS,
    AskRequest,
    InvalidInput,
    article_json,
    clean_question,
    coverage_json,
    envelope,
    error_envelope,
    frame_json,
    from_ms,
    load_stories,
    overview_json,
    parse_hashes,
    timeline_json,
    to_ms,
)
from wikilens.timeline import build_timeline

log = logging.getLogger(__name__)

# Cosine distance at or beyond which a match is labelled weak. With bge-m3 on the tier 1
# articles, questions the article answers scored 0.29-0.44 and unrelated ones 0.54-0.60
# (docs/stories.md).
WEAK_DISTANCE = 0.5
MATCHES = 3
STORIES_PATH = Path(__file__).with_name("stories.json")
WEB_DIST = REPO_ROOT / "web" / "dist"


Ranked = list[tuple[int, float | None]]   # (para_id, distance); distance is None in keyword mode


class NotFound(Exception):
    """The article or paragraph does not exist."""


def _install_error_handlers(app: FastAPI) -> None:
    def respond(status: int, message: str) -> JSONResponse:
        return JSONResponse(status_code=status, content=error_envelope(message))

    @app.exception_handler(InvalidInput)
    async def invalid_input(_: Request, error: InvalidInput) -> JSONResponse:
        return respond(400, str(error))

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, __: RequestValidationError) -> JSONResponse:
        return respond(400, "the request is not valid")

    @app.exception_handler(NotFound)
    async def not_found(_: Request, error: NotFound) -> JSONResponse:
        return respond(404, str(error))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, error: StarletteHTTPException) -> JSONResponse:
        return respond(error.status_code, "not found" if error.status_code == 404 else "request failed")

    @app.exception_handler(EmbedderUnavailable)
    async def embedder_down(_: Request, __: EmbedderUnavailable) -> JSONResponse:
        return respond(503, "embedding service unavailable")

    @app.exception_handler(pymysql.err.Error)
    async def database_down(_: Request, error: pymysql.err.Error) -> JSONResponse:
        log.error("database error: %s", error)
        return respond(503, "database unavailable")


def create_app(settings: Settings, embedder: Embedder, connect: Callable[[], Connection] | None = None,
               stories_path: Path | None = None) -> FastAPI:
    pool = ConnectionPool(connect if connect is not None else lambda: db.connect(settings))
    stories = load_stories(stories_path if stories_path is not None else STORIES_PATH)
    story_order = {page_id: index for index, page_id in enumerate(stories)}
    corpus_end_ms = to_ms(settings.corpus_end)
    known_articles: set[int] = set()
    app = FastAPI(title="WikiLens", docs_url=None, redoc_url=None, openapi_url=None)
    _install_error_handlers(app)

    def require_article(con: Connection, page_id: int) -> None:
        if page_id in known_articles:
            return
        if queries.get_article(con, page_id) is None:
            raise NotFound("no such article")
        known_articles.add(page_id)

    def matches_for(con: Connection, page_id: int, question: str) -> tuple[str, Ranked, float, float]:
        """(mode, [(para_id, distance)], embed ms, rank ms)."""
        found: Ranked
        if not queries.has_vectors(con, page_id):
            started = time.perf_counter()
            found = [(para_id, None) for para_id in queries.keyword_paragraphs(con, page_id, question, MATCHES)]
            return "keyword", found, 0.0, (time.perf_counter() - started) * 1000
        started = time.perf_counter()
        (vector,) = embedder.embed([question])
        if len(vector) != DIMENSIONS:
            raise EmbedderUnavailable("the embedder returned a vector of the wrong size")
        embedded = time.perf_counter()
        found = [(para_id, distance) for para_id, distance in queries.rank_paragraphs(con, page_id, vector, MATCHES)]
        done = time.perf_counter()
        return "vector", found, (embedded - started) * 1000, (done - embedded) * 1000

    @app.get("/api/articles")
    def articles() -> dict[str, Any]:
        with pool.connection() as con:
            listed = [article_json(article, stories) for article in queries.list_articles(con)]
        # Reviewed articles first, in the order stories.json lists them; then the rest by title.
        return envelope(sorted(listed, key=lambda a: (story_order.get(a["pageId"], len(story_order)), a["title"])))

    @app.get("/api/articles/{page_id}/overview")
    def overview(page_id: int = PathParam(ge=1)) -> dict[str, Any]:
        with pool.connection() as con:
            found = queries.article_overview(con, page_id)
        if found is None:
            raise NotFound("no such article")
        return envelope(overview_json(found, settings.corpus_end))

    @app.get("/api/articles/{page_id}/at")
    def frame(page_id: int = PathParam(ge=1), t: int = Query()) -> dict[str, Any]:
        if t > corpus_end_ms:
            raise InvalidInput("that moment is after the end of the corpus")
        with pool.connection() as con:
            require_article(con, page_id)
            result = queries.frame_at(con, page_id, from_ms(t))
        return envelope(frame_json(t, result))

    @app.get("/api/wordings")
    def wordings(hashes: str = Query(default="")) -> dict[str, Any]:
        wanted = parse_hashes(hashes)
        with pool.connection() as con:
            found = queries.wordings_by_hash(con, wanted)
        return envelope({block_hash.hex(): {"kind": kind, "text": text} for block_hash, (kind, text) in found.items()})

    @app.post("/api/articles/{page_id}/ask")
    def ask(body: AskRequest, page_id: int = PathParam(ge=1)) -> dict[str, Any]:
        question = clean_question(body.question)
        with pool.connection() as con:
            require_article(con, page_id)
            mode, found, embed_ms, rank_ms = matches_for(con, page_id, question)
            histories = [queries.paragraph_history(con, page_id, para_id) for para_id, _ in found]
        matches = [
            {"paraId": para_id, "distance": distance, "weak": distance is not None and distance >= WEAK_DISTANCE,
             "preview": history[-1].text[:PREVIEW_CHARS] if history else ""}
            for (para_id, distance), history in zip(found, histories, strict=True)
        ]
        timeline = build_timeline(histories[0], settings.corpus_end) if histories else []
        shown_sql = queries.rank_sql_for_display(page_id, MATCHES) if mode == "vector" else queries.KEYWORD_SQL
        return envelope({"mode": mode, "matches": matches, "timeline": timeline_json(timeline),
                         "embedMs": round(embed_ms, 3), "rankMs": round(rank_ms, 3), "sql": shown_sql})

    @app.get("/api/articles/{page_id}/paragraphs/{para_id}/timeline")
    def paragraph_timeline(page_id: int = PathParam(ge=1), para_id: int = PathParam(ge=1)) -> dict[str, Any]:
        with pool.connection() as con:
            history = queries.paragraph_history(con, page_id, para_id)
        if not history:
            raise NotFound("no such paragraph")
        return envelope(timeline_json(build_timeline(history, settings.corpus_end)))

    @app.get("/api/coverage")
    def coverage() -> dict[str, Any]:
        with pool.connection() as con:
            return envelope(coverage_json(queries.coverage(con), settings.corpus_end))

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        with pool.connection() as con, con.cursor() as cur:
            cur.execute("SELECT 1")
        try:
            embedder.embed(["ok"])
            embedder_up = True
        except EmbedderUnavailable:
            embedder_up = False
        return envelope({"database": True, "embedder": embedder_up})

    if WEB_DIST.is_dir():  # pragma: no cover - only when the browser app has been built
        app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
    return app


def main() -> int:  # pragma: no cover - CLI
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    settings = load_settings()
    embedder: Embedder = (
        StubEmbedder() if os.environ.get("WIKILENS_EMBEDDER") == "stub"
        else OllamaEmbedder(settings.ollama_url, settings.embed_model)
    )
    port = int(os.environ.get("WIKILENS_API_PORT", "8000"))   # the browser tests run a second API on 8001
    uvicorn.run(create_app(settings, embedder), host="127.0.0.1", port=port, log_level="warning")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
