"""Settings, read from the environment. For local runs the repository's .env file fills in
whatever the environment does not set; it is the same file docker-compose.yml reads."""
from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Dataset M holds revisions up to the 1 October 2026 dump. Times are UTC.
CORPUS_END = datetime(2026, 10, 1, 23, 59, 59)


class ConfigError(Exception):
    """A required setting is missing or malformed. The message names the variable."""


@dataclass(frozen=True)
class Settings:
    db_user: str
    db_password: str
    db_host: str = "127.0.0.1"
    db_port: int = 3309
    db_name: str = "wikilens"
    ollama_url: str = "http://127.0.0.1:11434"
    embed_model: str = "bge-m3"
    corpus_end: datetime = CORPUS_END


def read_env_file(path: Path) -> dict[str, str]:
    """KEY=value lines; blank lines and # comments are skipped. A missing file is empty."""
    if not path.is_file():
        return {}
    pairs = (line.split("=", 1) for line in path.read_text().splitlines()
             if "=" in line and not line.lstrip().startswith("#"))
    return {key.strip(): value.strip() for key, value in pairs}


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "")
    if not value:
        raise ConfigError(f"{name} is not set (see .env.example)")
    return value


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    if env is None:
        env = {**read_env_file(REPO_ROOT / ".env"), **os.environ}
    port_text = env.get("WIKILENS_DB_PORT", "3309")
    try:
        port = int(port_text)
    except ValueError:
        raise ConfigError(f"WIKILENS_DB_PORT must be a number, got {port_text!r}") from None
    return Settings(
        db_user=_required(env, "WIKILENS_DB_USER"),
        db_password=_required(env, "WIKILENS_DB_PASSWORD"),
        db_port=port,
        db_name=env.get("WIKILENS_DB_NAME") or "wikilens",
        ollama_url=env.get("WIKILENS_OLLAMA_URL") or "http://127.0.0.1:11434",
    )
