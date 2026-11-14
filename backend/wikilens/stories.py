"""Find paragraphs whose history is worth reading by hand before they lead a demo.

    python -m wikilens.stories --pages 1256,1150          # candidates per article
    python -m wikilens.stories --life 1256:531            # one paragraph's whole life

The matcher decides which blocks of two revisions are "the same paragraph". That is a
judgment, so the stories shown first are read by a person. This tool only proposes them.
"""
from __future__ import annotations

import argparse
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from pymysql.connections import Connection

from wikilens.config import load_settings
from wikilens.db import connect
from wikilens.queries import get_article, paragraph_history
from wikilens.timeline import build_timeline

REVISION_URL = "https://fi.wikipedia.org/?oldid="
PREVIEW_CHARS = 150
POOL_PER_CANDIDATE = 4   # paragraphs looked at for each candidate returned

# Paragraphs of an article by how many distinct wordings they have had.
MOST_REWORDED_SQL = """SELECT p.para_id, COUNT(DISTINCT p.hash) AS wordings
FROM paragraph FOR SYSTEM_TIME ALL AS p
JOIN wording AS w ON w.hash = p.hash
WHERE p.page_id = %s AND w.kind = 'p'
GROUP BY p.para_id
ORDER BY wordings DESC, p.para_id
LIMIT %s"""


@dataclass(frozen=True)
class Candidate:
    para_id: int
    wordings: int
    reverted: int
    gaps: int
    first: datetime
    last: datetime      # start of its latest wording
    latest_text: str

    @property
    def score(self) -> int:
        return self.wordings + 3 * self.reverted + 3 * self.gaps


def find_candidates(con: Connection, page_id: int, corpus_end: datetime, top: int = 10,
                    min_chars: int = 200) -> list[Candidate]:
    """Paragraphs with the most eventful histories, best first."""
    with con.cursor() as cur:
        cur.execute(MOST_REWORDED_SQL, (page_id, top * POOL_PER_CANDIDATE))
        pool = [para_id for para_id, _ in cur.fetchall()]
    candidates: list[Candidate] = []
    for para_id in pool:
        segments = build_timeline(paragraph_history(con, page_id, para_id), corpus_end)
        wordings = [segment for segment in segments if segment.kind == "wording"]
        if not wordings or len(wordings[-1].text or "") < min_chars:
            continue
        candidates.append(Candidate(
            para_id=para_id,
            wordings=len({segment.hash for segment in wordings}),
            reverted=sum(segment.reverted for segment in wordings),
            gaps=sum(segment.kind == "gap" for segment in segments),
            first=wordings[0].start,
            last=wordings[-1].start,
            latest_text=wordings[-1].text or "",
        ))
    return sorted(candidates, key=lambda c: (-c.score, c.para_id))[:top]


def render_candidates(title: str, page_id: int, candidates: Sequence[Candidate]) -> str:
    lines = [f"## {title} (page {page_id})", "",
             "| paragraph | wordings | reverted | gaps | first | latest wording from | latest text |",
             "|---|---|---|---|---|---|---|"]
    for c in candidates:
        preview = c.latest_text[:PREVIEW_CHARS].replace("|", "/")
        lines.append(f"| {c.para_id} | {c.wordings} | {c.reverted} | {c.gaps} | {c.first:%Y-%m-%d} | "
                     f"{c.last:%Y-%m-%d} | {preview} |")
    return "\n".join(lines) + "\n"


def render_life(con: Connection, page_id: int, para_id: int, corpus_end: datetime) -> str:
    """Every segment of one paragraph's life: dates, label, text, and the revision on Wikipedia."""
    segments = build_timeline(paragraph_history(con, page_id, para_id), corpus_end)
    lines = [f"### Paragraph {para_id} of page {page_id}: {len(segments)} segments"]
    for segment in segments:
        link = f" {REVISION_URL}{segment.rev_id}" if segment.rev_id is not None else ""
        lines.append(f"- {segment.start:%Y-%m-%d %H:%M} to {segment.end:%Y-%m-%d %H:%M} [{segment.label}]"
                     f"{' (loose link)' if segment.loose else ''}{link}")
        if segment.text is not None:
            lines.append(f"    {segment.text}")
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - CLI
    parser = argparse.ArgumentParser(description="Propose paragraphs whose histories are worth reading by hand.")
    parser.add_argument("--pages", help="comma-separated page ids: list candidates")
    parser.add_argument("--life", help="PAGE:PARAGRAPH: print one paragraph's whole life")
    parser.add_argument("--top", type=int, default=10)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    log = logging.getLogger(__name__)
    settings = load_settings()
    con = connect(settings)
    try:
        if args.life:
            page_id, para_id = (int(part) for part in args.life.split(":"))
            log.info(render_life(con, page_id, para_id, settings.corpus_end))
        for page_id in [int(p) for p in (args.pages or "").split(",") if p]:
            article = get_article(con, page_id)
            if article is None:
                log.info("page %s is not loaded", page_id)
                continue
            log.info(render_candidates(article.title, page_id,
                                       find_candidates(con, page_id, settings.corpus_end, args.top)))
    finally:
        con.close()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
