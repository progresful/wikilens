from wikilens.db import schema_statements


def test_schema_statements_ignore_comments_containing_semicolons():
    sql = "-- header; with a semicolon\nCREATE TABLE a (\n  x INT, -- note; more\n  y INT\n);\nDROP TABLE b;\n"
    assert schema_statements(sql) == ["CREATE TABLE a (\n  x INT,\n  y INT\n)", "DROP TABLE b"]


def test_schema_statements_of_empty_text():
    assert schema_statements("\n-- only a comment\n") == []
