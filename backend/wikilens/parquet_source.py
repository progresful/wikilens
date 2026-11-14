"""Dataset M: every saved version of the History of Finland articles, as Parquet files from
the m-2026-10 release of MariaDB/mariadb-wikipedia-datasets."""
from __future__ import annotations

import csv
import hashlib
import logging
import shutil
import urllib.request
from collections.abc import Collection, Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq

log = logging.getLogger(__name__)

M_BASE_URL = "https://github.com/MariaDB/mariadb-wikipedia-datasets/releases/download/m-2026-10/"
M_FILES = tuple(f"versions-{i:02d}.parquet" for i in range(1, 17))
CHECKSUM_FILE = "SHA256SUMS"
TIER1_PATH = Path(__file__).with_name("tier1.tsv")
COLUMNS = ["page_id", "title", "rev_id", "parent_id", "timestamp", "user", "anonymous",
           "comment", "minor", "sha1", "bytes", "text"]


class ChecksumError(Exception):
    """A dataset file is missing or does not match SHA256SUMS."""


@dataclass(frozen=True)
class RawRevision:
    page_id: int
    title: str
    rev_id: int
    parent_id: int | None
    timestamp: datetime        # UTC, naive, to the second, as Wikipedia recorded it
    user: str | None
    anonymous: bool
    comment: str | None
    minor: bool
    sha1: str | None
    bytes: int
    text: str

    @property
    def text_missing(self) -> bool:
        """The dump carried no text for a revision that had some: not a blanked page."""
        return self.text == "" and self.bytes > 0


def tier1_page_ids() -> list[int]:
    """The 50 articles of the MariaDB system-versioning starter (its data/articles.tsv)."""
    with TIER1_PATH.open(newline="") as handle:
        return [int(row["page_id"]) for row in csv.DictReader(handle, delimiter="\t")]


def parse_checksums(text: str) -> dict[str, str]:
    """SHA256SUMS lines ("<hex>  <name>") -> {name: hex}."""
    pairs = (line.split(maxsplit=1) for line in text.splitlines() if line.strip())
    return {name.strip().lstrip("*"): digest for digest, name in pairs}


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_checksums(dest: Path, sums: Mapping[str, str]) -> list[Path]:
    """The Parquet files named in `sums`, in name order, each checked against its hash."""
    paths: list[Path] = []
    for name in sorted(n for n in sums if n.endswith(".parquet")):
        path = dest / name
        if not path.is_file():
            raise ChecksumError(f"{name} is missing from {dest}")
        if sha256_of(path) != sums[name]:
            raise ChecksumError(f"{name} does not match {CHECKSUM_FILE}")
        paths.append(path)
    return paths


def _fetch(url: str, path: Path) -> None:  # pragma: no cover - network
    log.info("downloading %s", url)
    partial = path.with_suffix(path.suffix + ".part")
    with urllib.request.urlopen(url, timeout=120) as response, partial.open("wb") as out:
        shutil.copyfileobj(response, out)
    partial.replace(path)


def download_m(dest: Path) -> list[Path]:  # pragma: no cover - network
    """Download dataset M into `dest` (315 MB), skipping files already there and intact."""
    dest.mkdir(parents=True, exist_ok=True)
    sums_path = dest / CHECKSUM_FILE
    if not sums_path.is_file():
        _fetch(M_BASE_URL + CHECKSUM_FILE, sums_path)
    sums = {name: digest for name, digest in parse_checksums(sums_path.read_text()).items() if name in M_FILES}
    if len(sums) != len(M_FILES):
        raise ChecksumError(f"{CHECKSUM_FILE} lists {len(sums)} of the {len(M_FILES)} dataset files")
    for name in M_FILES:
        path = dest / name
        if not (path.is_file() and sha256_of(path) == sums[name]):
            _fetch(M_BASE_URL + name, path)
    return verify_checksums(dest, sums)


def _to_revision(row: Mapping[str, Any]) -> RawRevision:
    ts: datetime = row["timestamp"]
    if ts.tzinfo is not None:
        ts = ts.astimezone(UTC).replace(tzinfo=None)
    return RawRevision(
        page_id=row["page_id"], title=row["title"], rev_id=row["rev_id"], parent_id=row["parent_id"],
        timestamp=ts, user=row["user"], anonymous=bool(row["anonymous"]), comment=row["comment"],
        minor=bool(row["minor"]), sha1=row["sha1"], bytes=row["bytes"] or 0, text=row["text"] or "",
    )


def _group_may_hold(statistics: Any, wanted: frozenset[int]) -> bool:
    if statistics is None or not statistics.has_min_max:
        return True
    return any(statistics.min <= page_id <= statistics.max for page_id in wanted)


def _oldest_first(revisions: list[RawRevision]) -> list[RawRevision]:
    return sorted(revisions, key=lambda rev: (rev.timestamp, rev.rev_id))


def iter_pages(files: Sequence[Path], page_ids: Collection[int] | None = None) -> Iterator[list[RawRevision]]:
    """One article per item, its revisions oldest first. Only one article's text is held at a
    time. Row groups that cannot contain a wanted article are skipped without being read."""
    wanted = None if page_ids is None else frozenset(page_ids)
    for path in files:
        parquet = pq.ParquetFile(path)
        page_column = parquet.schema_arrow.get_field_index("page_id")
        current: list[RawRevision] = []
        for group in range(parquet.num_row_groups):
            statistics = parquet.metadata.row_group(group).column(page_column).statistics
            if wanted is not None and not _group_may_hold(statistics, wanted):
                continue
            for row in parquet.read_row_group(group, columns=COLUMNS).to_pylist():
                if wanted is not None and row["page_id"] not in wanted:
                    continue
                if current and current[0].page_id != row["page_id"]:
                    yield _oldest_first(current)
                    current = []
                current.append(_to_revision(row))
        if current:
            yield _oldest_first(current)
