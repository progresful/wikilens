from wikilens.db import schema_statements


def test_schema_statements_ignore_comments_containing_semicolons():
    sql = "-- header; with a semicolon\nCREATE TABLE a (\n  x INT, -- note; more\n  y INT\n);\nDROP TABLE b;\n"
    assert schema_statements(sql) == ["CREATE TABLE a (\n  x INT,\n  y INT\n)", "DROP TABLE b"]


def test_schema_statements_of_empty_text():
    assert schema_statements("\n-- only a comment\n") == []


def test_schema_exists(con):
    from wikilens.db import apply_schema, schema_exists

    apply_schema(con)
    assert schema_exists(con) is True
    con.cursor().execute("DROP TABLE article")
    assert schema_exists(con) is False
    apply_schema(con)


def test_apply_schema_can_keep_vectors(con):
    from wikilens.db import apply_schema
    from wikilens.queries import vector_literal

    def count(table):
        cur = con.cursor()
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        return cur.fetchone()[0]

    apply_schema(con)
    cur = con.cursor()
    cur.execute("INSERT INTO wording_vector (hash, embedding) VALUES (%s, VEC_FromText(%s))",
                (b"\x01" * 16, vector_literal([1.0] + [0.0] * 1023)))
    cur.execute("INSERT INTO corpus_fact (name, value) VALUES ('a', 'b')")
    con.commit()
    apply_schema(con, keep_vectors=True)
    assert (count("wording_vector"), count("corpus_fact")) == (1, 0)
    apply_schema(con)
    assert count("wording_vector") == 0
