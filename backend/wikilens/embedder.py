"""Turning text into vectors. The real embedder is bge-m3 run by Ollama on this machine,
the same model as the MariaDB starters and the vectors supplied with dataset S, so an English
question finds Finnish text. The stub is for tests: no model, no network."""
from __future__ import annotations

import math
import re
import zlib
from collections.abc import Sequence
from typing import Protocol

import httpx

DIMENSIONS = 1024
OLLAMA_CONTEXT = 8192   # tokens bge-m3 can read; Ollama needs both num_ctx and num_batch set


class EmbedderUnavailable(Exception):
    """The embedding service cannot be reached or refused the request."""


class Embedder(Protocol):
    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class OllamaEmbedder:
    def __init__(self, url: str, model: str = "bge-m3", timeout: float = 120.0,
                 client: httpx.Client | None = None) -> None:
        self._endpoint = url.rstrip("/") + "/api/embed"
        self._model = model
        self._client = client if client is not None else httpx.Client(timeout=timeout)

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        payload = {"model": self._model, "input": list(texts), "truncate": True,
                   "options": {"num_ctx": OLLAMA_CONTEXT, "num_batch": OLLAMA_CONTEXT}}
        try:
            response = self._client.post(self._endpoint, json=payload)
        except httpx.HTTPError as error:
            raise EmbedderUnavailable("the embedding service cannot be reached") from error
        if response.status_code != 200:
            raise EmbedderUnavailable(f"the embedding service answered {response.status_code}")
        vectors: list[list[float]] = response.json()["embeddings"]
        return vectors


class StubEmbedder:
    """Deterministic bag-of-words vectors: texts sharing words are closer. For tests only."""

    _WORD = re.compile(r"\w+")

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._one(text) for text in texts]

    def _one(self, text: str) -> list[float]:
        vector = [0.0] * DIMENSIONS
        for word in self._WORD.findall(text.lower()):
            vector[zlib.crc32(word.encode()) % DIMENSIONS] += 1.0
        norm = math.sqrt(sum(x * x for x in vector))
        if norm == 0.0:
            return [1.0] + [0.0] * (DIMENSIONS - 1)
        return [x / norm for x in vector]
