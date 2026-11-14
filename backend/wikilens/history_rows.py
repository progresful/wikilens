"""From a sequence of page states to the rows of the system-versioned paragraph table.
Pure functions; ingest feeds them one revision at a time."""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from types import MappingProxyType

from wikilens.matcher import PageState

ONE_MICROSECOND = timedelta(microseconds=1)


@dataclass(frozen=True)
class ParagraphRow:
    page_id: int
    para_id: int
    pos: float
    hash: bytes
    rev_id: int               # revision that produced this state
    match_rule: int
    similarity: float | None
    row_start: datetime
    row_end: datetime | None  # None while the row is current


OpenRows = Mapping[int, ParagraphRow]   # para_id -> the row that is still open


def assign_valid_from(revs: Sequence[tuple[int, datetime]]) -> list[tuple[int, datetime]]:
    """(rev_id, timestamp) in any order -> sorted by (timestamp, rev_id) with strictly
    increasing valid-from times. Revisions sharing a second are placed 1 microsecond apart,
    so each has its own moment; the original timestamp stays the one shown to readers."""
    ordered = sorted(revs, key=lambda rev: (rev[1], rev[0]))
    result: list[tuple[int, datetime]] = []
    for rev_id, ts in ordered:
        if result and ts <= result[-1][1]:
            ts = result[-1][1] + ONE_MICROSECOND
        result.append((rev_id, ts))
    return result


def advance(
    page_id: int, open_rows: OpenRows, state: PageState, valid_from: datetime
) -> tuple[OpenRows, list[ParagraphRow]]:
    """Apply one revision. Returns the rows still open afterwards and the rows it closed.
    A paragraph's row stays open while its wording and position are unchanged."""
    present = {para.para_id: para for para in state.paras}
    still_open: dict[int, ParagraphRow] = {}
    closed: list[ParagraphRow] = []
    for para_id, row in open_rows.items():
        para = present.get(para_id)
        if para is not None and para.block.hash == row.hash and para.pos == row.pos:
            still_open[para_id] = row
        else:
            closed.append(replace(row, row_end=valid_from))
    for para in state.paras:
        if para.para_id not in still_open:
            still_open[para.para_id] = ParagraphRow(
                page_id=page_id,
                para_id=para.para_id,
                pos=para.pos,
                hash=para.block.hash,
                rev_id=state.rev_id,
                match_rule=int(para.rule),
                similarity=para.similarity,
                row_start=valid_from,
                row_end=None,
            )
    return MappingProxyType(still_open), closed
