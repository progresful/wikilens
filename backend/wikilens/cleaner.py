"""Wikitext to readable blocks. Not MediaWiki's parser: templates, tables and references are
dropped, links become plain words, headings and list items are kept.

Ported from history.py in MariaDB/mariadb-system-versioning-wikipedia, which is
Copyright (c) 2026 MariaDB Foundation and used under the MIT License. The full notice is in
LICENSES/mariadb-system-versioning-wikipedia.LICENSE at the repository root.

Changed from the original in three ways:
  - Only matched {{ }} and {| |} pairs are dropped. The original dropped everything after an
    unclosed opener, which reads as "the rest of the page was removed" although Wikipedia
    still showed it.
  - A redirect page yields no blocks.
  - Openers and closers are found with one regular expression instead of a character loop.
  - HTML entities (&nbsp;, &ndash;, ...) are decoded.
  - Lines that are only a link to another language's article are dropped.
"""
from __future__ import annotations

import html
import re

from wikilens.blocks import Block

_REDIRECT = re.compile(r"\s*#(OHJAUS|REDIRECT|UUDELLEENOHJAUS)\b", re.IGNORECASE)
_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_REF_EMPTY = re.compile(r"<ref[^>/]*/>")
_REF = re.compile(r"<ref[^>]*>.*?</ref>", re.DOTALL)
_FILE_OR_CATEGORY = re.compile(
    r"\[\[(?:Tiedosto|Kuva|File|Image|Luokka|Category):[^\[\]]*(?:\[\[[^\]]*\]\][^\[\]]*)*\]\]"
)
# A line that is only a link to the article in another language ([[en:Winter War]]). Old
# revisions end with dozens of them; Wikipedia showed them in the sidebar, not in the text.
_LANGUAGE_LINK_LINE = re.compile(r"^\[\[[a-z]{2,3}(?:-[a-z-]+)?:[^\[\]|]+\]\][ \t]*$", re.MULTILINE)
_PIPED_LINK = re.compile(r"\[\[([^\]|]*)\|([^\]]*)\]\]")
_LINK = re.compile(r"\[\[([^\]]*)\]\]")
_EXTERNAL_LINK = re.compile(r"\[https?://\S+ ([^\]]*)\]")
_TAG = re.compile(r"<[^>]+>")
_HEADING = re.compile(r"^(=+)\s*(.*?)\s*=+$")
_TEMPLATE_TOKEN = re.compile(r"\{\{|\}\}")
_TABLE_TOKEN = re.compile(r"\{\||\|\}")


def _drop_matched(text: str, token: re.Pattern[str], opener: str) -> str:
    """Remove every outermost opener...closer pair. An opener with no closer stays as text."""
    open_starts: list[int] = []
    pairs: list[tuple[int, int]] = []
    for found in token.finditer(text):
        if found.group() == opener:
            open_starts.append(found.start())
        elif open_starts:
            pairs.append((open_starts.pop(), found.end()))
    if not pairs:
        return text
    kept: list[str] = []
    cursor = 0
    for start, end in sorted(pairs):
        if start < cursor:          # nested inside a pair already dropped
            continue
        kept.append(text[cursor:start])
        cursor = end
    kept.append(text[cursor:])
    return "".join(kept)


def clean(wikitext: str) -> list[Block]:
    """Wikitext -> blocks in reading order: headings ('h'), list items ('li'), paragraphs ('p')."""
    if _REDIRECT.match(wikitext):
        return []
    t = _COMMENT.sub("", wikitext)
    t = _REF_EMPTY.sub("", t)
    t = _REF.sub("", t)
    t = _drop_matched(t, _TEMPLATE_TOKEN, "{{")
    t = _drop_matched(t, _TABLE_TOKEN, "{|")
    t = _FILE_OR_CATEGORY.sub("", t)
    t = _LANGUAGE_LINK_LINE.sub("", t)
    t = _PIPED_LINK.sub(r"\2", t)
    t = _LINK.sub(r"\1", t)
    t = _EXTERNAL_LINK.sub(r"\1", t)
    t = _TAG.sub("", t)
    t = html.unescape(t)   # after the tags are gone, so escaped markup stays visible as text
    t = t.replace("'''", "").replace("''", "")
    blocks: list[Block] = []
    for raw_line in t.split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        heading = _HEADING.match(line)
        if heading:
            blocks.append(Block.of("h", heading.group(2)))
        elif line[0] in "*#":
            blocks.append(Block.of("li", line.lstrip("*#: ")))
        elif line[0] not in "|!:;":
            blocks.append(Block.of("p", line))
    return blocks
