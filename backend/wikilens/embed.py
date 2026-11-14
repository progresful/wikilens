"""Embed the wordings that have no vector yet.

    python -m wikilens.embed --pages 1256
    python -m wikilens.embed --tier1

Each distinct wording is embedded once, however many revisions carried it. Headings and very
short wordings are skipped. Progress is committed batch by batch, so a stopped run resumes.
"""
from __future__ import annotations

import argparse
import logging
import time
from collections.abc import Sequence

from pymysql.connections import Connection

from wikilens.config import load_settings
from wikilens.db import connect
from wikilens.embedder import DIMENSIONS, Embedder, OllamaEmbedder
from wikilens.parquet_source import tier1_page_ids
from wikilens.queries import vector_literal

log = logging.getLogger(__name__)

MIN_EMBED_CHARS = 40

# Paragraph and list-item wordings an article ever had that have no vector yet.
MISSING_SQL = """SELECT DISTINCT w.hash, w.text
FROM paragraph FOR SYSTEM_TIME ALL AS p
JOIN wording AS w ON w.hash = p.hash
LEFT JOIN wording_vector AS v ON v.hash = w.hash
WHERE p.page_id = %s AND w.kind IN ('p', 'li') AND CHAR_LENGTH(w.text) >= %s AND v.hash IS NULL
ORDER BY w.hash"""

INSERT_VECTOR = "INSERT IGNORE INTO wording_vector (hash, embedding) VALUES (%s, VEC_FromText(%s))"


def embed_missing(con: Connection, embedder: Embedder, page_ids: Sequence[int], batch_size: int = 32,
                  min_chars: int = MIN_EMBED_CHARS) -> int:
    """Embed the missing wordings of these articles, in the order given. Returns vectors written."""
    written = 0
    for page_id in page_ids:
        with con.cursor() as cur:
            cur.execute(MISSING_SQL, (page_id, min_chars))
            missing = [(bytes(block_hash), text) for block_hash, text in cur.fetchall()]
        for start in range(0, len(missing), batch_size):
            batch = missing[start:start + batch_size]
            vectors = embedder.embed([text for _, text in batch])
            if len(vectors) != len(batch) or any(len(vector) != DIMENSIONS for vector in vectors):
                raise ValueError(f"the embedder must return one vector of {DIMENSIONS} numbers per text")
            with con.cursor() as cur:
                cur.executemany(INSERT_VECTOR, [(block_hash, vector_literal(vector))
                                                for (block_hash, _), vector in zip(batch, vectors, strict=True)])
            con.commit()
            written += len(batch)
    return written


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - CLI
    parser = argparse.ArgumentParser(description="Embed wordings with bge-m3 through Ollama.")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--pages", help="comma-separated page ids, embedded in this order")
    scope.add_argument("--tier1", action="store_true", help="the starter's 50 articles")
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    settings = load_settings()
    page_ids = [int(p) for p in args.pages.split(",")] if args.pages else tier1_page_ids()
    embedder = OllamaEmbedder(settings.ollama_url, settings.embed_model)
    con = connect(settings)
    try:
        total = 0
        started = time.perf_counter()
        for page_id in page_ids:
            page_started = time.perf_counter()
            written = embed_missing(con, embedder, [page_id], batch_size=args.batch_size)
            total += written
            log.info("article %s: %s vectors in %.0f s", page_id, written, time.perf_counter() - page_started)
        seconds = time.perf_counter() - started
        log.info("%s vectors in %.0f s, %.1f passages per second", total, seconds, total / seconds if seconds else 0)
    finally:
        con.close()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
