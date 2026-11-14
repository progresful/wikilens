"""Measure what the demo claims, on this machine, and write it into docs/measurements.md.

    python -m wikilens.measure

Frame queries are timed at random moments of random loaded articles. Asking is timed with the
example questions of stories.json, embedding and ranking separately. Everything reported is a
database or model time measured here; nothing is copied from elsewhere.
"""
from __future__ import annotations

import argparse
import logging
import platform
import random
import statistics
import subprocess
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from pymysql.connections import Connection

from wikilens.api import STORIES_PATH
from wikilens.config import REPO_ROOT, load_settings
from wikilens.db import connect
from wikilens.embedder import Embedder, OllamaEmbedder
from wikilens.queries import Coverage, coverage, frame_at, list_articles, rank_paragraphs
from wikilens.schemas import load_stories

MEASUREMENTS_PATH = REPO_ROOT / "docs" / "measurements.md"
START_MARK = "<!-- measured by wikilens.measure: start -->"
END_MARK = "<!-- measured by wikilens.measure: end -->"


@dataclass(frozen=True)
class Percentiles:
    p50: float
    p95: float
    samples: int


def percentiles(values: Sequence[float]) -> Percentiles:
    if not values:
        return Percentiles(0.0, 0.0, 0)
    if len(values) == 1:
        return Percentiles(values[0], values[0], 1)
    p95 = statistics.quantiles(values, n=20, method="inclusive")[18]
    return Percentiles(statistics.median(values), p95, len(values))


def sample_moments(con: Connection, samples: int, seed: int = 1) -> list[tuple[int, datetime]]:
    """(page_id, moment) pairs: a random loaded article, at a random moment of its history."""
    articles = list_articles(con)
    if not articles:
        return []
    rng = random.Random(seed)
    picks: list[tuple[int, datetime]] = []
    for _ in range(samples):
        article = rng.choice(articles)
        span = (article.last_ts - article.first_ts).total_seconds()
        picks.append((article.page_id, article.first_ts + timedelta(seconds=rng.uniform(0, span))))
    return picks


def measure_frames(con: Connection, samples: int = 200, seed: int = 1) -> Percentiles:
    """Database time of the frame query (FOR SYSTEM_TIME AS OF), in milliseconds, warm."""
    moments = sample_moments(con, samples, seed)
    if moments:
        frame_at(con, *moments[0])   # warm-up, not counted
    return percentiles([frame_at(con, page_id, moment).db_ms for page_id, moment in moments])


def measure_asks(con: Connection, embedder: Embedder,
                 questions: Sequence[tuple[int, str]]) -> tuple[Percentiles, Percentiles]:
    """(embedding, ranking) times in milliseconds for (page_id, question) pairs."""
    embed_ms: list[float] = []
    rank_ms: list[float] = []
    for page_id, question in questions:
        started = time.perf_counter()
        (vector,) = embedder.embed([question])
        embedded = time.perf_counter()
        rank_paragraphs(con, page_id, vector)
        embed_ms.append((embedded - started) * 1000)
        rank_ms.append((time.perf_counter() - embedded) * 1000)
    return percentiles(embed_ms), percentiles(rank_ms)


def _row(name: str, p: Percentiles) -> str:
    return f"| {name} | {p.p50:.2f} | {p.p95:.2f} | {p.samples} samples |"


def render_markdown(facts: Mapping[str, str], frames: Percentiles, embed: Percentiles, rank: Percentiles,
                    cov: Coverage) -> str:
    megabytes = cov.database_bytes / 1_048_576
    lines = [
        "## Coverage and speed, measured",
        "",
        "| | |",
        "|---|---|",
        *[f"| {name} | {value} |" for name, value in facts.items()],
        f"| MariaDB | {cov.mariadb_version} |",
        f"| Articles | {cov.articles:,} |",
        f"| Revisions | {cov.revisions:,} |",
        f"| Paragraph versions (rows of the versioned table, all history) | {cov.paragraph_versions:,} |",
        f"| Distinct wordings | {cov.wordings:,} |",
        f"| Vectors | {cov.vectors:,} |",
        f"| Database size | {megabytes:,.0f} MB |",
        "",
        "| Milliseconds | p50 | p95 | |",
        "|---|---|---|---|",
        _row("Frame query: the article at a random moment (`FOR SYSTEM_TIME AS OF`)", frames),
        _row("Question embedding (bge-m3 through Ollama)", embed),
        _row("Ranking every wording an article ever had (versioned rows joined to vectors)", rank),
        "",
        "Database and model time only, measured in the Python process, warm, one connection, no other load.",
        "Network, JSON and browser time are not included.",
    ]
    return "\n".join(lines) + "\n"


def _hardware() -> str:  # pragma: no cover - reads the machine
    try:
        chip = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True,
                              check=True).stdout.strip()
        memory = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True,
                                    check=True).stdout) // 1_073_741_824
        return f"{chip}, {memory} GB RAM"
    except (OSError, subprocess.CalledProcessError, ValueError):
        return f"{platform.machine()} {platform.system()}"


def write_section(path: Path, section: str) -> None:
    """Replace the measured section of the file, or add it at the end."""
    text = path.read_text() if path.is_file() else ""
    block = f"{START_MARK}\n{section}{END_MARK}\n"
    if START_MARK in text and END_MARK in text:
        before, rest = text.split(START_MARK, 1)
        text = before + block + rest.split(END_MARK, 1)[1].lstrip("\n")
    else:
        text = text.rstrip("\n") + "\n\n" + block
    path.write_text(text)


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - CLI
    parser = argparse.ArgumentParser(description="Measure frame and ask times and write docs/measurements.md.")
    parser.add_argument("--samples", type=int, default=200)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = load_settings()
    con = connect(settings)
    try:
        frames = measure_frames(con, args.samples)
        questions = [(page_id, text) for page_id, examples in load_stories(STORIES_PATH).items()
                     for example in examples for text in (example["fi"], example["en"])]
        embedder = OllamaEmbedder(settings.ollama_url, settings.embed_model)
        if questions:
            embedder.embed([questions[0][1]])   # warm-up, not counted
        embed, rank = measure_asks(con, embedder, questions * 5)
        facts = {"Machine": _hardware(), "Measured": f"{datetime.now():%d %B %Y %H:%M}",
                 "Python": platform.python_version()}
        section = render_markdown(facts, frames, embed, rank, coverage(con))
    finally:
        con.close()
    write_section(MEASUREMENTS_PATH, section)
    logging.getLogger(__name__).info(section)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
