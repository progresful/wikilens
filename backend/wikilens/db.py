"""Database connection and schema."""
from __future__ import annotations

from pathlib import Path

import pymysql
from pymysql.connections import Connection

from wikilens.config import Settings

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect(settings: Settings, database: str | None = None) -> Connection:
    """A connection in UTC with autocommit off. Wikipedia's times are UTC."""
    con = pymysql.connect(
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        password=settings.db_password,
        database=database or settings.db_name,
        charset="utf8mb4",
        autocommit=False,
    )
    with con.cursor() as cur:
        cur.execute("SET time_zone = '+00:00'")
    return con


def schema_statements(sql: str) -> list[str]:
    """The statements of a .sql file, without its -- comments (which may contain semicolons).
    schema.sql has no string literal containing "--", so cutting at the marker is safe."""
    lines = (line.split("--", 1)[0].rstrip() for line in sql.splitlines())
    kept = "\n".join(line for line in lines if line)
    return [statement.strip() for statement in kept.split(";") if statement.strip()]


def apply_schema(con: Connection) -> None:
    """Drop and recreate every table."""
    with con.cursor() as cur:
        for statement in schema_statements(SCHEMA_PATH.read_text()):
            cur.execute(statement)
    con.commit()


def enable_history_insert(con: Connection) -> None:
    """Let this session write row_start and row_end itself, so history rows carry the time a
    revision was saved on Wikipedia instead of the time we loaded it."""
    with con.cursor() as cur:
        cur.execute("SET system_versioning_insert_history = 1")
