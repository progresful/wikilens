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

## First real article, 14 November 2026

`python -m wikilens.ingest --pages 1256 --verify-every 25` (Talvisota, one process).

| | |
|---|---|
| Dataset M download | 16 Parquet files, 310 MB on disk, all matching `SHA256SUMS`, 38 s |
| Revisions | 2,143, none without text |
| Raw wikitext of those revisions | 156.4 MB (sum of the dump's byte counts) |
| Ingest time | 23.6 s, about 90 revisions per second |
| Round trip | 87 sampled revisions (first, last, every 25th): the stored article equals the cleaner's output at each one |
| Paragraphs ever seen | 842 identities, 2,645 distinct wordings |
| Versioned rows | 4,359 in `paragraph`: 842 new, 1,915 edited, 99 moved, 146 restored, 1,357 opened by a full revert |
| Size in MariaDB | 5.7 MB: `wording` 3.6, `paragraph` 1.7, `revision` 0.4. About 27 times smaller than the raw text, because only changed paragraphs are stored |
| Frame query (`FOR SYSTEM_TIME AS OF`), median of 20 | 0.69 ms at 2005-06-01 (52 blocks), 2.19 ms at 2012-06-01 (267 blocks), 2.09 ms at 2026-09-30 (297 blocks) |

Database time only, measured in the Python process around execute and fetch, warm, one connection.

## Embeddings and asking, 14 November 2026

bge-m3 through Ollama 0.40.16 on the machine above, batches of 32, article 1256 (Talvisota).

| | |
|---|---|
| Wordings embedded | 2,314 (paragraphs and list items of 40+ characters; headings and shorter ones skipped) |
| Embedding speed | 113 s, 20.5 passages per second |
| Question embedding | about 30 ms warm, 204 ms for the first call |
| Ranking every wording the article ever had (4,359 versioned rows joined to their vectors) | **14 ms** with the question vector in a session variable (`SET @question = VEC_FromText(?)`) |
| The same ranking with the vector written inline as `VEC_FromText('[...]')` | 287 ms: MariaDB parsed the 1,024 numbers again for every row |
| The same with the vector passed as a binary parameter | 9.8 ms; not used, because the statement shown on screen would contain a blob |

All three forms returned the same three paragraphs with the same distances. Medians of 7 runs.

## Tier 1 load, 14 November 2026

`python -m wikilens.ingest --reset --tier1 --workers 8 --verify-every 25`, then
`python -m wikilens.embed --tier1`. The 50 articles are those of MariaDB's system-versioning
starter (`data/articles.tsv`).

| | |
|---|---|
| Ingest | 31,848 revisions in 183 s with 8 worker processes, about 174 revisions per second |
| Round trip | all 50 articles pass: at the first, the last and every 25th revision, the stored article equals the cleaner's output for that revision |
| Revisions the dump carried no text for | 8; the previous state is carried forward and they are counted |
| Paragraph identities | 18,248 |
| Raw wikitext of the 31,848 revisions | 1,955 MB (sum of the dump's byte counts) |
| Text and history in MariaDB | 60.1 MB: `wording` 36.1, `paragraph` 13.0, `revision` 11.0. About 33 times smaller than the raw text |
| Vectors | 308.6 MB for `wording_vector` including its index; 32,461 vectors of 1,024 float32 values. 347 belong to wordings an earlier cleaner version produced and are no longer referenced |
| Embedding | 16 to 20 passages per second; about 30 minutes for all of tier 1 |

The first parallel load failed: two loaders sharing a wording collided with MariaDB error 1020
under the default isolation level. Loads now run at READ COMMITTED and insert wordings in hash
order; `backend/tests/test_ingest_roundtrip.py` reproduces the collision.

## Dragging across the whole timeline, 14 November 2026

`node web/scripts/drag-probe.mjs` in headless Chromium at 1440 by 900, on the real Talvisota
article (about 300 blocks on the page, 2,143 revisions), dragging from the corpus end back to
2003 in 240 pointer moves. Run while the tier 2 load was using all eight cores.

| | No question | With a question asked |
|---|---|---|
| Pointer moves | 240 | 240 |
| Live `AS OF` queries answered | 241: every move got its frame | 241 |
| Animation frames per second | 55 | 60 |
| Main-thread tasks longer than 50 ms | 0 | 0 |
| Paragraphs left waiting for text | 0 | 0 |

An article's paragraph texts are fetched once when it opens (`GET /api/articles/{id}/wordings`),
so a frame only carries paragraph identities and hashes.

## The whole dataset, 14 November 2026

`python -m wikilens.ingest --reset --all --workers 8 --verify-every 100`: every article of
dataset M, loaded from scratch with the final cleaner and matcher.

| | |
|---|---|
| Articles | 19,742 loaded, 0 failed |
| Revisions | 862,076, from 21 February 2003 to 1 October 2026 10:59 UTC |
| Load time | 510 s with 8 worker processes, about 1,690 revisions per second |
| Round trip | every article passes: at the first, the last and every 100th revision, the stored article equals the cleaner's output for that revision |
| Revisions the dump carried no text for | 483; the previous state is carried forward and they are counted |
| Raw wikitext of the 862,076 revisions | 11,599 MB (sum of the dump's byte counts) |
| Text and history in MariaDB | 959 MB: `wording` 526.5 (with its full-text index), `revision` 221.3, `paragraph` 208.6, `article` 2.5. About 12 times smaller than the raw text |
| Paragraph versions (rows of the versioned table, all history) | 1,219,370 |
| Distinct wordings | 904,054 |
| Vectors | 32,507, for the 50 tier 1 articles only (308.6 MB with the index). The other 19,692 articles answer questions by keyword match |

An earlier attempt at this load stalled for half an hour on one article (page 15600, a
35,000-character paragraph): comparing two such texts character by character does not finish.
Texts over about 1,000 characters are now compared by word, and very long ones by the words
they share; `backend/tests/test_matcher.py` holds the case under a time limit.

The frame timings below are taken at random moments of random articles across all 19,742.

<!-- measured by wikilens.measure: start -->
## Coverage and speed, measured

| | |
|---|---|
| Machine | Apple M1 Pro, 32 GB RAM |
| Measured | 14 November 2026 14:40 |
| Python | 3.14.10 |
| MariaDB | 12.3.3-MariaDB-ubu2404 |
| Articles | 19,742 |
| Revisions | 862,076 |
| Paragraph versions (rows of the versioned table, all history) | 1,219,370 |
| Distinct wordings | 904,054 |
| Vectors | 32,507 |
| Database size | 1,268 MB |

| Milliseconds | p50 | p95 | |
|---|---|---|---|
| Frame query: the article at a random moment (`FOR SYSTEM_TIME AS OF`) | 0.56 | 0.93 | 200 samples |
| Question embedding (bge-m3 through Ollama) | 19.63 | 20.49 | 30 samples |
| Ranking every wording an article ever had (versioned rows joined to vectors) | 12.32 | 21.70 | 30 samples |

Database and model time only, measured in the Python process, warm, one connection.
Network, JSON and browser time are not included.
<!-- measured by wikilens.measure: end -->

## After these measurements

Three more articles were embedded on 14 November 2026 while looking for a "then and now"
story: *Suomen tasavallan presidentti* (1,042 wordings), *Sauli Niinistö* (1,171) and
*Suomen Nato-jäsenhakemus* (265). The database then held 34,985 vectors. The figures above
were not measured again. The loading steps in the README embed only the first of the three.
