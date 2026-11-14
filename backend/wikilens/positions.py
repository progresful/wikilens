"""Reading-order positions that let a block be inserted without renumbering its neighbours."""
from __future__ import annotations

from collections.abc import Sequence

MIN_GAP = 1e-6


def _fill(count: int, before: float | None, after: float | None) -> list[float]:
    """Positions for `count` blocks lying between two kept positions (either may be absent)."""
    if before is None and after is None:
        return [float(j + 1) for j in range(count)]
    if before is None:
        assert after is not None
        return [after - (count - j) for j in range(count)]
    if after is None:
        return [before + (j + 1) for j in range(count)]
    return [before + (after - before) * (j + 1) / (count + 1) for j in range(count)]


def assign_positions(existing: Sequence[float | None]) -> tuple[list[float], bool]:
    """existing[i] is the kept position of block i in the new reading order, or None for a
    block that needs one. Returns a position for every block, and whether the gaps ran out so
    that everything was renumbered 1.0, 2.0, ..."""
    positions: list[float] = []
    i = 0
    while i < len(existing):
        kept = existing[i]
        if kept is not None:
            positions.append(kept)
            i += 1
            continue
        end = i
        while end < len(existing) and existing[end] is None:
            end += 1
        before = positions[-1] if positions else None
        after = existing[end] if end < len(existing) else None
        positions.extend(_fill(end - i, before, after))
        i = end
    if any(b - a < MIN_GAP for a, b in zip(positions, positions[1:])):
        return [float(j + 1) for j in range(len(existing))], True
    return positions, False
