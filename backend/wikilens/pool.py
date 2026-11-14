"""A small pool of database connections for the API. A scrub sends many requests a second;
opening a connection for each would cost more than the query it runs."""
from __future__ import annotations

import logging
import queue
from collections.abc import Callable, Iterator
from contextlib import contextmanager

import pymysql
from pymysql.connections import Connection

log = logging.getLogger(__name__)


class ConnectionPool:
    def __init__(self, factory: Callable[[], Connection], size: int = 8) -> None:
        self._factory = factory
        self._idle: queue.LifoQueue[Connection] = queue.LifoQueue(maxsize=size)

    def _take(self) -> Connection:
        try:
            con = self._idle.get_nowait()
        except queue.Empty:
            return self._factory()
        try:
            con.ping(reconnect=False)
        except pymysql.err.Error:
            self._discard(con)
            return self._factory()
        return con

    def _give_back(self, con: Connection) -> None:
        try:
            con.rollback()   # end the read snapshot, so the next request sees current data
            self._idle.put_nowait(con)
        except (pymysql.err.Error, queue.Full):
            self._discard(con)

    @staticmethod
    def _discard(con: Connection) -> None:
        try:
            con.close()
        except pymysql.err.Error:
            log.debug("closing a broken connection failed", exc_info=True)

    @contextmanager
    def connection(self) -> Iterator[Connection]:
        con = self._take()
        try:
            yield con
        except pymysql.err.Error:
            self._discard(con)
            raise
        except BaseException:
            self._give_back(con)
            raise
        else:
            self._give_back(con)

    def close(self) -> None:
        while True:
            try:
                self._discard(self._idle.get_nowait())
            except queue.Empty:
                return
