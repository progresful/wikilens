# Measurements and verified facts

Everything here was observed on this project's own setup. Nothing is copied from the starter
projects' published numbers.

## Environment

| | |
|---|---|
| Machine | Apple M1 Pro, 32 GB RAM, macOS (Darwin 25.6.0); Docker limited to 8 GB RAM |
| MariaDB | 12.3.3-MariaDB-ubu2404 (`SELECT VERSION()`) |
| Image | `mariadb@sha256:4ebbcf100a3ba320766dfa0e1af008df12261301db6ef72798c7650f70794aed` (`mariadb:lts` as pulled on 14 November 2026) |
| Server options | `--max-allowed-packet=64M --innodb-buffer-pool-size=2G`; `secure_timestamp = NO` (the default) |
| Python | 3.14.10, PyMySQL 2.2.8, PyArrow 26.0.1 |

## Query shapes, verified 14 November 2026

Checked by `backend/tests/test_query_shapes.py` against the server above, on a hand-made fixture.

| Claim | Result |
|---|---|
| History rows can be written with real past times (`SET system_versioning_insert_history = 1`) | Works with an ordinary user; no special privilege needed |
| `FOR SYSTEM_TIME AS OF` returns the state at a moment | Works |
| Validity is half-open: the new state begins exactly at the boundary, and one microsecond earlier still shows the old one | Works |
| A paragraph can be absent for a period and return under the same primary key | Works: two history periods and a gap for one `(page_id, para_id)` |
| A moment before the first row returns nothing | Works |
| Time travel and vector ranking in one statement: `FOR SYSTEM_TIME ALL` joined to a `VECTOR` table, ordered by `VEC_DISTANCE_COSINE` | **Works in the one-statement form.** The two-step fallback is not needed. Plan: `ref` on the paragraph primary key, `eq_ref` on the vector table's primary key |
| A vector index on a plain (not versioned) table is used for nearest-neighbour search | Works: `EXPLAIN` shows key `embedding`, type `index` |
| Can one article's history be deleted from a versioned table? (`DELETE HISTORY FROM paragraph WHERE page_id = 7`) | **No.** Error 1064, syntax error: `DELETE HISTORY` takes no `WHERE`. Reloading an article therefore means resetting the derived tables (`ingest --reset`) |

Not tested, and not relied on: a vector index on a system-versioned table.
