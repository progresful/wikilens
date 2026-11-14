"""The API's wire format: input checks, and conversion of results to JSON-ready dictionaries.
Keys are camelCase, times are epoch milliseconds (UTC), hashes are 32 hex characters."""
from __future__ import annotations

import json
import re
from collections.abc import Sequence
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from wikilens.queries import ArticleRow, Coverage, FrameResult, Overview
from wikilens.timeline import Segment

EPOCH = datetime(1970, 1, 1)
MILLISECOND = timedelta(milliseconds=1)
MAX_QUESTION_CHARS = 300
MAX_HASHES = 200
PREVIEW_CHARS = 140
_HASH = re.compile(r"[0-9a-f]{32}")
_HAS_WORD = re.compile(r"\w")


class InvalidInput(ValueError):
    """The request is malformed. The message is safe to show."""


class AskRequest(BaseModel):
    question: str


def to_ms(moment: datetime) -> int:
    return (moment - EPOCH) // MILLISECOND


def to_ms_ceil(moment: datetime) -> int:
    """Rounded up, so that asking for a frame at a segment's start lands on or after the
    microsecond the segment really starts at."""
    return -((EPOCH - moment) // MILLISECOND)


def from_ms(milliseconds: int) -> datetime:
    return EPOCH + timedelta(milliseconds=milliseconds)


def clean_question(raw: str) -> str:
    question = raw.strip()
    if not question or not _HAS_WORD.search(question):
        raise InvalidInput("the question is empty")
    if len(question) > MAX_QUESTION_CHARS:
        raise InvalidInput(f"the question is longer than {MAX_QUESTION_CHARS} characters")
    return question


def parse_hashes(raw: str) -> list[bytes]:
    names = [name for name in raw.split(",") if name]
    if len(names) > MAX_HASHES:
        raise InvalidInput(f"at most {MAX_HASHES} hashes per request")
    if not all(_HASH.fullmatch(name) for name in names):
        raise InvalidInput("a hash is 32 hexadecimal characters")
    return [bytes.fromhex(name) for name in names]


def load_stories(path: Path) -> dict[int, list[dict[str, str]]]:
    """stories.json: the hand-reviewed articles and their example questions, by page id."""
    if not path.is_file():
        return {}
    stories: dict[int, list[dict[str, str]]] = {}
    for entry in json.loads(path.read_text()):
        questions = [{"fi": str(q["fi"]), "en": str(q["en"])} for q in entry.get("questions", [])]
        stories[int(entry["page_id"])] = questions
    return stories


def envelope(data: Any) -> dict[str, Any]:
    return {"success": True, "data": data, "error": None, "meta": None}


def error_envelope(message: str) -> dict[str, Any]:
    return {"success": False, "data": None, "error": message, "meta": None}


def article_json(article: ArticleRow, stories: dict[int, list[dict[str, str]]]) -> dict[str, Any]:
    return {
        "pageId": article.page_id, "title": article.title, "revisions": article.revisions,
        "firstTs": to_ms(article.first_ts), "lastTs": to_ms(article.last_ts), "tier": article.tier,
        "reviewed": article.page_id in stories, "questions": stories.get(article.page_id, []),
    }


def overview_json(overview: Overview, corpus_end: datetime) -> dict[str, Any]:
    article = overview.article
    return {
        "pageId": article.page_id, "title": article.title,
        "firstTs": to_ms(article.first_ts), "lastTs": to_ms(article.last_ts), "corpusEnd": to_ms(corpus_end),
        "bars": [{"month": month, "edits": edits} for month, edits in overview.bars],
        "churn": {str(para_id): wordings for para_id, wordings in overview.churn.items()},
        "hasVectors": overview.has_vectors,
    }


def frame_json(t_ms: int, frame: FrameResult) -> dict[str, Any]:
    return {
        "t": t_ms,
        "blocks": [{"paraId": b.para_id, "hash": b.hash.hex(), "revId": b.rev_id} for b in frame.blocks],
        "sql": frame.sql,
        "dbMs": round(frame.db_ms, 3),
    }


def segment_json(segment: Segment) -> dict[str, Any]:
    return {
        "kind": segment.kind, "start": to_ms_ceil(segment.start), "end": to_ms_ceil(segment.end),
        "hash": segment.hash.hex() if segment.hash is not None else None, "text": segment.text,
        "revId": segment.rev_id, "label": segment.label, "tone": segment.tone, "loose": segment.loose,
        "reverted": segment.reverted,
    }


def timeline_json(segments: Sequence[Segment]) -> list[dict[str, Any]]:
    return [segment_json(segment) for segment in segments]


def coverage_json(coverage: Coverage, corpus_end: datetime) -> dict[str, Any]:
    return {
        "articles": coverage.articles, "revisions": coverage.revisions,
        "paragraphVersions": coverage.paragraph_versions, "wordings": coverage.wordings,
        "vectors": coverage.vectors, "databaseBytes": coverage.database_bytes,
        "mariadbVersion": coverage.mariadb_version, "corpusEnd": to_ms(corpus_end),
    }
