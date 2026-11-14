"""Shared fixtures. The tests run against the real MariaDB from docker-compose.yml."""
import pytest

from wikilens.config import load_settings
from wikilens.db import apply_schema, connect

TEST_DATABASE = "wikilens_test"


@pytest.fixture(scope="module")
def con():
    """A connection to the test database, with empty tables, once per test module."""
    connection = connect(load_settings(), database=TEST_DATABASE)
    apply_schema(connection)
    yield connection
    connection.close()
