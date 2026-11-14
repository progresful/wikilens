"""The life of one paragraph, as segments for the timeline: each wording it had, each period
it was absent, and a label for each. Labels describe what the history rows show and nothing
more; none of them says why an edit was made."""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Literal

LOOSE_BELOW = 0.65                      # an edit link weaker than this is drawn as loose
SHORTEST = timedelta(milliseconds=1)    # the API speaks milliseconds; anything shorter cannot be shown
DAYS_PER_MONTH = 30.44


@dataclass(frozen=True)
class HistoryRow:
    """One row of a paragraph's history, with its wording's text."""
    hash: bytes
    rev_id: int
    start: datetime
    end: datetime | None   # None while the row is current
    text: str
    rule: int
    similarity: float | None


@dataclass(frozen=True)
class Segment:
    kind: Literal["wording", "gap"]
    start: datetime
    end: datetime
    hash: bytes | None
    text: str | None
    rev_id: int | None
    label: str
    tone: int        # order in which this wording first appeared, from 0; -1 for a gap
    loose: bool      # the link to the previous wording is a weak match
    reverted: bool   # this wording sat between two identical ones


@dataclass(frozen=True)
class _Span:
    hash: bytes
    rev_id: int
    start: datetime
    end: datetime
    text: str
    similarity: float | None


def format_duration(delta: timedelta) -> str:
    seconds = delta.total_seconds()
    if seconds < 60:
        return "under a minute"
    if seconds < 3600:
        return f"{int(seconds // 60)} min"
    if seconds < 48 * 3600:
        return f"{int(seconds // 3600)} h"
    days = seconds / 86400
    if days < 60:
        return f"{round(days)} days"
    years, months = divmod(round(days / DAYS_PER_MONTH), 12)
    return " ".join(part for part in (f"{years}y" if years else "", f"{months}m" if months else "") if part)


def _merged(rows: Sequence[HistoryRow], corpus_end: datetime) -> list[_Span]:
    """Rows in time order, with touching rows of one wording joined (a row also changes when
    only the paragraph's position does)."""
    spans: list[_Span] = []
    for row in sorted(rows, key=lambda r: r.start):
        end = row.end if row.end is not None else corpus_end
        if spans and spans[-1].hash == row.hash and spans[-1].end == row.start:
            spans[-1] = replace(spans[-1], end=end)
        else:
            spans.append(_Span(row.hash, row.rev_id, row.start, end, row.text, row.similarity))
    return spans


def _without_instants(spans: Sequence[_Span]) -> list[_Span]:
    """Drop wordings shorter than a millisecond (two revisions saved in the same second are
    stored a microsecond apart), joining their neighbours so no hole is left."""
    kept: list[_Span] = []
    pending_start: datetime | None = None
    for span in spans:
        if span.end - span.start < SHORTEST:
            if kept and kept[-1].end == span.start:
                kept[-1] = replace(kept[-1], end=span.end)
            elif pending_start is None:
                pending_start = span.start
            continue
        if pending_start is not None:
            span = replace(span, start=pending_start)
            pending_start = None
        if kept and kept[-1].hash == span.hash and kept[-1].end == span.start:
            kept[-1] = replace(kept[-1], end=span.end)
        else:
            kept.append(span)
    return kept


def _gap(start: datetime, end: datetime) -> Segment:
    return Segment("gap", start, end, None, None, None, "removed", -1, False, False)


def _label(first: bool, reverted: bool, seen_before: bool, after_gap: bool, loose: bool, lasted: timedelta) -> str:
    if first:
        return "first appears"
    if reverted:
        return f"replaced, reverted after {format_duration(lasted)}"
    if seen_before:
        return "restored unchanged"
    if after_gap:
        return "restored, reworded"
    return "heavily rewritten" if loose else "text changed"


def build_timeline(rows: Sequence[HistoryRow], corpus_end: datetime) -> list[Segment]:
    spans = _without_instants(_merged(rows, corpus_end))
    segments: list[Segment] = []
    tones: dict[bytes, int] = {}
    for i, span in enumerate(spans):
        prev = spans[i - 1] if i > 0 else None
        following = spans[i + 1] if i + 1 < len(spans) else None
        after_gap = prev is not None and prev.end < span.start
        if prev is not None and after_gap:
            segments.append(_gap(prev.end, span.start))
        seen_before = span.hash in tones
        tone = tones.setdefault(span.hash, len(tones))
        loose = span.similarity is not None and span.similarity < LOOSE_BELOW
        reverted = (
            prev is not None and following is not None and not after_gap
            and span.end == following.start and prev.hash == following.hash
        )
        label = _label(prev is None, reverted, seen_before, after_gap, loose, span.end - span.start)
        segments.append(Segment("wording", span.start, span.end, span.hash, span.text, span.rev_id,
                                label, tone, loose, reverted))
    if spans and spans[-1].end < corpus_end:
        segments.append(_gap(spans[-1].end, corpus_end))
    return segments
