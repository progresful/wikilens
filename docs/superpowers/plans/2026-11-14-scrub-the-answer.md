# WikiLens: Scrub the Answer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app where a user asks a question about a Finnish Wikipedia article and drags a timeline to watch the answering paragraph rewrite itself in place, with every frame served by a MariaDB `FOR SYSTEM_TIME AS OF` query.

**Architecture:** A Python ingest turns dataset M revisions into paragraph rows in a system-versioned MariaDB table stamped with real edit times, plus a deduplicated wording table and a plain vector table. A FastAPI server exposes frame, ask, wording and overview endpoints. A framework-free TypeScript page morphs the answer locally from its preloaded history while live frame queries update the article around it.

**Tech Stack:** MariaDB in Docker (`mariadb:lts`, pinned by digest) · Python 3.14 with PyMySQL, PyArrow, FastAPI, Uvicorn, httpx, pytest · Ollama with bge-m3 · TypeScript, Vite, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-14-scrub-the-answer-design.md`

## Global Constraints

- Finnish source text only. No generated answers, summaries or translations. No language model beyond the embedding model.
- Every scrub frame is a real `FOR SYSTEM_TIME AS OF` query. The SQL panel shows only a query that ran for that frame, with the database time the server measured.
- No spinner or wait while the playhead moves.
- Timeline labels are exactly: `first appears`, `text changed`, `heavily rewritten`, `removed`, `restored unchanged`, `restored, reworded`, `replaced, reverted after <duration>`. No label asserts intent.
- Times are UTC. A version is valid from its start up to but not including the next start. Revisions sharing a second are ordered by revision id and separated by 1 µs; the original timestamp is what is displayed.
- Corpus cutoff is 1 October 2026 (`2026-10-01T23:59:59Z`). The playhead cannot pass it.
- Edit similarity threshold `0.5` (the starter's value). Embeddings: bge-m3 through Ollama, 1024 dimensions, cosine, passage text alone as input.
- Vectors live in a plain table. No partitioning. Raw wikitext is not loaded into MariaDB.
- Tier 1 is the starter's 50 articles (`data/articles.tsv` in `MariaDB/mariadb-system-versioning-wikipedia`).
- Tests first, 80% coverage on Python logic and on pure browser logic (`time.ts`, `diff.ts`, `wordingCache.ts`, `scrub.ts`, `api.ts`). View and animation code: end-to-end tests only, no coverage target.
- Validate input at the API boundary. Every API response uses the envelope `{success, data, error, meta}`. Errors never expose exception text.
- No secrets in the repository; database credentials come from `.env`.
- Demo works offline: fonts bundled, no CDN.
- Page footer credits Wikipedia under CC BY-SA 4.0 with a link to each revision. Code ported from the starter keeps its MIT notice.
- Commits use `<type>: <description>` with no attribution trailer (owner's global setting).
- Cut order if time runs short: Task 16, Task 15, other-match chips, heat tint. Never cut tests or the live query.

**Three places this plan departs from the spec's wording, on purpose:**

1. *Reloading an article.* The spec says reloading replaces one article. A versioned table's history cannot be deleted for one key, so a reload is `--reset` (drop and recreate the derived tables). Task 1 probes this and records the result.
2. *Frame requests.* The spec says an in-flight request is abandoned when a newer one is issued. During a fast drag that would starve the page, so the scrubber keeps one request in flight and one pending time (the newest), and drops any response older than the newest delivered. Nothing is queued.
3. *Time over the wire.* The API uses epoch milliseconds. A wording that existed for less than 1 ms (an artefact of the 1 µs separation) is left out of the answer timeline.

## Review Focus

Inputs the spec implies but does not spell out, most likely first. Each is pinned by a test in the task named.

1. **The same paragraph text twice in one article** (repeated list items, boilerplate lines). Each keeps its own identity and both are shown. → Task 3, `test_duplicate_blocks_keep_separate_identities`.
2. **A revision that cleans to nothing** (a redirect, a page reduced to a template). Every paragraph ends, a later revert brings them back, nothing crashes, the page shows its empty state. → Task 2 `test_redirect_yields_no_blocks`, Task 3 `test_zero_blocks_ends_everything_and_revert_brings_it_back`.
3. **Markup or script inside article text.** It is shown as text and never interpreted. → Task 8 `test_markup_in_wording_is_returned_verbatim`, Task 12 `markup in article text is shown as text`.
4. **A blank, punctuation-only or oversized question.** Rejected with a plain message; no embedding call is made. → Task 8 `test_blank_question_400`, `test_question_over_300_chars_400`; Task 13 `blank question shows a message and sends nothing`.
5. **The database or network failing mid-scrub.** The answer keeps moving, an error line appears, it clears on recovery, and no stale page is presented as current. → Task 11 `reports an error and clears it on the next success`, `keeps calling onTime while requests fail`; Task 13 `database failure mid-scrub`.

---

## File Structure

```
docker-compose.yml  .env.example  .gitignore  pyproject.toml  README.md
backend/wikilens/
  config.py          settings from the environment
  db.py              connect, apply schema, enable historical insert
  schema.sql         tables
  queries.py         every SQL statement and the functions that run them
  blocks.py          Block and its hash
  cleaner.py         wikitext -> blocks (ported from the starter, hardened)
  positions.py       fractional reading-order positions
  matcher.py         paragraph identity across revisions (pure)
  history_rows.py    valid-from times and versioned rows (pure)
  parquet_source.py  download and iterate dataset M
  ingest.py          load articles; round-trip verification; CLI
  fixture.py         the scripted test article used by pytest and Playwright
  embedder.py        Embedder protocol, Ollama and stub implementations
  embed.py           embed missing wordings; CLI
  timeline.py        answer segments, gaps and labels (pure)
  schemas.py         API response models
  api.py             FastAPI app
  stories.py         candidate stories for hand reading; CLI
  stories.json       reviewed articles and example questions
  measure.py         timings and coverage -> docs/measurements.md
  tier1.tsv          the 50 tier 1 page ids
backend/tests/       one test file per module above, plus conftest.py
web/
  index.html  package.json  vite.config.ts  tsconfig.json  playwright.config.ts
  src/types.ts  time.ts  diff.ts  wordingCache.ts  api.ts  scrub.ts  state.ts  main.ts  styles.css
  src/views/page.ts  timeline.ts  minimap.ts  sqlPanel.ts  picker.ts  morph.ts  answer.ts  about.ts
  tests/*.test.ts    unit tests for the pure modules
  e2e/landing.spec.ts  hero.spec.ts
docs/measurements.md  docs/stories.md  docs/demo-script.md
scripts/demo.sh  scripts/check.sh
```

Ports: MariaDB `3309`, API `8000`, Vite `5173`. Databases: `wikilens` (real data), `wikilens_test` (pytest), `wikilens_e2e` (Playwright).

---

### Task 1: Project skeleton and proof of the query shapes

**Files:**
- Create: `.gitignore`, `.env.example`, `docker-compose.yml`, `pyproject.toml`, `backend/wikilens/__init__.py`, `backend/wikilens/config.py`, `backend/wikilens/db.py`, `backend/wikilens/schema.sql`, `backend/wikilens/queries.py`, `backend/tests/conftest.py`, `backend/tests/test_query_shapes.py`, `docs/measurements.md`

**Interfaces:**
- Produces:
  - `config.Settings` (frozen dataclass): `db_host="127.0.0.1"`, `db_port=3309`, `db_user`, `db_password`, `db_name="wikilens"`, `ollama_url="http://127.0.0.1:11434"`, `embed_model="bge-m3"`, `corpus_end=datetime(2026, 10, 1, 23, 59, 59)`. `load_settings(env: Mapping[str, str] = os.environ) -> Settings` reads `WIKILENS_DB_USER`, `WIKILENS_DB_PASSWORD`, `WIKILENS_DB_NAME`, `WIKILENS_DB_PORT`, `WIKILENS_OLLAMA_URL`; raises `ConfigError` naming a missing variable.
  - `db.connect(settings: Settings, database: str | None = None) -> pymysql.connections.Connection` (autocommit off, runs `SET time_zone = '+00:00'`); `db.apply_schema(con) -> None` (drops and recreates every table); `db.enable_history_insert(con) -> None`.
  - `queries.FRAME_SQL`, `queries.RANK_SQL`, `queries.NEAREST_SQL` (the statements in spec section 8.2, with `%s` placeholders). Ties are broken by `para_id`: `ORDER BY pos, para_id` in the frame, `ORDER BY distance, para_id` in the ranking.
  - `queries.FrameBlock(para_id: int, hash: bytes, rev_id: int)`, `queries.FrameResult(blocks: list[FrameBlock], sql: str, db_ms: float)` — `sql` is `FRAME_SQL` with the bound values written in, for display only.
  - `queries.frame_at(con, page_id: int, t: datetime) -> FrameResult`
  - `queries.rank_paragraphs(con, page_id: int, vector: Sequence[float], limit: int = 3) -> list[tuple[int, float]]` (para_id, distance)
  - `queries.nearest_wordings(con, vector: Sequence[float], limit: int = 10) -> list[tuple[bytes, float]]`
  - `queries.vector_literal(v: Sequence[float]) -> str` (JSON text for `VEC_FromText`)
  - pytest fixture `con`: a connection to `wikilens_test` with the schema freshly applied for each test module.
  - Tables as in spec section 8.1, plus: `wording` has `FULLTEXT KEY ft_text (text)`; `article(page_id PK, title, revisions INT, first_ts DATETIME, last_ts DATETIME, tier TINYINT, text_missing_revisions INT)`; `corpus_fact(name VARCHAR(64) PK, value VARCHAR(255))`.

- [ ] **Step 1: Repository and database**

`git init`. `.gitignore`: `.venv/ node_modules/ web/dist/ data/ .env .superpowers/ __pycache__/ .pytest_cache/ test-results/ playwright-report/`. `.env.example` lists the `WIKILENS_*` variables with empty password. `docker-compose.yml`: one service `mariadb`, image `mariadb:lts`, port `3309:3306`, credentials from `.env`, command `--max-allowed-packet=64M --innodb-buffer-pool-size=2G`, named volume `wikilens-data`, the starter's healthcheck.

Run: `docker compose up -d --wait`, then `docker image inspect mariadb:lts --format '{{index .RepoDigests 0}}'`
Expected: a `mariadb@sha256:…` reference. Replace the tag in `docker-compose.yml` with it and write it, with the output of `SELECT VERSION()`, into `docs/measurements.md`. Create the three databases and grant the user access to them.

- [ ] **Step 2: Python environment**

`pyproject.toml`: package `wikilens` from `backend/`; dependencies `pymysql`, `pyarrow`, `fastapi`, `uvicorn`, `httpx`; dev extras `pytest`, `pytest-cov`; pytest `testpaths = ["backend/tests"]`, `addopts = "--cov=wikilens --cov-report=term-missing"`.

Run: `python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'`
Expected: installs without building from source.

- [ ] **Step 3: Write the failing tests** in `backend/tests/test_query_shapes.py`

```python
T = datetime.fromisoformat
H1, H2, H3 = b"\x01" * 16, b"\x02" * 16, b"\x03" * 16
def unit(i): return [1.0 if k == i else 0.0 for k in range(1024)]

# seed(con): page 7.
#   para 1: H1 from 2010-01-01 to 2012-01-01, H2 to 2014-01-01, absent to 2015-01-01, H2 from 2015-01-01 (current)
#   para 2: H3 from 2011-01-01 (current), pos after para 1
#   wording_vector: H1 -> unit(0), H2 -> unit(1), H3 -> unit(2)
def state(con, t): return [(b.para_id, b.hash) for b in frame_at(con, 7, T(t)).blocks]

def test_as_of_returns_state_at_moment(con):      assert state(con, "2011-06-01") == [(1, H1), (2, H3)]
def test_boundary_is_half_open(con):
    assert state(con, "2012-01-01 00:00:00") == [(1, H2), (2, H3)]
    assert state(con, "2011-12-31 23:59:59.999999") == [(1, H1), (2, H3)]
def test_gap_then_restore_under_same_key(con):
    assert state(con, "2014-06-01") == [(2, H3)]
    assert state(con, "2015-06-01") == [(1, H2), (2, H3)]
def test_before_first_row_is_empty(con):          assert state(con, "2009-01-01") == []
def test_frame_reports_sql_and_time(con):
    r = frame_at(con, 7, T("2011-06-01"))
    assert "FOR SYSTEM_TIME AS OF TIMESTAMP '2011-06-01 00:00:00" in r.sql and r.db_ms >= 0
def test_rank_over_all_history_finds_a_wording_that_is_gone(con):
    para_id, distance = rank_paragraphs(con, 7, unit(0))[0]
    assert para_id == 1 and distance == pytest.approx(0.0, abs=1e-6)
def test_vector_index_on_plain_table(con):        assert nearest_wordings(con, unit(2), limit=1)[0][0] == H3
```

- [ ] **Step 4: Run to see them fail**

Run: `.venv/bin/pytest backend/tests/test_query_shapes.py -v`
Expected: FAIL, `ModuleNotFoundError: wikilens.queries` (or missing names).

- [ ] **Step 5: Implement** `config.py`, `db.py`, `schema.sql`, `queries.py` to the interfaces above

If `RANK_SQL` is rejected or slow in the one-statement form, `rank_paragraphs` runs two statements instead (`SELECT DISTINCT para_id, hash FROM paragraph FOR SYSTEM_TIME ALL WHERE page_id = %s`, then distances from `wording_vector WHERE hash IN (…)`) and takes the minimum per paragraph in Python. Record which form is in use in `docs/measurements.md`.

- [ ] **Step 6: Run to see them pass**

Run: `.venv/bin/pytest backend/tests/test_query_shapes.py -v`
Expected: 7 passed.

- [ ] **Step 7: Probe per-page history deletion**

Run against `wikilens_test`: `DELETE HISTORY FROM paragraph WHERE page_id = 7`
Expected: a syntax error. Record the outcome in `docs/measurements.md`. If it unexpectedly succeeds, Task 5's `--reset` may be narrowed to one article.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: project skeleton and verified MariaDB query shapes"
```

---

### Task 2: Blocks and the hardened cleaner

**Files:**
- Create: `backend/wikilens/blocks.py`, `backend/wikilens/cleaner.py`, `backend/tests/test_cleaner.py`
- Port from: starter `history.py`, functions `_drop_nested` and `clean` (keep the MIT notice in the file header)

**Interfaces:**
- Produces:
  - `blocks.Block` (frozen dataclass): `kind: Literal["p", "li", "h"]`, `text: str`, `hash: bytes`; `Block.of(kind, text) -> Block` with `hash = hashlib.md5(f"{kind}\n{text}".encode("utf-8")).digest()`.
  - `cleaner.clean(wikitext: str) -> list[Block]`

- [ ] **Step 1: Write the failing tests**

```python
def pairs(s): return [(b.kind, b.text) for b in clean(s)]

def test_kinds():
    assert pairs("== Tausta ==\nEka kappale.\n* kohta\n") == [("h", "Tausta"), ("p", "Eka kappale."), ("li", "kohta")]
def test_templates_refs_links_and_emphasis_removed():
    assert pairs("{{Infobox|a=b}}Sota alkoi<ref>lähde</ref> [[Suomi|Suomessa]] ''vuonna'' 1939.") == [("p", "Sota alkoi Suomessa vuonna 1939.")]
def test_nested_template_removed():
    assert pairs("Alku {{a|{{b}}|c}} loppu.") == [("p", "Alku  loppu.")]
def test_unclosed_template_keeps_rest_of_page():
    assert pairs("Alku.\n{{rikki|x\nLoppu säilyy.") == [("p", "Alku."), ("p", "{{rikki|x"), ("p", "Loppu säilyy.")]
def test_unclosed_table_keeps_rest_of_page():
    assert pairs("Alku.\n{| class=x\nLoppu.")[-1] == ("p", "Loppu.")
def test_empty_and_whitespace():       assert clean("") == [] and clean("  \n\n") == []
def test_redirect_yields_no_blocks():
    assert clean("#OHJAUS [[Talvisota]]") == [] and clean("#redirect [[Talvisota]]") == []
def test_hash_depends_on_kind_and_text():
    a = Block.of("p", "a")
    assert len(a.hash) == 16 and a.hash == Block.of("p", "a").hash and a.hash != Block.of("li", "a").hash
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/pytest backend/tests/test_cleaner.py -v`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `Block` and `clean`**

Keep the starter's behaviour except: (a) only matched opener/closer pairs are dropped; an opener with no closer stays as literal text and scanning continues after it; (b) a text beginning with `#OHJAUS`, `#REDIRECT` or `#UUDELLEENOHJAUS` (any case) returns `[]`; (c) find openers and closers with one compiled regex, not a per-character Python loop, because tier 1 alone is 2 GB of text.

- [ ] **Step 4: Run to see them pass**

Run: `.venv/bin/pytest backend/tests/test_cleaner.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: blocks and hardened wikitext cleaner"
```

---

### Task 3: Paragraph matcher

**Files:**
- Create: `backend/wikilens/positions.py`, `backend/wikilens/matcher.py`, `backend/tests/test_positions.py`, `backend/tests/test_matcher.py`

**Interfaces:**
- Consumes: `Block` (Task 2).
- Produces:

```python
# positions.py
def assign_positions(existing: Sequence[float | None]) -> tuple[list[float], bool]
# existing[i]: the kept position of block i in new reading order (strictly increasing among kept ones), or None.
# Returns a position for every block and whether everything was renumbered to 1.0, 2.0, ….

# matcher.py
class Rule(IntEnum): NEW = 1; UNCHANGED = 2; MOVED = 3; EDITED = 4; RESTORED = 5; REVERT = 6
EDIT_THRESHOLD = 0.5; RESTORE_THRESHOLD = 0.6; RESTORE_WINDOW = 20
@dataclass(frozen=True)
class Para: para_id: int; pos: float; block: Block; rule: Rule; similarity: float | None
@dataclass(frozen=True)
class PageState: rev_id: int; paras: tuple[Para, ...]; text_missing: bool = False
@dataclass(frozen=True)
class Absent: para_id: int; block: Block; removed_at: int      # index of the revision that removed it
@dataclass(frozen=True)
class Memory: next_para_id: int = 1; by_sha1: Mapping[str, tuple[Para, ...]] = MappingProxyType({}); absent: tuple[Absent, ...] = ()
def similarity(a: str, b: str) -> float
def match_revision(prev: PageState | None, blocks: Sequence[Block], rev_id: int, sha1: str | None,
                   memory: Memory, index: int) -> tuple[PageState, Memory]
def carry_forward(prev: PageState | None, rev_id: int) -> PageState   # a revision whose text is missing
```

- [ ] **Step 1: Write the failing tests**

```python
# test_positions.py
def test_between_anchors():  assert assign_positions([1.0, None, 2.0]) == ([1.0, 1.5, 2.0], False)
def test_two_between():      assert assign_positions([1.0, None, None, 4.0]) == ([1.0, 2.0, 3.0, 4.0], False)
def test_no_anchors():       assert assign_positions([None, None]) == ([1.0, 2.0], False)
def test_before_first():     assert assign_positions([None, 5.0]) == ([4.0, 5.0], False)
def test_after_last():       assert assign_positions([5.0, None, None]) == ([5.0, 6.0, 7.0], False)
def test_exhausted_gap_renumbers():
    assert assign_positions([1.0, None, 1.0000000001]) == ([1.0, 2.0, 3.0], True)

# test_matcher.py
def P(*texts): return [Block.of("p", t) for t in texts]
def ids(s): return [p.para_id for p in s.paras]
def run(*revs):                      # revs: (blocks, sha1); returns the list of states
    states, prev, mem = [], None, Memory()
    for i, (blocks, sha1) in enumerate(revs):
        prev, mem = match_revision(prev, blocks, 100 + i, sha1, mem, i); states.append(prev)
    return states
A = "Talvisota alkoi 30. marraskuuta 1939."
B = "Talvisota alkoi 30. marraskuuta 1939, kun Neuvostoliitto hyökkäsi."

def test_first_revision_all_new():
    (s,) = run((P("a", "b"), "s1"))
    assert ids(s) == [1, 2] and {p.rule for p in s.paras} == {Rule.NEW}
def test_unchanged_keeps_identity_and_position():
    s1, s2 = run((P("a", "b"), "s1"), (P("a", "b"), "s2"))
    assert ids(s2) == [1, 2] and [p.pos for p in s2.paras] == [p.pos for p in s1.paras] and s2.paras[0].rule == Rule.UNCHANGED
def test_edit_keeps_identity():
    _, s2 = run((P(A, "b"), "s1"), (P(B, "b"), "s2"))
    assert ids(s2) == [1, 2] and s2.paras[0].rule == Rule.EDITED and 0.5 <= s2.paras[0].similarity < 1
def test_dissimilar_replacement_is_a_new_identity():
    _, s2 = run((P("aaaa aaaa aaaa", "b"), "s1"), (P("zzzz qqqq xxxx", "b"), "s2"))
    assert ids(s2) == [3, 2] and s2.paras[0].rule == Rule.NEW
def test_move():
    _, s2 = run((P("a", "b", "c"), "s1"), (P("c", "a", "b"), "s2"))
    pos = [p.pos for p in s2.paras]
    assert ids(s2) == [3, 1, 2] and s2.paras[0].rule == Rule.MOVED and pos == sorted(pos) and len(set(pos)) == 3
def test_insert_does_not_touch_neighbours():
    s1, s2 = run((P("a", "c"), "s1"), (P("a", "b", "c"), "s2"))
    assert (s2.paras[0].pos, s2.paras[2].pos) == (s1.paras[0].pos, s1.paras[1].pos) and s2.paras[0].pos < s2.paras[1].pos < s2.paras[2].pos
def test_remove_then_restore_by_hash_reuses_identity():
    *_, s3 = run((P("a", "b"), "s1"), (P("a"), "s2"), (P("a", "b", "c"), "s3"))
    assert ids(s3) == [1, 2, 3] and s3.paras[1].rule == Rule.RESTORED
def test_restore_reworded_within_window():
    *_, s3 = run((P("a", A), "s1"), (P("a"), "s2"), (P("a", B, "c"), "s3"))
    assert ids(s3)[1] == 2 and s3.paras[1].rule == Rule.RESTORED and s3.paras[1].similarity >= 0.6
def test_full_revert_restores_the_exact_map():
    s1, _, s3 = run((P("x", "y", "z"), "A"), (P("lol"), "B"), (P("x", "y", "z"), "A"))
    assert [(p.para_id, p.pos, p.block) for p in s3.paras] == [(p.para_id, p.pos, p.block) for p in s1.paras]
    assert {p.rule for p in s3.paras} == {Rule.REVERT}
def test_duplicate_blocks_keep_separate_identities():
    s1, s2 = run((P("sama", "sama"), "s1"), (P("sama", "uusi", "sama"), "s2"))
    assert ids(s1) == [1, 2] and (ids(s2)[0], ids(s2)[2]) == (1, 2)
def test_kind_mismatch_is_not_an_edit():
    _, s2 = run(([Block.of("p", A)], "s1"), ([Block.of("h", A)], "s2"))
    assert ids(s2) == [2]
def test_zero_blocks_ends_everything_and_revert_brings_it_back():
    _, s2, s3 = run((P("a", "b"), "A"), ([], "B"), (P("a", "b"), "A"))
    assert s2.paras == () and ids(s3) == [1, 2]
def test_carry_forward_marks_missing_text():
    (s1,) = run((P("a"), "s1"))
    s2 = carry_forward(s1, 999)
    assert s2.paras == s1.paras and s2.text_missing and s2.rev_id == 999
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/pytest backend/tests/test_positions.py backend/tests/test_matcher.py -v`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `assign_positions`**

Between kept positions `a < b` with `k` blocks: `a + (b - a) * (j + 1) / (k + 1)`. Before the first kept position `b`: `b - (k - j)`. After the last kept position `a`: `a + (j + 1)`. No kept positions: `1.0 … n`. If any resulting gap is below `1e-6`, return `1.0 … n` for every block and `True`.

- [ ] **Step 4: Implement `similarity`, `match_revision`, `carry_forward`**

`similarity` is `difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()`, skipped (return 0.0) when `quick_ratio()` is already below the threshold in use. Rules, in this order:

1. `sha1` is not None and in `memory.by_sha1`: the new state is that stored map, every rule `REVERT`. Paragraphs present before and not in that map become `Absent`; paragraphs it brings back leave `absent`. Stop.
2. Align old and new hash sequences with `difflib.SequenceMatcher(...).get_opcodes()`. Blocks in `equal` runs keep `para_id` and position (`UNCHANGED`). These are the kept positions for step 7.
3. A leftover new block whose hash equals a leftover old block's takes that `para_id` (`MOVED`), matching duplicates in order.
4. Within each `replace` stretch, score every old/new pair of the same kind, take pairs best first while similarity ≥ `EDIT_THRESHOLD`; each pair keeps the `para_id` (`EDITED`, similarity stored).
5. A leftover new block whose hash equals an `Absent.block.hash` takes that `para_id` (`RESTORED`), most recently removed first, any age. Failing that, the best `Absent` of the same kind with `index - removed_at <= RESTORE_WINDOW` and similarity ≥ `RESTORE_THRESHOLD` (`RESTORED`, similarity stored).
6. Anything left gets `memory.next_para_id` (`NEW`). Leftover old blocks become `Absent(para_id, block, index)`.
7. Positions: `assign_positions` over the new order, passing only step 2's positions as kept.

The returned `Memory` is a new object: `by_sha1` gains `sha1 -> paras` if the key is new; `absent` drops the restored ones.

- [ ] **Step 5: Run to see them pass**

Run: `.venv/bin/pytest backend/tests/test_positions.py backend/tests/test_matcher.py -v`
Expected: 19 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: paragraph matcher and fractional positions"
```

---

### Task 4: Valid-from times and versioned rows

**Files:**
- Create: `backend/wikilens/history_rows.py`, `backend/tests/test_history_rows.py`

**Interfaces:**
- Consumes: `PageState`, `Para` (Task 3).
- Produces:

```python
def assign_valid_from(revs: Sequence[tuple[int, datetime]]) -> list[tuple[int, datetime]]
# (rev_id, ts) in any order -> sorted by (ts, rev_id), valid_from strictly increasing; a tie is the previous value + 1 µs
@dataclass(frozen=True)
class ParagraphRow:
    page_id: int; para_id: int; pos: float; hash: bytes; rev_id: int
    match_rule: int; similarity: float | None; row_start: datetime; row_end: datetime | None
OpenRows = Mapping[int, ParagraphRow]          # para_id -> the row that is still open
def advance(page_id: int, open_rows: OpenRows, state: PageState, valid_from: datetime) -> tuple[OpenRows, list[ParagraphRow]]
# returns the new open rows and the rows this state closed (row_end = valid_from)
```

- [ ] **Step 1: Write the failing tests**

```python
t1, t2, t3 = datetime(2010, 1, 1), datetime(2011, 1, 1), datetime(2012, 1, 1)
us = lambda n: timedelta(microseconds=n)
def para(i, text, pos=None, rule=Rule.NEW, sim=None): return Para(i, pos or float(i), Block.of("p", text), rule, sim)
def st(rev, *paras): return PageState(rev, tuple(paras))

def test_same_second_revisions_one_microsecond_apart():
    assert assign_valid_from([(5, t1), (3, t1), (9, t1)]) == [(3, t1), (5, t1 + us(1)), (9, t1 + us(2))]
def test_unchanged_paragraph_emits_nothing():
    o, _ = advance(7, {}, st(1, para(1, "a")), t1)
    o2, closed = advance(7, o, st(2, para(1, "a", rule=Rule.UNCHANGED)), t2)
    assert closed == [] and o2[1].row_start == t1
def test_edit_closes_and_opens():
    o, _ = advance(7, {}, st(1, para(1, "a")), t1)
    o2, closed = advance(7, o, st(2, para(1, "b", rule=Rule.EDITED, sim=0.7)), t2)
    assert (closed[0].row_start, closed[0].row_end) == (t1, t2)
    assert (o2[1].row_start, o2[1].row_end, o2[1].rev_id, o2[1].match_rule, o2[1].similarity) == (t2, None, 2, 4, 0.7)
def test_position_only_change_closes_and_opens():
    o, _ = advance(7, {}, st(1, para(1, "a", pos=1.0)), t1)
    _, closed = advance(7, o, st(2, para(1, "a", pos=0.5, rule=Rule.MOVED)), t2)
    assert len(closed) == 1
def test_removal_closes_and_restore_reopens_same_para_id():
    o, _ = advance(7, {}, st(1, para(1, "a"), para(2, "b")), t1)
    o, closed = advance(7, o, st(2, para(1, "a")), t2)
    assert [c.para_id for c in closed] == [2] and 2 not in o
    o, closed = advance(7, o, st(3, para(1, "a"), para(2, "b", rule=Rule.RESTORED)), t3)
    assert closed == [] and o[2].row_start == t3
def test_carry_forward_state_changes_nothing():
    o, _ = advance(7, {}, st(1, para(1, "a")), t1)
    o2, closed = advance(7, o, PageState(2, (para(1, "a"),), text_missing=True), t2)
    assert closed == [] and o2[1].rev_id == 1
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/pytest backend/tests/test_history_rows.py -v`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `assign_valid_from` and `advance`**

A paragraph's open row continues while its `(hash, pos)` is unchanged. Any change closes it at `valid_from` and opens a new row carrying the rule, similarity and `rev_id` of the state that opened it. `advance` returns a new mapping and never alters the one passed in.

- [ ] **Step 4: Run to see them pass**

Run: `.venv/bin/pytest backend/tests/test_history_rows.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: valid-from times and versioned paragraph rows"
```

---

### Task 5: Ingest, the fixture article, and the round trip

**Files:**
- Create: `backend/wikilens/parquet_source.py`, `backend/wikilens/ingest.py`, `backend/wikilens/fixture.py`, `backend/wikilens/tier1.tsv`, `backend/tests/test_ingest_roundtrip.py`
- Modify: `backend/wikilens/queries.py` (add `wordings_by_hash`)

**Interfaces:**
- Consumes: `clean`, `match_revision`, `carry_forward`, `Memory`, `assign_valid_from`, `advance`, `frame_at`, `db.enable_history_insert`.
- Produces:

```python
# parquet_source.py
@dataclass(frozen=True)
class RawRevision:
    page_id: int; title: str; rev_id: int; parent_id: int | None; timestamp: datetime
    user: str | None; anonymous: bool; comment: str | None; minor: bool; sha1: str | None; bytes: int; text: str
M_BASE_URL = "https://github.com/MariaDB/mariadb-wikipedia-datasets/releases/download/m-2026-10/"
def download_m(dest: Path) -> list[Path]      # versions-01…16.parquet, verified against SHA256SUMS; skips verified files; raises ChecksumError
def iter_pages(files: Sequence[Path], page_ids: Collection[int] | None = None) -> Iterator[list[RawRevision]]   # one article per item, oldest first
def tier1_page_ids() -> list[int]             # from tier1.tsv, copied from the starter's data/articles.tsv

# ingest.py
@dataclass(frozen=True)
class PageReport: page_id: int; title: str; revisions: int; paragraph_rows: int; wordings: int; text_missing: int; seconds: float
class AlreadyLoaded(Exception): ...
class RoundTripError(Exception): ...          # carries rev_id, expected, got
def ingest_page(con, revisions: Sequence[RawRevision], tier: int) -> PageReport   # one transaction
def verify_page(con, revisions: Sequence[RawRevision], every: int = 25) -> int   # first, last and every Nth; returns how many were checked
# CLI: python -m wikilens.ingest (--pages 1256,440 | --tier1 | --all) [--reset] [--workers 8] [--verify-every 25]

# queries.py
def wordings_by_hash(con, hashes: Sequence[bytes]) -> dict[bytes, tuple[str, str]]   # hash -> (kind, text)

# fixture.py
FIXTURE_PAGE_ID = 1; FIXTURE_TITLE = "Testisota"
def fixture_revisions() -> list[RawRevision]
def load_fixture(con) -> None                 # apply_schema, then ingest_page(con, fixture_revisions(), tier=1)
# CLI: python -m wikilens.fixture --db wikilens_e2e   (also embeds with StubEmbedder once Task 7 exists)
```

**The fixture script.** `sha1` is `hashlib.sha1(text.encode()).hexdigest()[:31]`; `bytes` is the UTF-8 length unless stated. Lines are joined with `\n`.

| rev | timestamp (UTC) | text |
|---|---|---|
| 101 | 2010-03-01 00:00:00 | `== Tausta ==` / `Talvisota alkoi marraskuussa 1939, kun Neuvostoliitto hyökkäsi Suomeen.` / `Toinen kappale pysyy.` |
| 102 | 2011-01-01 00:00:00 | the first paragraph becomes `Talvisota alkoi 30. marraskuuta 1939, kun Neuvostoliitto hyökkäsi Suomeen.` |
| 103 | 2012-01-01 10:00:00 | the first paragraph becomes `Talvisota alkoi 30. marraskuuta 1939, kun Neuvostoliitto hyökkäsi Suomeen lol.` |
| 104 | 2012-01-01 10:07:00 | exactly the text of 102 |
| 105 | 2013-01-01 00:00:00 | text of 102 without the first paragraph |
| 106 | 2014-01-01 00:00:00 | text of 102 plus a last line `Kolmas kappale tulee.` |
| 107 | 2015-01-01 00:00:00 | the first paragraph becomes `Talvisota alkoi 30. marraskuuta 1939, kun Neuvostoliitto hyökkäsi Suomeen ilman sodanjulistusta.` |
| 108 | 2016-01-01 00:00:00 | the second paragraph becomes `Toinen kappale muuttuu.` |
| 109 | 2016-01-01 00:00:00 | the second paragraph becomes `Toinen kappale muuttuu taas.` |
| 110 | 2017-01-01 00:00:00 | empty text, `bytes = 500` |

The heading is a block too, so the identities are: heading 1, first paragraph 2, second paragraph 3, third paragraph 4. "The tracked paragraph" in later tasks is the first paragraph. Its life: first appears (2010-03-01), text changed (2011), replaced and reverted after 7 min (2012-01-01 10:00), restored unchanged (10:07), removed (2013), restored unchanged (2014), text changed (2015).

- [ ] **Step 1: Write the failing tests**

```python
def texts(con, t):
    blocks = frame_at(con, 1, t).blocks
    w = wordings_by_hash(con, [b.hash for b in blocks])
    return [w[b.hash] for b in blocks]
def valid_from(con, rev_id): ...   # SELECT valid_from FROM revision WHERE rev_id = %s

def test_round_trip_every_revision(con):
    load_fixture(con)
    for rev in fixture_revisions():
        if rev.text == "": continue
        assert texts(con, valid_from(con, rev.rev_id)) == [(b.kind, b.text) for b in clean(rev.text)], rev.rev_id
def test_before_first_revision_is_empty(con):
    load_fixture(con); assert texts(con, datetime(2009, 1, 1)) == []
def test_same_second_revisions_ordered_by_rev_id(con):
    load_fixture(con); t = datetime(2016, 1, 1)
    assert ("p", "Toinen kappale muuttuu.") in texts(con, t)
    assert ("p", "Toinen kappale muuttuu taas.") in texts(con, t + timedelta(microseconds=1))
def test_original_timestamp_is_kept(con):
    load_fixture(con); cur = con.cursor(); cur.execute("SELECT ts, valid_from FROM revision WHERE rev_id = 109")
    assert cur.fetchone() == (datetime(2016, 1, 1), datetime(2016, 1, 1, 0, 0, 0, 1))
def test_missing_text_revision_carries_state_and_is_counted(con):
    load_fixture(con)
    assert texts(con, datetime(2017, 6, 1)) == texts(con, datetime(2016, 6, 1))
    # article.text_missing_revisions == 1 and article.revisions == 10
def test_ingest_twice_raises_already_loaded(con):
    load_fixture(con)
    with pytest.raises(AlreadyLoaded): ingest_page(con, fixture_revisions(), tier=1)
def test_failed_ingest_leaves_nothing_behind(con, monkeypatch):
    apply_schema(con)   # make advance raise on the 5th call; expect: no article row, no paragraph rows FOR SYSTEM_TIME ALL, no revision rows
def test_verify_page_counts_and_detects_corruption(con):
    load_fixture(con); assert verify_page(con, fixture_revisions(), every=1) == 9
    # then UPDATE one current paragraph row's hash to another wording and expect RoundTripError
def test_iter_pages_groups_by_article_oldest_first(tmp_path):
    # write a two-article Parquet file with pyarrow; iter_pages(files, {2}) yields only article 2, in timestamp order
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/pytest backend/tests/test_ingest_roundtrip.py -v`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `parquet_source.py`**

Read with `pyarrow.parquet.ParquetFile.iter_batches`; skip row groups whose `page_id` statistics exclude every wanted id; never hold more than one article's revisions.

- [ ] **Step 4: Implement `ingest.py` and `queries.wordings_by_hash`**

Per article, in one transaction with `enable_history_insert`: order revisions with `assign_valid_from`; for each, `clean` then `match_revision`, or `carry_forward` when `text == "" and bytes > 0`; fold with `advance`; write `revision` rows, `wording` rows with `INSERT IGNORE`, closed paragraph rows with explicit `row_start` and `row_end`, still-open rows with `row_start` only, and the `article` row last. Batch inserts by bytes (8 MB), as the starter's loader does. `--reset` calls `apply_schema`. `--workers` runs whole articles in separate processes, each with its own connection. `--all` skips articles already loaded.

- [ ] **Step 5: Implement `fixture.py`** from the table above.

- [ ] **Step 6: Run to see them pass**

Run: `.venv/bin/pytest backend/tests/test_ingest_roundtrip.py -v`
Expected: 9 passed.

- [ ] **Step 7: One real article**

Run: `.venv/bin/python -m wikilens.ingest --pages 1256 --verify-every 25`
Expected: downloads dataset M into `data/m/` (315 MB), prints a `PageReport` for Talvisota and `round trip ok: N revisions checked`. Add the report line and the elapsed time to `docs/measurements.md`. A `RoundTripError` here is a bug in the cleaner port, the matcher or the row builder: fix it before going on.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: ingest dataset M into versioned paragraphs with round-trip check"
```

---

### Task 6: The answer's timeline

**Files:**
- Create: `backend/wikilens/timeline.py`, `backend/tests/test_timeline.py`

**Interfaces:**
- Produces:

```python
LOOSE_BELOW = 0.65
@dataclass(frozen=True)
class HistoryRow: hash: bytes; rev_id: int; start: datetime; end: datetime | None; text: str; rule: int; similarity: float | None
@dataclass(frozen=True)
class Segment:
    kind: Literal["wording", "gap"]; start: datetime; end: datetime
    hash: bytes | None; text: str | None; rev_id: int | None
    label: str; tone: int; loose: bool; reverted: bool
def build_timeline(rows: Sequence[HistoryRow], corpus_end: datetime) -> list[Segment]
def format_duration(delta: timedelta) -> str
```

- [ ] **Step 1: Write the failing tests**

```python
D = datetime; END = D(2026, 10, 1, 23, 59, 59)
def row(h, start, end, sim=None, rule=4): return HistoryRow(bytes([h]) * 16, 100 + h, start, end, f"text{h}", rule, sim)
def labels(rows): return [s.label for s in build_timeline(rows, END)]

def test_single_row():
    (s,) = build_timeline([row(1, D(2010, 1, 1), None)], END)
    assert (s.label, s.end, s.tone, s.kind) == ("first appears", END, 0, "wording")
def test_text_changed_and_heavily_rewritten():
    rows = [row(1, D(2010,1,1), D(2011,1,1)), row(2, D(2011,1,1), D(2012,1,1), sim=0.65), row(3, D(2012,1,1), None, sim=0.55)]
    segs = build_timeline(rows, END)
    assert [s.label for s in segs] == ["first appears", "text changed", "heavily rewritten"] and [s.loose for s in segs] == [False, False, True]
def test_position_only_rows_merge():
    assert labels([row(1, D(2010,1,1), D(2011,1,1)), row(1, D(2011,1,1), None)]) == ["first appears"]
def test_gap_then_restored_unchanged():
    assert labels([row(1, D(2010,1,1), D(2011,1,1)), row(1, D(2012,1,1), None)]) == ["first appears", "removed", "restored unchanged"]
def test_gap_then_restored_reworded():
    assert labels([row(1, D(2010,1,1), D(2011,1,1)), row(2, D(2012,1,1), None)])[-1] == "restored, reworded"
def test_replaced_then_reverted():
    rows = [row(1, D(2011,1,1), D(2012,1,1,10,0)), row(9, D(2012,1,1,10,0), D(2012,1,1,10,7)), row(1, D(2012,1,1,10,7), None)]
    segs = build_timeline(rows, END)
    assert [s.label for s in segs] == ["first appears", "replaced, reverted after 7 min", "restored unchanged"]
    assert [s.reverted for s in segs] == [False, True, False] and segs[2].tone == segs[0].tone
def test_trailing_removal_runs_to_corpus_end():
    segs = build_timeline([row(1, D(2010,1,1), D(2011,1,1))], END)
    assert (segs[-1].kind, segs[-1].label, segs[-1].end) == ("gap", "removed", END)
def test_sub_millisecond_wording_is_dropped():
    t = D(2016, 1, 1)
    assert labels([row(1, D(2010,1,1), t), row(2, t, t + timedelta(microseconds=1)), row(3, t + timedelta(microseconds=1), None)]) == ["first appears", "text changed"]
def test_no_rows():          assert build_timeline([], END) == []
def test_format_duration():
    f = format_duration
    assert (f(timedelta(seconds=20)), f(timedelta(minutes=7)), f(timedelta(hours=5)), f(timedelta(days=12)), f(timedelta(days=1218))) == ("under a minute", "7 min", "5 h", "12 days", "3y 4m")
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/pytest backend/tests/test_timeline.py -v`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `build_timeline` and `format_duration`**

Merge touching rows with the same hash. Drop wording segments shorter than 1 ms, joining their neighbours so no hole is left. `tone` is the order in which each distinct hash first appeared, from 0; a gap has `tone = -1`. `loose` is `similarity is not None and similarity < LOOSE_BELOW`. A wording is `reverted` when the wordings directly before and after it (no gap between) share a hash. A wording whose hash appeared in an earlier segment is `restored unchanged`. Durations: under 60 s, under 60 min, under 48 h, under 60 days, else years and months of 30.44 days.

- [ ] **Step 4: Run to see them pass**

Run: `.venv/bin/pytest backend/tests/test_timeline.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: answer timeline with neutral labels"
```

---

### Task 7: Embeddings

**Files:**
- Create: `backend/wikilens/embedder.py`, `backend/wikilens/embed.py`, `backend/tests/test_embed.py`
- Modify: `backend/wikilens/fixture.py` (`load_fixture` embeds with `StubEmbedder`)

**Interfaces:**
- Produces:

```python
class EmbedderUnavailable(Exception): ...
class Embedder(Protocol):
    def embed(self, texts: Sequence[str]) -> list[list[float]]: ...
class OllamaEmbedder:   # POST {url}/api/embed  {"model", "input", "truncate": true, "options": {"num_ctx": 8192, "num_batch": 8192}}
    def __init__(self, url: str, model: str = "bge-m3", timeout: float = 120.0): ...
class StubEmbedder:     # 1024 dims; each word of re.findall(r"\w+", text.lower()) adds 1.0 at zlib.crc32(word) % 1024; L2-normalised; no words -> unit vector at index 0
DIMENSIONS = 1024; MIN_EMBED_CHARS = 40
def embed_missing(con, embedder: Embedder, page_ids: Sequence[int], batch_size: int = 32, min_chars: int = MIN_EMBED_CHARS) -> int
# embeds p and li wordings of those articles (all history) that have no vector yet, in the order of page_ids; returns vectors written
# CLI: python -m wikilens.embed (--pages … | --tier1)
```

- [ ] **Step 1: Write the failing tests**

```python
def test_only_paragraphs_and_list_items_of_min_length(con):
    load_fixture(con)   # with min_chars=20: no vector for the heading "Tausta"; a vector for every distinct p wording of 20+ characters
def test_rerun_embeds_nothing_new(con):
    load_fixture(con); assert embed_missing(con, StubEmbedder(), [1], min_chars=20) == 0
def test_wrong_dimension_is_rejected_before_any_insert(con):
    class Bad:  # embed returns [0.0, 1.0, 0.0] for each text
        ...
    load_fixture(con); cur = con.cursor(); cur.execute("DELETE FROM wording_vector"); con.commit()
    with pytest.raises(ValueError): embed_missing(con, Bad(), [1], min_chars=20)
    cur.execute("SELECT COUNT(*) FROM wording_vector"); assert cur.fetchone() == (0,)
def test_stub_is_deterministic_and_overlap_ranks_closer():
    e = StubEmbedder(); q, a, b = e.embed(["sota alkoi 1939", "Talvisota alkoi 1939", "Toinen kappale"])
    assert e.embed(["x y"]) == e.embed(["x y"]) and cos(q, a) > cos(q, b) and len(q) == 1024
def test_ollama_unreachable_raises():
    with pytest.raises(EmbedderUnavailable): OllamaEmbedder("http://127.0.0.1:9", timeout=1).embed(["a"])
```

`load_fixture` calls `embed_missing(con, StubEmbedder(), [1], min_chars=20)`.

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/pytest backend/tests/test_embed.py -v`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `embedder.py` and `embed.py`**

Commit after each batch so a stopped run resumes. Check every vector's length against `DIMENSIONS` before inserting.

- [ ] **Step 4: Run to see them pass**

Run: `.venv/bin/pytest backend/tests/test_embed.py -v`
Expected: 5 passed.

- [ ] **Step 5: Real embeddings for one article**

Run: `brew install ollama && (ollama serve &) && ollama pull bge-m3 && .venv/bin/python -m wikilens.embed --pages 1256`
Expected: prints vectors written and passages per second. Record both in `docs/measurements.md`. If the rate is below 20 per second, tier 1 is embedded reviewed-story articles first (Task 14).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: embed distinct wordings with bge-m3"
```

---

### Task 8: Queries and the API

**Files:**
- Create: `backend/wikilens/schemas.py`, `backend/wikilens/api.py`, `backend/wikilens/stories.json` (content `[]`), `backend/tests/test_api.py`
- Modify: `backend/wikilens/queries.py`

**Interfaces:**
- Consumes: `frame_at`, `rank_paragraphs`, `wordings_by_hash`, `build_timeline`, `HistoryRow`, `Embedder`, `EmbedderUnavailable`, `Settings`.
- Produces:

```python
# queries.py
def paragraph_history(con, page_id: int, para_id: int) -> list[HistoryRow]
def keyword_paragraphs(con, page_id: int, question: str, limit: int = 3) -> list[int]      # FULLTEXT over every wording the article had
def has_vectors(con, page_id: int) -> bool
def article_overview(con, page_id: int) -> Overview | None   # title, first_ts, last_ts, bars [(month "YYYY-MM", edits)], churn {para_id: distinct wordings}
def list_articles(con) -> list[ArticleRow]
def coverage(con) -> Coverage    # articles, revisions, paragraph_versions, wordings, vectors, database_bytes, mariadb_version

# api.py
WEAK_DISTANCE = 0.55; MAX_QUESTION_CHARS = 300; MAX_HASHES = 200
def create_app(settings: Settings, embedder: Embedder, connect: Callable[[], Connection] | None = None) -> FastAPI
# python -m wikilens.api  -> uvicorn on 127.0.0.1:8000; WIKILENS_EMBEDDER=stub selects StubEmbedder; serves web/dist at / when present
```

All JSON keys are camelCase; all times are epoch milliseconds; hashes are 32 hex characters.

| Method and path | `data` |
|---|---|
| `GET /api/articles` | `[{pageId, title, revisions, firstTs, lastTs, tier, reviewed, questions: [{fi, en}]}]`, reviewed first, then by title |
| `GET /api/articles/{pageId}/overview` | `{pageId, title, firstTs, lastTs, corpusEnd, bars: [{month, edits}], churn: {paraId: n}, hasVectors}` |
| `GET /api/articles/{pageId}/at?t=` | `{t, blocks: [{paraId, hash, revId}], sql, dbMs}` |
| `GET /api/wordings?hashes=a,b` | `{hash: {kind, text}}` |
| `POST /api/articles/{pageId}/ask` `{question}` | `{mode: "vector" \| "keyword", matches: [{paraId, distance, weak, preview}], timeline: [Segment], embedMs, rankMs, sql}` |
| `GET /api/articles/{pageId}/paragraphs/{paraId}/timeline` | `[Segment]` |
| `GET /api/coverage` | `{articles, revisions, paragraphVersions, wordings, vectors, databaseBytes, mariadbVersion, corpusEnd}` |
| `GET /api/health` | `{database, embedder}` |

`Segment` in JSON: `{kind, start, end, hash, text, revId, label, tone, loose, reverted}`. `preview` is the first 140 characters of the paragraph's latest wording. In keyword mode `distance` is `null` and `weak` is `false`. Status codes: 400 invalid input, 404 unknown article or paragraph, 503 `embedding service unavailable` or `database unavailable`.

- [ ] **Step 1: Write the failing tests** (FastAPI `TestClient`, fixture database, `StubEmbedder`)

```python
def ms(*a): return int(datetime(*a, tzinfo=timezone.utc).timestamp() * 1000)
def ok(r): body = r.json(); assert r.status_code == 200 and body["success"] is True and body["error"] is None; return body["data"]
def bad(r, status): body = r.json(); assert r.status_code == status and body["success"] is False and body["data"] is None and body["error"]

def test_articles_envelope(client):         assert ok(client.get("/api/articles"))[0]["pageId"] == 1
def test_frame_is_a_live_as_of_query(client):
    d = ok(client.get(f"/api/articles/1/at?t={ms(2011, 6, 1)}"))
    assert len(d["blocks"]) == 3 and "FOR SYSTEM_TIME AS OF" in d["sql"] and d["dbMs"] >= 0
def test_frame_after_corpus_end_400(client): bad(client.get(f"/api/articles/1/at?t={ms(2027, 1, 1)}"), 400)
def test_frame_non_numeric_time_400(client): bad(client.get("/api/articles/1/at?t=yesterday"), 400)
def test_unknown_article_404(client):        bad(client.get("/api/articles/999/overview"), 404)
def test_overview(client):
    d = ok(client.get("/api/articles/1/overview"))
    assert d["title"] == "Testisota" and d["bars"][0] == {"month": "2010-03", "edits": 1} and d["hasVectors"] is True and max(d["churn"].values()) == 4
def test_ask_returns_the_tracked_paragraph_and_its_life(client):
    d = ok(client.post("/api/articles/1/ask", json={"question": "Milloin sota alkoi 1939"}))
    assert d["mode"] == "vector" and d["matches"][0]["weak"] is False
    assert [s["label"] for s in d["timeline"]] == ["first appears", "text changed", "replaced, reverted after 7 min",
            "restored unchanged", "removed", "restored unchanged", "text changed"]
    assert d["timeline"][-1]["end"] == ms(2026, 10, 1, 23, 59, 59)
def test_ask_finds_a_wording_that_no_longer_exists(client):
    d = ok(client.post("/api/articles/1/ask", json={"question": "lol"}))
    assert "lol" in d["timeline"][2]["text"]
def test_weak_match_is_flagged(client):
    assert ok(client.post("/api/articles/1/ask", json={"question": "xyzzy"}))["matches"][0]["weak"] is True
def test_blank_question_400(client, spy_embedder):
    for q in ["", "   ", "?!."]: bad(client.post("/api/articles/1/ask", json={"question": q}), 400)
    assert spy_embedder.calls == 0
def test_question_over_300_chars_400(client, spy_embedder):
    bad(client.post("/api/articles/1/ask", json={"question": "a" * 301}), 400); assert spy_embedder.calls == 0
def test_embedder_down_503_and_frames_still_work(client_with_dead_embedder):
    bad(client_with_dead_embedder.post("/api/articles/1/ask", json={"question": "sota"}), 503)
    ok(client_with_dead_embedder.get(f"/api/articles/1/at?t={ms(2011, 6, 1)}"))
def test_without_vectors_ask_uses_keyword_mode(client, con):
    # DELETE FROM wording_vector; commit
    assert ok(client.post("/api/articles/1/ask", json={"question": "marraskuuta"}))["mode"] == "keyword"
def test_paragraph_timeline_and_404(client): # the tracked paragraph returns 7 segments; an unknown paragraph id is 404
def test_wordings_validation(client):
    bad(client.get("/api/wordings?hashes=zz"), 400); bad(client.get("/api/wordings?hashes=" + ",".join(["0" * 32] * 201)), 400)
def test_markup_in_wording_is_returned_verbatim(client, con):
    # insert a wording whose text is '<script>alert(1)</script>' and request it
    # expect the identical string and a content-type of application/json
def test_database_down_503(client_with_dead_db):  bad(client_with_dead_db.get("/api/articles"), 503)
def test_coverage_counts(client):            assert ok(client.get("/api/coverage"))["articles"] == 1 and ok(client.get("/api/coverage"))["revisions"] == 10
def test_error_does_not_leak_exception_text(client_with_dead_db): # body contains neither "pymysql" nor "Traceback"
```

- [ ] **Step 2: Run to see them fail**

Run: `.venv/bin/pytest backend/tests/test_api.py -v`
Expected: FAIL, `wikilens.api` not found.

- [ ] **Step 3: Implement the remaining `queries.py` functions**

`bars` counts revisions per calendar month of `revision.ts`. `churn` is `COUNT(DISTINCT hash)` per `para_id` over `FOR SYSTEM_TIME ALL`.

- [ ] **Step 4: Implement `schemas.py` and `api.py`**

A question is valid when, after trimming, it has 1 to 300 characters and at least one letter or digit. One exception handler per failure class builds the envelope. `reviewed` and `questions` come from `stories.json`, keyed by `page_id`. `/ask` times embedding and ranking separately.

- [ ] **Step 5: Run to see them pass**

Run: `.venv/bin/pytest backend/tests -v`
Expected: all pass; coverage of `wikilens` at or above 80%.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: API for frames, wordings, overview and ask"
```

---

### Task 9: Real stories

**Files:**
- Create: `backend/wikilens/stories.py`, `backend/tests/test_stories.py`, `docs/stories.md`
- Modify: `backend/wikilens/stories.json`

**Interfaces:**
- Produces:

```python
@dataclass(frozen=True)
class Candidate: para_id: int; wordings: int; reverted: int; gaps: int; first: datetime; last: datetime; latest_text: str
def find_candidates(con, page_id: int, corpus_end: datetime, top: int = 10, min_chars: int = 200) -> list[Candidate]
# paragraphs of kind p, scored wordings + 3 * reverted + 3 * gaps, best first
# CLI: python -m wikilens.stories --pages 1256,1150   -> a Markdown table per article, each wording linked to https://fi.wikipedia.org/?oldid=<rev_id>
```

`stories.json` entries: `{"page_id": 1256, "questions": [{"fi": "…", "en": "…"}]}`.

- [ ] **Step 1: Write the failing test**

```python
def test_fixture_top_candidate_is_the_edited_paragraph(con):
    load_fixture(con)
    c = find_candidates(con, 1, END, min_chars=0)[0]
    assert (c.wordings, c.reverted, c.gaps) == (4, 1, 1) and "ilman sodanjulistusta" in c.latest_text
```

- [ ] **Step 2: Run to see it fail**, then **implement** `find_candidates` on top of `paragraph_history` and `build_timeline`, then **run to see it pass**

Run: `.venv/bin/pytest backend/tests/test_stories.py -v`
Expected: FAIL (module not found), then 1 passed.

- [ ] **Step 3: Load five articles**

Run: `.venv/bin/python -m wikilens.ingest --pages 1150,11477,1275,5261 --workers 4 --verify-every 25 && .venv/bin/python -m wikilens.embed --pages 1256,1150,11477,1275,5261`
Expected: four more `PageReport` lines, each with `round trip ok`. (Talvisota, Suomen sisällissota, Lapuanliike, Urho Kekkonen, Suomettuminen.)

- [ ] **Step 4: Read the candidates and write `docs/stories.md`**

Run: `.venv/bin/python -m wikilens.stories --pages 1256,1150,11477,1275,5261`

For each promising candidate, read its wordings in Finnish and write: article, paragraph id, a question in Finnish and English, a three to six line English summary of how the answer changed, the revision links, and any place where the matcher linked or split paragraphs wrongly. Ask each question through `POST /api/articles/{id}/ask` in both languages and record whether the top match is the intended paragraph and its distance.

Expected: at least three stories whose history is true as read, including one revert and one gap, each found by both the Finnish and the English question.

- [ ] **Step 5: Tune from what was read**

Adjust `WEAK_DISTANCE`, `LOOSE_BELOW`, and if needed `EDIT_THRESHOLD` and `RESTORE_THRESHOLD`, so the stories read correctly. A change to a matcher constant or the cleaner needs `--reset` and a reload of the five articles. Record the final values and the reason in `docs/stories.md`.

- [ ] **Step 6: Owner's decision**

Give the owner the English summaries. The owner chooses which stories lead; write those into `stories.json`. If fewer than three stories hold up, stop and tell the owner before building the screen: the picker will be restricted to reviewed articles and the cut order applies.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: candidate stories and reviewed example questions"
```

---

### Task 10: Browser logic

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/types.ts`, `web/src/time.ts`, `web/src/diff.ts`, `web/src/wordingCache.ts`, `web/src/api.ts`, `web/tests/time.test.ts`, `web/tests/diff.test.ts`, `web/tests/wordingCache.test.ts`, `web/tests/api.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts — mirrors Task 8's JSON exactly
export type TimeRange = { first: number; end: number };
export type FrameBlock = { paraId: number; hash: string; revId: number };
export type Frame = { t: number; blocks: FrameBlock[]; sql: string; dbMs: number };
export type Segment = { kind: 'wording' | 'gap'; start: number; end: number; hash: string | null; text: string | null;
                        revId: number | null; label: string; tone: number; loose: boolean; reverted: boolean };
export type Match = { paraId: number; distance: number | null; weak: boolean; preview: string };
export type AskResult = { mode: 'vector' | 'keyword'; matches: Match[]; timeline: Segment[]; embedMs: number; rankMs: number; sql: string };
export type Wording = { kind: 'p' | 'li' | 'h'; text: string };
export type Overview = { pageId: number; title: string; firstTs: number; lastTs: number; corpusEnd: number;
                         bars: { month: string; edits: number }[]; churn: Record<string, number>; hasVectors: boolean };
export type Article = { pageId: number; title: string; revisions: number; firstTs: number; lastTs: number; tier: number;
                        reviewed: boolean; questions: { fi: string; en: string }[] };
export type Coverage = { articles: number; revisions: number; paragraphVersions: number; wordings: number; vectors: number;
                         databaseBytes: number; mariadbVersion: string; corpusEnd: number };

// time.ts
export const SNAP_RADIUS_PX = 8;
export function clampTime(t: number, range: TimeRange): number;
export function timeToX(t: number, range: TimeRange, width: number): number;
export function xToTime(x: number, range: TimeRange, width: number): number;
export function snapTime(x: number, changes: number[], range: TimeRange, width: number): number;
export function segmentIndexAt(segments: Segment[], t: number): number;       // -1 before the first
export function stepChange(segments: Segment[], t: number, dir: 1 | -1): number;
export function formatSpan(ms: number): string;
export function formatDate(t: number): string;                                 // "8 Apr 2013", UTC
export function churnLevel(wordings: number): 1 | 2 | 3 | 4 | 5;

// diff.ts
export type Op = { type: 'eq' | 'ins' | 'del'; token: string };
export function tokenize(text: string): string[];
export function diffWords(a: string[], b: string[]): Op[];
export function needsSpaceBefore(token: string, isFirst: boolean): boolean;

// wordingCache.ts
export function createWordingCache(): { get(hash: string): Wording | undefined; missing(hashes: string[]): string[]; put(entries: Record<string, Wording>): void };

// api.ts
export class ApiError extends Error { status: number }
export function createApi(fetchImpl?: typeof fetch): {
  articles(): Promise<Article[]>; overview(pageId: number): Promise<Overview>;
  frame(pageId: number, t: number, signal?: AbortSignal): Promise<Frame>;
  wordings(hashes: string[]): Promise<Record<string, Wording>>;
  ask(pageId: number, question: string): Promise<AskResult>;
  paragraphTimeline(pageId: number, paraId: number): Promise<Segment[]>;
  coverage(): Promise<Coverage> };
```

- [ ] **Step 1: Scaffold**

`package.json` scripts: `dev`, `build`, `test` (`vitest run --coverage`), `e2e` (`playwright test`). Dev dependencies: `vite`, `typescript`, `vitest`, `@vitest/coverage-v8`, `@playwright/test`. Dependencies: `@fontsource/instrument-serif`, `@fontsource-variable/newsreader`, `@fontsource/jetbrains-mono`. `vite.config.ts` proxies `/api` to `http://127.0.0.1:8000` and sets coverage thresholds of 80% for `src/time.ts`, `src/diff.ts`, `src/wordingCache.ts`, `src/api.ts`, `src/scrub.ts`.

Run: `cd web && pnpm install`
Expected: installs.

- [ ] **Step 2: Write the failing tests**

```ts
// time.test.ts
const range = { first: Date.UTC(2004, 0, 1), end: Date.UTC(2026, 9, 1, 23, 59, 59) };
const at = (x: number) => xToTime(x, range, 1000);
const seg = (start: number, end: number): Segment => ({ kind: 'wording', start, end, hash: 'h', text: 't', revId: 1, label: '', tone: 0, loose: false, reverted: false });
const segs = [seg(at(100), at(300)), seg(at(300), at(600)), seg(at(600), range.end)];
expect(at(0)).toBe(range.first); expect(at(1000)).toBe(range.end);
expect(timeToX(at(250), range, 1000)).toBeCloseTo(250, 6);
expect(clampTime(range.end + 1, range)).toBe(range.end); expect(clampTime(range.first - 1, range)).toBe(range.first);
expect(snapTime(503, [at(500)], range, 1000)).toBe(at(500));
expect(snapTime(509, [at(500)], range, 1000)).toBe(at(509));
expect(snapTime(500, [at(500), at(500) + 1], range, 1000)).toBe(at(500));      // the earlier change wins a tie
expect(segmentIndexAt(segs, at(300))).toBe(1); expect(segmentIndexAt(segs, at(300) - 1)).toBe(0); expect(segmentIndexAt(segs, at(99))).toBe(-1);
expect(stepChange(segs, at(350), 1)).toBe(at(600)); expect(stepChange(segs, at(350), -1)).toBe(at(300));
expect(stepChange(segs, at(300), -1)).toBe(at(100)); expect(stepChange(segs, at(700), 1)).toBe(at(700));
expect(formatSpan(7 * 60_000)).toBe('7 min'); expect(formatSpan(12 * 864e5)).toBe('12 days'); expect(formatSpan(1218 * 864e5)).toBe('3y 4m');
expect(formatDate(Date.UTC(2013, 3, 8))).toBe('8 Apr 2013');
expect([1, 2, 4, 8, 16, 400].map(churnLevel)).toEqual([1, 2, 3, 4, 5, 5]);

// diff.test.ts
expect(tokenize('Sota alkoi 30. marraskuuta 1939, kun')).toEqual(['Sota', 'alkoi', '30', '.', 'marraskuuta', '1939', ',', 'kun']);
expect(tokenize('Jääkäriliike sai Ryti–Ribbentrop-sopimuksen')).toEqual(['Jääkäriliike', 'sai', 'Ryti–Ribbentrop-sopimuksen']);
expect(tokenize('')).toEqual([]);
expect(diffWords(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([{ type: 'eq', token: 'a' }, { type: 'del', token: 'b' }, { type: 'ins', token: 'x' }, { type: 'eq', token: 'c' }]);
expect(diffWords([], ['a'])).toEqual([{ type: 'ins', token: 'a' }]); expect(diffWords(['a'], [])).toEqual([{ type: 'del', token: 'a' }]);
expect(needsSpaceBefore(',', false)).toBe(false); expect(needsSpaceBefore('kun', false)).toBe(true); expect(needsSpaceBefore('kun', true)).toBe(false);

// wordingCache.test.ts: missing() returns only unknown hashes, without duplicates; put() then get() returns the entry
// api.test.ts (fake fetch): unwraps data on success; throws ApiError with status and the envelope's error on success:false;
//   throws ApiError on a non-JSON body; frame() passes the AbortSignal through; wordings([]) resolves {} without a request
```

- [ ] **Step 3: Run to see them fail**

Run: `cd web && pnpm test`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the five modules**

`tokenize` uses `/[\p{L}\p{N}’'–-]+|[^\s\p{L}\p{N}]/gu`. `diffWords` is a longest-common-subsequence diff that emits deletions before insertions within a change.

- [ ] **Step 5: Run to see them pass**

Run: `cd web && pnpm test`
Expected: all pass; the four implemented modules at or above 80%.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: browser time, diff, cache and API modules"
```

---

### Task 11: Scrub controller

**Files:**
- Create: `web/src/scrub.ts`, `web/tests/scrub.test.ts`

**Interfaces:**
- Consumes: `Frame`, `Segment`, `TimeRange`, `clampTime`.
- Produces:

```ts
export const PLAY_DURATION_MS = 13000; export const DWELL_MS = 1100; export const DWELL_REVERTED_MS = 1700;
export type ScrubDeps = {
  fetchFrame: (pageId: number, t: number, signal: AbortSignal) => Promise<Frame>;
  onTime: (t: number) => void;               // called synchronously on every seek and play tick
  onFrame: (frame: Frame) => void;
  onError: (error: Error | null) => void;    // null when a request succeeds after a failure
  requestFrame?: (cb: (now: number) => void) => number; cancelFrame?: (id: number) => void };
export type Scrubber = { open(pageId: number, range: TimeRange): void; seek(t: number): void;
  play(segments: Segment[]): void; pause(): void; readonly playing: boolean; readonly time: number; dispose(): void };
export function createScrubber(deps: ScrubDeps): Scrubber;
```

- [ ] **Step 1: Write the failing tests** (deferred promises for `fetchFrame`, a hand-driven `requestFrame`)

```ts
it('calls onTime synchronously on seek, clamped to the range')
it('keeps one request in flight and remembers only the newest pending time', async () => {
  // open(1, range); seek(a); seek(b); seek(c)  -> fetchFrame called once, with a
  // resolve it                                  -> onFrame(a's frame); fetchFrame called a second time, with c; b is never requested
});
it('drops a response older than the newest delivered')
it('reports an error and clears it on the next success', async () => {
  // first fetch rejects -> onError called with the error; seek again and resolve -> onError called with null, onFrame called
});
it('keeps calling onTime while requests fail')
it('open() aborts the in-flight request and ignores its result')        // signal.aborted === true, onFrame not called
it('play advances with the clock and dwells on changes', () => {
  // range of 13 s scaled so 1 ms of clock = 1 unit of time; segments start at 2000 (plain) and 5000 (reverted)
  // tick to clock 2000 -> time 2000; ticks up to clock 3099 keep time 2000; tick at 3100 moves on
  // at 5000 the hold lasts 1700 ms
});
it('play stops at range.end and sets playing to false')
it('seek during play pauses it')
it('play from range.end restarts at range.first')
it('dispose cancels the animation frame and aborts the request')
```

- [ ] **Step 2: Run to see them fail**

Run: `cd web && pnpm test scrub`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `createScrubber`**

Play speed is `(range.end - range.first) / PLAY_DURATION_MS` per millisecond of clock. A play tick that would pass a segment start lands exactly on it and holds.

- [ ] **Step 4: Run to see them pass**

Run: `cd web && pnpm test`
Expected: all pass, `scrub.ts` at or above 80%.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: scrub controller with single-flight frame requests"
```

---

### Task 12: The screen before a question

**Files:**
- Create: `web/src/state.ts`, `web/src/main.ts`, `web/src/styles.css`, `web/src/views/page.ts`, `web/src/views/timeline.ts`, `web/src/views/minimap.ts`, `web/src/views/sqlPanel.ts`, `web/src/views/picker.ts`, `web/playwright.config.ts`, `web/e2e/landing.spec.ts`
- Reference: `.superpowers/brainstorm/4395-1794622700/content/scrub-variants-v2.html` (view 2) for layout, colours and type

**Interfaces:**
- Consumes: everything from Tasks 10 and 11.
- Produces: each view is `mountX(root: HTMLElement, handlers) => { update(model): void }`.
  - `mountPage(root)`: `update({ frame, cache, churn, answerParaId })`. Paragraph elements are `[data-para-id]` with class `para`, plus `kind-p|kind-li|kind-h`, and `churn-1…churn-5` when no question is active. Empty state element `.page-empty`.
  - `mountTimeline(root, { onSeek })`: `update({ range, bars, segments, time })`. Elements: `.bar` per month, `.playhead`, `.year-label`.
  - `mountMinimap(root)`: one `.mm-block` per block, same churn classes.
  - `mountSqlPanel(root)`: `update({ sql, dbMs, count })`; elements `.sql-text`, `.sql-ms`, `.sql-count`; a toggle that collapses it.
  - `mountPicker(root, { onArticle })`: reviewed articles first, the rest under the heading `automatic matching, not reviewed`.
  - `state.ts`: `type AppState`, `initialState`, and `reduce(state, action) => AppState` returning a new object each time.
  - Other elements: `.now-date`, `.big-year`, `.error-line`, `.credit`.

- [ ] **Step 1: Playwright setup**

`playwright.config.ts` starts two servers: `WIKILENS_DB_NAME=wikilens_e2e WIKILENS_EMBEDDER=stub ../.venv/bin/python -m wikilens.api` (after `../.venv/bin/python -m wikilens.fixture --db wikilens_e2e`) and `pnpm dev`; base URL `http://127.0.0.1:5173`.

- [ ] **Step 2: Write the failing end-to-end tests** in `web/e2e/landing.spec.ts`

```ts
test('opens the fixture article at the corpus end, tinted by churn', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Testisota');
  await expect(page.locator('.para.kind-p')).toHaveCount(3);
  await expect(page.locator('.para.churn-3')).toContainText('ilman sodanjulistusta');   // four wordings -> level 3
  await expect(page.locator('.now-date')).toHaveText('1 Oct 2026');
});
test('clicking the timeline at 2010 shows the first wording and the query that fetched it', async ({ page }) => {
  // click the track at the x of mid-2010
  await expect(page.locator('.para.kind-p').first()).toContainText('alkoi marraskuussa 1939');
  await expect(page.locator('.sql-text')).toContainText("FOR SYSTEM_TIME AS OF TIMESTAMP '2010-");
  await expect(page.locator('.sql-ms')).toHaveText(/\d+(\.\d+)? ms/);
  await expect(page.locator('.big-year')).toHaveText('2010');
});
test('before the first revision the page says so', async ({ page }) => {
  // the range starts on 1 Jan 2010 and the first revision is 1 Mar 2010: click the track 2 px from its left edge
  await expect(page.locator('.page-empty')).toContainText('first revision'); await expect(page.locator('.para')).toHaveCount(0);
});
test('markup in article text is shown as text', async ({ page }) => {
  await page.route('**/api/wordings*', r => r.fulfill({ json: { success: true, error: null, meta: null,
    data: Object.fromEntries(/* every requested hash */ [].map(h => [h, { kind: 'p', text: '<img src=x onerror="window.__x=1">' }])) } }));
  // expect a paragraph whose text contains '<img src=x', and await page.evaluate(() => (window as any).__x) to be undefined
});
test('the page footer credits Wikipedia and says the text is simplified', async ({ page }) => {
  // '.credit' contains 'CC BY-SA 4.0', the word 'simplified', and a link to fi.wikipedia.org
});
test('a database error shows one plain line', async ({ page }) => {
  // route '**/api/articles/1/at*' to return 503 with the envelope; click the track; expect '.error-line' to contain 'database unavailable'
});
test('the picker lists reviewed articles before the rest', async ({ page }) => { /* with the fixture there is one article; expect it selected */ });
```

- [ ] **Step 3: Run to see them fail**

Run: `cd web && pnpm e2e landing`
Expected: FAIL, the page is blank.

- [ ] **Step 4: Build the views and wire them in `main.ts`**

- Article text is written with `textContent` only. `innerHTML` is not used with data from the API.
- Paragraph elements are reused across frames by `data-para-id`; a frame adds, removes, reorders and retexts, without animation.
- The range runs from 1 January (UTC) of the first revision's year to `overview.corpusEnd`, so there is a short lead-in where the article does not exist yet. The playhead starts at the end.
- `.credit` reads: text from Finnish Wikipedia, CC BY-SA 4.0, simplified (templates, tables and references are not shown), with a link to the article.
- Pointer handling on the track: `setPointerCapture`, then `snapTime` (with no segments yet, plain `xToTime`), then `scrubber.seek`.
- Space plays and pauses. The date readout uses `formatDate`.
- Missing wording texts for a frame are fetched once, by hash, in a single request; a paragraph whose text has not arrived yet keeps a fixed-height placeholder so the layout does not jump.
- Fonts come from the `@fontsource` packages. Colours and proportions are the prototype's CSS variables.

- [ ] **Step 5: Run to see them pass**

Run: `cd web && pnpm e2e landing`
Expected: 7 passed.

- [ ] **Step 6: Look at it with real data**

Run: `.venv/bin/python -m wikilens.api` and `cd web && pnpm dev`, open `http://127.0.0.1:5173`, choose Talvisota, drag the timeline end to end.
Expected: the article changes continuously with no visible wait, the SQL panel's timestamp follows the playhead, and nothing flashes or jumps. Fix what does before going on.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: article page, timeline and live frame scrubbing"
```

---

### Task 13: Ask, the answer morph, and the edge states

**Files:**
- Create: `web/src/views/morph.ts`, `web/src/views/answer.ts`, `web/e2e/hero.spec.ts`
- Modify: `web/src/views/timeline.ts`, `web/src/views/picker.ts`, `web/src/views/minimap.ts`, `web/src/state.ts`, `web/src/main.ts`, `web/src/styles.css`

**Interfaces:**
- Consumes: `tokenize`, `diffWords`, `needsSpaceBefore`, `segmentIndexAt`, `stepChange`, `snapTime`, `formatSpan`, `Scrubber.play`.
- Produces:
  - `mountMorph(el)`: `update(fromTokens: string[], toTokens: string[]): void`. Words are `span.w`; inserted ones also `.ins`, removed ones `.del` (removed after their exit animation).
  - `mountAnswer(page)`: `update({ segments, time, paraId })`. The tracked paragraph gets class `answer`, plus `ghost` in a gap, `reverted` on a reverted wording, `loose` on a loose one. Around it: `.answer-label`, `.answer-life`, `.answer-notice`, `.answer-link` (to `https://fi.wikipedia.org/?oldid=<revId>`).
  - Timeline additions: `.seg` per segment with `tone-<n>`, `.seg.gap`, `.seg.reverted`, `.tick` per change, hollow `.tick.loose`.
  - Picker additions: `input.question`, `.example-question` buttons from `Article.questions`, `.chip` per other match, `.ask-message`, `.mode-keyword` label.

- [ ] **Step 1: Write the failing end-to-end tests** in `web/e2e/hero.spec.ts`

```ts
const ask = async (page, q = 'Milloin sota alkoi 1939') => { await page.goto('/'); await page.fill('input.question', q); await page.keyboard.press('Enter'); };

test('asking highlights the answer in place with its band on the timeline', async ({ page }) => {
  await ask(page);
  await expect(page.locator('.answer')).toContainText('ilman sodanjulistusta');
  await expect(page.locator('.answer-label')).toHaveText('text changed');
  await expect(page.locator('.seg')).toHaveCount(7); await expect(page.locator('.seg.gap')).toHaveCount(1);
  await expect(page.locator('.seg.reverted')).toHaveCount(1);
  await expect(page.locator('.para[class*="churn-"]')).toHaveCount(0);                  // the tint gives way to the highlight
});
test('stepping back walks the answer through its life', async ({ page }) => {
  await ask(page);
  const step = () => page.keyboard.press('ArrowLeft');
  await step(); await expect(page.locator('.now-date')).toHaveText('1 Jan 2015');      // first press: the start of the current wording
  await step(); await expect(page.locator('.answer-label')).toHaveText('restored unchanged');
  await step(); await expect(page.locator('.answer.ghost')).toBeVisible(); await expect(page.locator('.answer-notice')).toContainText('removed');
  await step(); await expect(page.locator('.answer-label')).toHaveText('restored unchanged');
  await step(); await expect(page.locator('.answer.reverted')).toContainText('lol');
               await expect(page.locator('.answer-label')).toHaveText('replaced, reverted after 7 min');
  await step(); await expect(page.locator('.answer-label')).toHaveText('text changed');
  await step(); await expect(page.locator('.answer-label')).toHaveText('first appears');
               await expect(page.locator('.answer')).toContainText('alkoi marraskuussa 1939');
  await expect(page.locator('.sql-text')).toContainText("AS OF TIMESTAMP '2010-03-01");
});
test('the answer changes without waiting for the page around it', async ({ page }) => {
  await ask(page); await page.keyboard.press('ArrowLeft');
  await page.route('**/api/articles/1/at*', async r => { await new Promise(f => setTimeout(f, 2000)); await r.continue(); });
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.answer-label')).toHaveText('restored unchanged', { timeout: 300 });
});
test('a changed word is marked as inserted', async ({ page }) => {
  await ask(page); for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('.answer .w.ins')).toContainText(['30']);
});
test('before the answer was written the page says when it first appears', async ({ page }) => {
  await ask(page); await page.locator('.chip').nth(1).click();          // the third paragraph, added in 2014
  // click the track at the x of mid-2011
  await expect(page.locator('.answer')).toHaveCount(0); await expect(page.locator('.answer-notice')).toContainText('first appears');
});
test('blank question shows a message and sends nothing', async ({ page }) => {
  let asked = 0; await page.route('**/ask', r => { asked++; r.continue(); });
  await ask(page, '   '); await expect(page.locator('.ask-message')).toBeVisible(); expect(asked).toBe(0);
});
test('database failure mid-scrub keeps the answer moving and says so', async ({ page }) => {
  await ask(page); await page.keyboard.press('ArrowLeft'); await page.route('**/api/articles/1/at*', r => r.abort());
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.answer-label')).toHaveText('restored unchanged'); await expect(page.locator('.error-line')).toBeVisible();
  await page.unroute('**/api/articles/1/at*'); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.error-line')).toBeHidden();
});
test('a weak match is labelled', async ({ page }) => { await ask(page, 'xyzzy'); await expect(page.locator('.answer-notice')).toContainText('weak match'); });
test('an other-match chip switches the tracked paragraph', async ({ page }) => {
  await ask(page); await page.locator('.chip').first().click(); await expect(page.locator('.answer')).toContainText('Toinen kappale');
});
test('embedding service down disables asking but not scrubbing', async ({ page }) => {
  await page.route('**/ask', r => r.fulfill({ status: 503, json: { success: false, data: null, error: 'embedding service unavailable', meta: null } }));
  await ask(page); await expect(page.locator('.ask-message')).toContainText('unavailable');
  // click the track at 2010 and expect the first wording
});
test('play runs to the corpus end and stops', async ({ page }) => {
  await ask(page); for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.press(' ');
  await expect(page.locator('.now-date')).toHaveText('1 Oct 2026', { timeout: 30000 });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd web && pnpm e2e hero`
Expected: FAIL, `input.question` not found.

- [ ] **Step 3: Build the morph, the answer view, the band, and the question flow**

- The answer's wording at time `t` comes from `segments[segmentIndexAt(segments, t)]`, never from the network.
- A morph runs when the segment index changes: diff the tokens shown against the new tokens.
- In a gap, the last wording stays in place as a ghost at its last position, with the gap's dates in `.answer-notice`.
- Before the first segment: no highlight, and `.answer-notice` offers a jump to the first appearance.
- The answer paragraph is set larger than body text and is scrolled to the centre of the page whenever its position changes.
- With segments present, the track snaps with `snapTime` over segment starts, and left/right arrows use `stepChange`.
- Example questions fill the input and ask. Keyword mode shows `.mode-keyword`.
- Pressing Enter asks and moves keyboard focus to the timeline, so arrows and space drive the playhead. While the question input has focus, those keys type as usual.
- Left arrow goes to the start of the current wording first, then to earlier changes (`stepChange`).
- Client-side question check mirrors the server: 1 to 300 characters after trimming, at least one letter or digit.

- [ ] **Step 4: Run to see them pass**

Run: `cd web && pnpm e2e`
Expected: every test in `landing.spec.ts` and `hero.spec.ts` passes.

- [ ] **Step 5: Look at it with the real stories**

Open each story from `docs/stories.md`, ask its question in Finnish and English, press play.
Expected: the answer matches the summary in `docs/stories.md` at every step; the morph is readable at play speed; nothing waits. Adjust dwell times and type size by eye.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: ask a question and scrub the answer through time"
```

---

### Task 14: All of tier 1, measured, and packaged

**Files:**
- Create: `backend/wikilens/measure.py`, `backend/tests/test_measure.py`, `web/src/views/about.ts`, `README.md`, `docs/demo-script.md`, `scripts/demo.sh`, `scripts/check.sh`
- Modify: `docs/measurements.md`, `web/src/main.ts`, `web/e2e/landing.spec.ts`

**Interfaces:**
- Consumes: `coverage`, `frame_at`, `rank_paragraphs`, `Embedder`.
- Produces:

```python
@dataclass(frozen=True)
class Percentiles: p50: float; p95: float; samples: int
def measure_frames(con, samples: int = 200, seed: int = 1) -> Percentiles        # random (article, moment) pairs, milliseconds
def measure_asks(con, embedder: Embedder, questions: Sequence[tuple[int, str]]) -> tuple[Percentiles, Percentiles]   # embedding, ranking
def render_markdown(facts: Mapping[str, str], frames: Percentiles, embed: Percentiles, rank: Percentiles, cov: Coverage) -> str
# CLI: python -m wikilens.measure  -> rewrites the measured section of docs/measurements.md
```

`mountAbout(root)` shows the `/api/coverage` numbers in a panel with class `about`.

- [ ] **Step 1: Write the failing tests**

```python
def test_measure_frames_on_fixture(con):
    load_fixture(con); p = measure_frames(con, samples=20)
    assert p.samples == 20 and 0 <= p.p50 <= p.p95
def test_render_markdown_states_counts_and_hardware():
    # the text contains the article count, the vector count, 'p95' and the hardware string passed in
```

```ts
// landing.spec.ts
test('the about panel shows counts read from the database', async ({ page }) => {
  await page.goto('/'); await page.locator('.about-toggle').click();
  await expect(page.locator('.about')).toContainText('1 article'); await expect(page.locator('.about')).toContainText('10 revisions');
});
```

- [ ] **Step 2: Run to see them fail, implement, run to see them pass**

Run: `.venv/bin/pytest backend/tests/test_measure.py -v && cd web && pnpm e2e landing`
Expected: FAIL first, then all pass.

- [ ] **Step 3: Load tier 1**

Run: `.venv/bin/python -m wikilens.ingest --reset --tier1 --workers 8 --verify-every 25 && .venv/bin/python -m wikilens.embed --tier1 && df -h .`
Expected: 50 `PageReport` lines, each `round trip ok`; vectors written; more than 6 GB of disk still free. Reviewed-story articles are embedded first.

- [ ] **Step 4: Measure**

Run: `.venv/bin/python -m wikilens.measure`
Expected: `docs/measurements.md` now states the hardware, the MariaDB version and image digest, article, revision, paragraph-version, wording and vector counts, database size, frame query p50 and p95, ask embedding and ranking p50 and p95, ingest revisions per second and embedding passages per second.

- [ ] **Step 5: Package**

`README.md`: setup from an empty machine, what MariaDB does in this project, the measured numbers, the limits (simplified text, corpus cutoff, tier coverage, automatic matching), credits and licences. `docs/demo-script.md`: a three-minute script built on the chosen stories. `scripts/demo.sh`: starts the database, checks Ollama, builds the web app, serves everything from the API on port 8000. `scripts/check.sh`: pytest, vitest, Playwright.

Run: `scripts/check.sh && scripts/demo.sh`, then disconnect from the network and open `http://127.0.0.1:8000`
Expected: all checks pass; the hero flow works offline with the bundled fonts.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: tier 1 loaded and measured, demo packaged"
```

---

### Task 15 (if time allows): history for every article

**Files:**
- Modify: `web/src/views/picker.ts`, `web/e2e/hero.spec.ts`, `docs/measurements.md`, `README.md`

**Interfaces:**
- Consumes: `ingest --all` (Task 5), keyword mode (Task 8).

- [ ] **Step 1: Write the failing test**

```ts
test('an article without vectors asks by keyword and says so', async ({ page }) => {
  await page.route('**/api/articles/1/overview', /* pass through, but set data.hasVectors = false */);
  await page.route('**/ask', /* pass through, but set data.mode = "keyword" */);
  await ask(page, 'marraskuuta'); await expect(page.locator('.mode-keyword')).toHaveText('keyword match');
});
```

- [ ] **Step 2: Run to see it fail, add the label, run to see it pass**

Run: `cd web && pnpm e2e hero`
Expected: FAIL, then pass.

- [ ] **Step 3: Load the rest**

Run: `.venv/bin/python -m wikilens.ingest --all --workers 8 --verify-every 100`
Expected: articles beyond tier 1 load with `tier = 2`. Stop the run if free disk drops below 6 GB. Rerun `python -m wikilens.measure` and update the coverage numbers in `README.md`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: paragraph history for the wider corpus with keyword questions"
```

---

### Task 16 (stretch): ask without choosing an article

**Files:**
- Modify: `backend/wikilens/queries.py`, `backend/wikilens/api.py`, `backend/tests/test_api.py`, `web/src/views/picker.ts`, `web/src/main.ts`, `web/e2e/hero.spec.ts`

**Interfaces:**
- Produces: `queries.find_articles(con, vector: Sequence[float], limit: int = 5) -> list[tuple[int, str, float]]` (page_id, title, best distance), built on `nearest_wordings` with `limit = 50` joined to the paragraphs that hold those wordings at any time. `POST /api/ask` with `{question}` returns `[{pageId, title, distance}]`.

- [ ] **Step 1: Write the failing tests**

```python
def test_ask_across_articles_finds_the_fixture(client):
    d = ok(client.post("/api/ask", json={"question": "Milloin sota alkoi 1939"}))
    assert d[0]["pageId"] == 1 and d[0]["title"] == "Testisota"
def test_ask_across_articles_validates_question(client): bad(client.post("/api/ask", json={"question": " "}), 400)
```

```ts
test('asking with no article chosen offers articles, and choosing one opens it with the answer', async ({ page }) => {
  await page.goto('/?article='); await page.fill('input.question', 'Milloin sota alkoi 1939'); await page.keyboard.press('Enter');
  await page.locator('.article-result').first().click(); await expect(page.locator('.answer')).toBeVisible();
});
```

- [ ] **Step 2: Run to see them fail, implement, run to see them pass**

Run: `.venv/bin/pytest backend/tests/test_api.py -v && cd web && pnpm e2e hero`
Expected: FAIL, then all pass.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: ask across articles through the vector index"
```
