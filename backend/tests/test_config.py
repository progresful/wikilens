from datetime import datetime

import pytest

from wikilens.config import ConfigError, load_settings

ENV = {"WIKILENS_DB_USER": "u", "WIKILENS_DB_PASSWORD": "p"}


def test_defaults():
    s = load_settings(ENV)
    assert (s.db_host, s.db_port, s.db_name) == ("127.0.0.1", 3309, "wikilens")
    assert (s.ollama_url, s.embed_model) == ("http://127.0.0.1:11434", "bge-m3")
    assert s.corpus_end == datetime(2026, 10, 1, 23, 59, 59)


def test_overrides():
    s = load_settings({**ENV, "WIKILENS_DB_NAME": "other", "WIKILENS_DB_PORT": "3310", "WIKILENS_OLLAMA_URL": "http://x:1"})
    assert (s.db_name, s.db_port, s.ollama_url) == ("other", 3310, "http://x:1")


def test_missing_password_is_named():
    with pytest.raises(ConfigError, match="WIKILENS_DB_PASSWORD"):
        load_settings({"WIKILENS_DB_USER": "u"})


def test_port_must_be_a_number():
    with pytest.raises(ConfigError, match="WIKILENS_DB_PORT"):
        load_settings({**ENV, "WIKILENS_DB_PORT": "abc"})


def test_settings_are_immutable():
    s = load_settings(ENV)
    with pytest.raises(AttributeError):
        s.db_name = "x"
