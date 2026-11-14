"""Paragraph identity across revisions: which block of a new revision is "the same
paragraph" as a block of the one before. Pure functions; nothing here touches a database.

The rules, in order, for each new revision:
  1. Full revert   the revision's text hash was seen before: reuse that revision's map.
  2. Unchanged     blocks in runs that align by hash keep their identity and position.
  3. Moved         a leftover block whose hash matches a leftover old block.
  4. Edited        within a replaced stretch, the most similar old/new pairs of one kind.
  5. Restored      a leftover block matching a paragraph that was removed earlier.
  6. New           anything left.
"""
from __future__ import annotations

from collections import Counter, deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from difflib import SequenceMatcher
from enum import IntEnum
from types import MappingProxyType

from wikilens.blocks import Block
from wikilens.positions import assign_positions

EDIT_THRESHOLD = 0.5      # the starter's value for "still the same paragraph"
RESTORE_THRESHOLD = 0.6   # a reworded paragraph coming back must be closer than a plain edit
RESTORE_WINDOW = 20       # revisions within which a reworded paragraph may still come back
CHAR_PRODUCT_LIMIT = 1_000_000   # two texts of up to about 1,000 characters each: compare by character
WORD_PRODUCT_LIMIT = 250_000     # up to about 500 words each: compare by word; beyond that, by shared words


class Rule(IntEnum):
    """How a paragraph's state was linked to the revision before. Stored in paragraph.match_rule."""
    NEW = 1
    UNCHANGED = 2
    MOVED = 3
    EDITED = 4
    RESTORED = 5
    REVERT = 6


@dataclass(frozen=True)
class Para:
    para_id: int
    pos: float
    block: Block
    rule: Rule
    similarity: float | None


@dataclass(frozen=True)
class PageState:
    rev_id: int
    paras: tuple[Para, ...]
    text_missing: bool = False


@dataclass(frozen=True)
class Absent:
    para_id: int
    block: Block
    removed_at: int   # index of the revision that removed it


_NO_MAPS: Mapping[str, tuple[Para, ...]] = MappingProxyType({})


@dataclass(frozen=True)
class Memory:
    """What the matcher remembers about an article between revisions."""
    next_para_id: int = 1
    by_sha1: Mapping[str, tuple[Para, ...]] = _NO_MAPS   # text hash -> paragraph map of the first revision with it
    absent: tuple[Absent, ...] = ()                       # paragraphs removed and not back, oldest removal first


@dataclass(frozen=True)
class _Link:
    para_id: int
    rule: Rule
    similarity: float | None
    kept_pos: float | None   # only an unchanged block keeps its position


def similarity(a: str, b: str, at_least: float = 0.0) -> float:
    """Text similarity 0..1. Returns 0.0 early when it cannot reach `at_least`.

    Short texts are compared character by character, as the starter does. That comparison
    grows with the product of the two lengths, and a real article has a 35,000-character
    paragraph on which it does not finish. So longer texts are compared word by word, and
    very long ones by the words they share regardless of order."""
    if a == b:
        return 1.0
    if len(a) * len(b) <= CHAR_PRODUCT_LIMIT:
        matcher = SequenceMatcher(None, a, b, autojunk=False)
        if matcher.real_quick_ratio() < at_least or matcher.quick_ratio() < at_least:
            return 0.0
        return matcher.ratio()
    words_a, words_b = a.split(), b.split()
    if not words_a or not words_b:
        return 0.0
    shared = sum((Counter(words_a) & Counter(words_b)).values())
    shared_ratio = 2 * shared / (len(words_a) + len(words_b))
    if shared_ratio < at_least:      # no ordering of the words can score higher than this
        return 0.0
    if len(words_a) * len(words_b) <= WORD_PRODUCT_LIMIT:
        return SequenceMatcher(None, words_a, words_b, autojunk=False).ratio()
    return shared_ratio


def carry_forward(prev: PageState | None, rev_id: int) -> PageState:
    """The state for a revision whose text the dump did not carry: nothing changes."""
    return PageState(rev_id=rev_id, paras=prev.paras if prev is not None else (), text_missing=True)


def match_revision(
    prev: PageState | None,
    blocks: Sequence[Block],
    rev_id: int,
    sha1: str | None,
    memory: Memory,
    index: int,
) -> tuple[PageState, Memory]:
    """The state of the article after a revision, and what to remember for the next one."""
    old = prev.paras if prev is not None else ()
    reverted = _full_revert(blocks, sha1, memory)
    if reverted is not None:
        paras, next_id = reverted, memory.next_para_id
    else:
        links, next_id = _link_blocks(old, blocks, memory, index)
        positions, _ = assign_positions([link.kept_pos for link in links])
        paras = tuple(
            Para(link.para_id, pos, block, link.rule, link.similarity)
            for link, pos, block in zip(links, positions, blocks)
        )
    return PageState(rev_id=rev_id, paras=paras), _remember(memory, old, paras, sha1, index, next_id)


def _full_revert(blocks: Sequence[Block], sha1: str | None, memory: Memory) -> tuple[Para, ...] | None:
    if sha1 is None:
        return None
    stored = memory.by_sha1.get(sha1)
    if stored is None or [p.block.hash for p in stored] != [b.hash for b in blocks]:
        return None   # unseen, or the hash is not to be trusted for this text
    return tuple(replace(p, rule=Rule.REVERT, similarity=None) for p in stored)


def _link_blocks(
    old: tuple[Para, ...], blocks: Sequence[Block], memory: Memory, index: int
) -> tuple[list[_Link], int]:
    links: list[_Link | None] = [None] * len(blocks)
    used_old: set[int] = set()
    opcodes = SequenceMatcher(
        None, [p.block.hash for p in old], [b.hash for b in blocks], autojunk=False
    ).get_opcodes()
    for tag, i1, i2, j1, _ in opcodes:
        if tag == "equal":
            for k in range(i2 - i1):
                links[j1 + k] = _Link(old[i1 + k].para_id, Rule.UNCHANGED, None, old[i1 + k].pos)
                used_old.add(i1 + k)
    _link_moved(old, blocks, links, used_old)
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "replace":
            _link_edited(old, blocks, links, used_old, range(i1, i2), range(j1, j2))
    _link_restored(blocks, links, memory, index)
    next_id = memory.next_para_id
    complete: list[_Link] = []
    for link in links:
        if link is None:
            link = _Link(next_id, Rule.NEW, None, None)
            next_id += 1
        complete.append(link)
    return complete, next_id


def _link_moved(
    old: tuple[Para, ...], blocks: Sequence[Block], links: list[_Link | None], used_old: set[int]
) -> None:
    spare: dict[bytes, deque[int]] = {}
    for i, para in enumerate(old):
        if i not in used_old:
            spare.setdefault(para.block.hash, deque()).append(i)
    for j, block in enumerate(blocks):
        candidates = spare.get(block.hash)
        if links[j] is None and candidates:
            i = candidates.popleft()
            links[j] = _Link(old[i].para_id, Rule.MOVED, None, None)
            used_old.add(i)


def _link_edited(
    old: tuple[Para, ...],
    blocks: Sequence[Block],
    links: list[_Link | None],
    used_old: set[int],
    old_range: range,
    new_range: range,
) -> None:
    scored = sorted(
        
            (-similarity(old[i].block.text, blocks[j].text, EDIT_THRESHOLD), i, j)
            for i in old_range
            for j in new_range
            if i not in used_old and links[j] is None and old[i].block.kind == blocks[j].kind
        
    )
    for negative_score, i, j in scored:
        if -negative_score < EDIT_THRESHOLD:
            break
        if i in used_old or links[j] is not None:
            continue
        links[j] = _Link(old[i].para_id, Rule.EDITED, -negative_score, None)
        used_old.add(i)


def _link_restored(blocks: Sequence[Block], links: list[_Link | None], memory: Memory, index: int) -> None:
    newest_first = memory.absent[::-1]
    taken: set[int] = set()
    for j, block in enumerate(blocks):   # an identical wording may come back at any age
        if links[j] is not None:
            continue
        same = next((a for a in newest_first if a.para_id not in taken and a.block.hash == block.hash), None)
        if same is not None:
            links[j] = _Link(same.para_id, Rule.RESTORED, None, None)
            taken.add(same.para_id)
    for j, block in enumerate(blocks):   # a reworded one only if it was removed recently
        if links[j] is not None:
            continue
        best: tuple[float, Absent] | None = None
        for candidate in newest_first:
            if (
                candidate.para_id in taken
                or candidate.block.kind != block.kind
                or index - candidate.removed_at > RESTORE_WINDOW
            ):
                continue
            score = similarity(candidate.block.text, block.text, RESTORE_THRESHOLD)
            if score >= RESTORE_THRESHOLD and (best is None or score > best[0]):
                best = (score, candidate)
        if best is not None:
            links[j] = _Link(best[1].para_id, Rule.RESTORED, best[0], None)
            taken.add(best[1].para_id)


def _remember(
    memory: Memory, old: tuple[Para, ...], paras: tuple[Para, ...], sha1: str | None, index: int, next_id: int
) -> Memory:
    present = {p.para_id for p in paras}
    newly_gone = tuple(Absent(p.para_id, p.block, index) for p in old if p.para_id not in present)
    absent = tuple(a for a in memory.absent if a.para_id not in present) + newly_gone
    by_sha1 = memory.by_sha1
    if sha1 is not None and sha1 not in by_sha1:
        by_sha1 = MappingProxyType({**by_sha1, sha1: paras})
    return Memory(next_para_id=next_id, by_sha1=by_sha1, absent=absent)
