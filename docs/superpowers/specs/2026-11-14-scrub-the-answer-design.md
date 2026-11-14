# WikiLens: Scrub the Answer — design

**Date:** 14 November 2026
**Status:** Approved by the owner on 14 November 2026. Nothing is built yet.
**Source brief:** `~/Downloads/mariadb-junction-2026-challenge-guide.md` (MariaDB "Wikipedia Through Time" challenge, Junction 2026)

Throughout this document, **Decided** marks a choice the project owner made in conversation. **Call** marks a choice made by the designer that the owner has seen and not objected to, or has not yet seen. Calls are open to correction.

---

## 1. Intent

Build one hero feature for the MariaDB challenge, with the smoothest interaction we can manage, and make it the whole demo.

**The feature:** ask a question about a Wikipedia article once. The passage that answers it lights up inside the article. Drag a timeline and that passage rewrites itself in place, word by word, through twenty years of edits. Vandalism that lasted seven minutes shows as a blip. A passage that was removed and later restored shows as a gap.

**Why this and not the guide's recommendation.** The guide proposes a form (question, article, two dates) that returns a list of before/after diffs. That is correct but it needs three inputs before any payoff, and the payoff looks like the starter project, which already ships a date picker and a diff. The judging gives 20% each to MariaDB use, implementation, usefulness, design and demo, and originality, so the interaction has to carry the originality and the design scores. Scrubbing removes the date inputs entirely and makes MariaDB's time travel the thing the user's hand is moving.

**Who it is for.** A reader, student or journalist who wants to know how an article's answer to a specific question changed, without reading hundreds of revision diffs.

## 2. Goals

1. The hero flow works end to end on real data: choose an article, ask a question, see the answer in place, scrub or play through its history.
2. Every scrub frame is a real MariaDB `FOR SYSTEM_TIME AS OF` query. The query text and its measured time are visible on screen.
3. Paragraphs are stored as system-versioned rows carrying Wikipedia's real edit times, so MariaDB's versioning is the mechanism and not a storage detail.
4. Scrubbing never waits. No spinner appears while the playhead moves.
5. What the screen says is observable fact: original Finnish text, revision links, the corpus cutoff, and neutral labels.
6. Coverage and speed are reported from measurements, with the amount of data actually processed stated plainly.

## 3. Non-goals

- Generated answers, summaries, explanations or translations. No language model in the core beyond the embedding model.
- An English layer. **Decided:** Finnish source text is enough.
- Searching for changes across the whole corpus. One article at a time.
- Editor tooling: filters for number changes, citation tracking, revert analytics.
- Saved questions and change notifications.
- Reference and citation handling. The text cleaner drops references and templates; that is accepted.
- The S and L datasets, except as a stretch entry point (section 9).
- Accounts, deployment, mobile layout. The demo runs locally on a laptop.

## 4. Anti-goals

These would make the project a failure even if it technically works.

- A staged or hardcoded result presented as live.
- An SQL panel showing a query that did not actually run for that frame.
- A label that asserts intent or quality ("vandalism", "biased", "corrected"). Labels describe what is observable.
- Paragraph-matching mistakes shown as real edits. A wrong match looks like "removed, then added" and tells a false story. This covers every article the picker can reach, not only the rehearsed ones: unreviewed articles say so, and loose links are drawn as loose.
- A wait while scrubbing.
- Presenting the final imported revision as "today". The corpus ends on 1 October 2026.

## 5. Constraints

- **Time.** The event runs 13–15 November 2026 and this design was written early on the 14th. **Call:** roughly one day of build time, one person working with an AI assistant. The exact submission deadline and format are not confirmed.
- **Machine.** Apple M1 Pro, 32 GB RAM. Docker is limited to 8 GB RAM. About 24 GB of disk is free. No GPU service or model credits are assumed.
- **Data.** Dataset M: 862,076 revisions of 19,742 Finnish articles, raw wikitext, 16 Parquet files (315 MB) from the `m-2026-10` release of `MariaDB/mariadb-wikipedia-datasets`. It has no vectors.
- **Tools present.** Docker, Python 3.14, Node 24, pnpm, gh. **Not present:** Ollama, a MariaDB client, uv.
- **MariaDB.** The starter was tested on 12.2.2 and on `mariadb:lts` resolving to 12.3.3. Pin the image by digest.
- **Offline.** The demo must survive a dead network: fonts bundled, embedding model local.
- **Owner's standing engineering rules** apply to the build: tests written first, 80% coverage target, validation at boundaries, explicit error handling, small focused files, a consistent API response envelope, no mutation of shared state.
- **Scope of the testing rules for this build, approved with the design:** tests first and the coverage target apply in full to the Python logic and to pure browser logic (word diffing, timeline maths, snapping). Animation and page-update code get one end-to-end test of the hero flow and no coverage target.
- **Licences.** Wikipedia text is CC BY-SA 4.0 and must be credited with links. Starter code is MIT; copied code keeps its notice.

## 6. Approaches considered

### A. Paragraphs as versioned rows — **Decided**

Ingest splits every revision into paragraphs and matches each one to the previous revision. Each paragraph becomes one row in a system-versioned table; each edit becomes a history row stamped with the real Wikipedia time. Each distinct wording is stored and embedded once.

- A scrub frame is one `AS OF` query returning the page at that moment.
- The answer's timeline is one query over that paragraph's history.
- The question ranks every wording the article ever had, so an answer that was later deleted is still found.
- Cost: matching paragraphs across revisions is the hard part, and articles need preprocessing before they work.
- Side benefit: only changed paragraphs are stored, not every full revision.

### B. Whole-article versions, computed on open — rejected

Load revisions as the starter does, one row per article with full text history. When an article opens, pull all versions and split, match and embed on the spot.

- Any article works without preprocessing, and it reaches a first screen fastest.
- Rejected because opening a large article means a long wait, MariaDB only stores blobs, the timeline is computed in the application, and the SQL panel becomes decoration.

### C. Change-event table (the guide's design) — dropped

Precompute before/after pairs per edit as ordinary rows. Dropped because scrubbing needs "the state at a moment", which system versioning provides natively; an event table would leave versioning with nothing essential to do.

### Also dropped: embedding the whole of M

An estimated one to two million distinct wordings at about 4 KB per vector is several gigabytes plus hours of compute. Coverage is tiered instead (section 9).

## 7. The screen

**Decided:** the "In the article" layout from the mock. The owner compared three layouts in a clickable prototype and chose this one after switching several times between it and the single-passage "Focus" layout.

Reference prototype (invented data, English text): `.superpowers/brainstorm/4395-1794622700/content/scrub-variants-v2.html`, view 2.

### 7.1 Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ WikiLens                                        [ article picker ▾ ] │
│ "Miksi talvisota alkoi?"            <- the question line is the input│
├──────────────────────────────────────────────────────┬──────────────┤
│  Talvisota                                           │  minimap     │
│  ↑ 7 paragraphs above                                │  ▂▂▂▂        │
│  ───────── ordinary article text ─────────           │  ▂▂▂         │
│  Tausta                                              │  ████ answer │
│ ┃ ANSWER PARAGRAPH, set larger, words morph in place │  ▂▂▂▂        │
│ ┃ [text changed]  8 Apr 2013 → 21 Aug 2016 · 3y 4m   │  ▂▂          │
│  ───────── ordinary article text ─────────           │              │
├──────────────────────────────────────────────────────┴──────────────┤
│ ◀ ▶ ▶   1 Jun 2013                      ┌ SELECT … FOR SYSTEM_TIME ┐│
│         this wording stood for 3y 4m    └ AS OF '2013-06-01' 0.2 ms┘│
│ ▁▃▅▇▅▃▂▁▂▃▂▁▁▂▃▂▁▁▁▂▂▃▂▁   faint bars: every edit                    │
│ ░░▒▒▒▓▓▓▓│▓▓▓▓███ ▨ ██████  bright band: the answer's wordings       │
│ 2004      2010       2016        2022      2026                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Behaviour

Items 1 to 6 are **Calls** the owner has seen.

1. **Real text around the answer.** The page always shows the whole article as of the playhead date. Only the answer paragraph animates word by word. Everything else swaps without animation, because a whole page in motion hides the answer.
2. **The page follows the answer.** If the passage moves, the view scrolls to keep it centred.
3. **Two layers on the timeline.** Faint bars are all edits per month. The bright band is the answer only: one segment per wording, brighter for later ones, a tick at each change. A wording that was replaced and then reverted is red. A period with no answer is hatched.
4. **Payoff before typing.** With no question asked, the page tints each paragraph by how many distinct wordings it has had. Asking a question replaces the tint with the answer highlight.
5. **The answer paragraph is set larger** than the body text, carrying over the strength of the Focus layout.
6. **The SQL panel stays**, collapsible.

Further **Calls**, not yet seen by the owner:

7. **Controls.** Drag anywhere on the timeline. The playhead snaps to an answer change within 8 px. Space plays and pauses. Left and right arrows step to the previous and next answer change. Play runs at constant speed and dwells about a second on each change, slightly longer on reverted ones.
8. **Other matches.** Up to two further candidate paragraphs appear as small chips. Clicking one tracks that paragraph instead. This is the escape hatch when the top match is wrong.
9. **A large, faint year** behind the page changes as the playhead moves.
10. **Visual language** carries over from the prototype: dark instrument-like frame, paper-coloured page, serif text, monospace for data, amber for change, red for reverted.
11. **Article picker.** Articles whose stories were read by hand come first, carry a mark, and offer example questions. The other tier 1 articles sit below under "automatic matching, not reviewed". If step 3 of section 13 shows the matcher cannot be trusted, the picker is restricted to the reviewed articles.

### 7.3 States the screen must handle

| Situation | What the user sees |
|---|---|
| Playhead before the article's first revision | Empty page, a line saying when the first revision was saved |
| Article exists, answer not yet written | Article without highlight, a notice with a jump to the first appearance |
| Answer removed for a period | A dimmed ghost of the last wording where it used to sit, with the dates of the gap |
| Wording replaced, then reverted | Red label giving the duration, for example "replaced, reverted after 7 min" |
| Passage restored | Label "restored unchanged" or "restored, reworded" |
| Playhead at the corpus end | Stops at 1 October 2026, labelled "corpus end" |
| No paragraph matches the question well | The closest one, labelled "weak match", and a line saying nothing matches well |
| Article has no vectors (tier 2) | Question uses keyword match, labelled as such |
| Embedding service unavailable | Asking is disabled with a plain message; scrubbing the article still works |
| Database unreachable | A plain error line; no stale data shown as current |

### 7.4 What is fetched when

This split is what makes goal 2 and goal 4 compatible.

- **On opening an article:** title, date range, edits per month for the faint bars, and the paragraph list at the corpus end with a wording count per paragraph for the tint.
- **On asking:** the question is embedded, every wording the article ever had is ranked, and the response carries the top three paragraphs plus the complete history of the best one: each wording with its text, dates and revision number, and each gap. This is small. The browser morphs the answer from it locally, so the answer never waits on the network.
- **On each scrub frame:** a live `AS OF` query returns the ordered paragraph identities for that moment. Paragraph texts are fetched by content hash and cached in the browser, so a frame response is a few kilobytes. Only the newest frame matters: an in-flight request is abandoned when a newer one is issued, and requests are never queued. The SQL panel shows this query with its bound timestamp and the database time the server measured.

## 8. Data

### 8.1 Tables

Illustrative. Names and column types are the builder's to adjust.

```sql
-- One row per Wikipedia revision. Plain table.
CREATE TABLE revision (
  rev_id     INT UNSIGNED PRIMARY KEY,
  page_id    INT UNSIGNED NOT NULL,
  ts         DATETIME NOT NULL,          -- Wikipedia's timestamp, UTC, as supplied
  valid_from TIMESTAMP(6) NOT NULL,      -- ts, moved 1 µs later where two revisions share a second
  parent_id  INT UNSIGNED,
  user       VARCHAR(255),
  anonymous  BOOL, minor BOOL,
  comment    TEXT,
  sha1       CHAR(31),
  bytes      INT UNSIGNED,
  KEY (page_id, valid_from)
);

-- Each distinct block of text, stored once.
CREATE TABLE wording (
  hash BINARY(16) PRIMARY KEY,           -- of kind + text
  kind ENUM('p','li','h') NOT NULL,      -- paragraph, list item, heading
  text MEDIUMTEXT NOT NULL
);

-- The core. One row per paragraph; one history row per change to it.
CREATE TABLE paragraph (
  page_id   INT UNSIGNED NOT NULL,
  para_id   INT UNSIGNED NOT NULL,       -- identity of a paragraph within its article
  pos       DOUBLE NOT NULL,             -- reading order
  hash      BINARY(16) NOT NULL,         -- which wording it has in this period
  rev_id    INT UNSIGNED NOT NULL,       -- revision that produced this state
  match_rule TINYINT UNSIGNED NOT NULL,  -- which rule in section 10.1 linked this state to the one before
  similarity FLOAT,                      -- text similarity when the link is an edit; NULL otherwise
  row_start TIMESTAMP(6) GENERATED ALWAYS AS ROW START INVISIBLE,
  row_end   TIMESTAMP(6) GENERATED ALWAYS AS ROW END INVISIBLE,
  PERIOD FOR SYSTEM_TIME (row_start, row_end),
  PRIMARY KEY (page_id, para_id),
  KEY start_key (page_id, row_start)
) WITH SYSTEM VERSIONING;

-- Vectors live in a plain table so the vector index is on documented ground.
CREATE TABLE wording_vector (
  hash      BINARY(16) PRIMARY KEY,
  embedding VECTOR(1024) NOT NULL,
  VECTOR INDEX (embedding) M=16 DISTANCE=cosine
);
```

Plus a small `article` table (page, title, revision count, date range, coverage tier) and a key/value table for corpus facts shown on screen.

Notes on these choices, all **Calls**:

- **Headings and list items are rows too.** The page is rebuilt from one ordered query. A paragraph's section is the nearest heading above it in that result; it is not stored, because storing it would create a history row for every paragraph whenever a heading is renamed.
- **`pos` is fractional.** A block inserted between two neighbours takes the midpoint, so no other row changes. If the gap runs out, that article's live rows are renumbered at that revision.
- **Vectors are separate from the versioned table.** MariaDB's documentation allows one vector index per table on a `NOT NULL` column and says a query without a usable index falls back to a full scan. It says nothing about vector indexes on system-versioned tables. Ranking inside one article is a scan over a few thousand rows and needs no index. The index exists for the stretch entry point.
- **No partitioning.** The starter measured no speed benefit, and partitioned tables carry restrictions we do not need.
- **Raw wikitext is not loaded into MariaDB.** The Parquet files remain the raw source, and each version links to the revision on Wikipedia.

### 8.2 The three queries that matter

Untested. Checking them on real MariaDB is the first build step.

```sql
-- A scrub frame: the article as it stood at one moment.
SELECT para_id, hash, rev_id
FROM paragraph FOR SYSTEM_TIME AS OF TIMESTAMP ?
WHERE page_id = ?
ORDER BY pos;

-- Ask: rank every wording this article ever had, including deleted ones.
SELECT p.para_id, MIN(VEC_DISTANCE_COSINE(v.embedding, VEC_FromText(?))) AS distance
FROM paragraph FOR SYSTEM_TIME ALL AS p
JOIN wording_vector AS v USING (hash)
WHERE p.page_id = ?
GROUP BY p.para_id
ORDER BY distance
LIMIT 3;

-- The answer's whole life.
SELECT p.hash, p.rev_id, p.row_start, p.row_end, w.text
FROM paragraph FOR SYSTEM_TIME ALL AS p
JOIN wording AS w USING (hash)
WHERE p.page_id = ? AND p.para_id = ?
ORDER BY p.row_start;
```

If the ranking query is slow or unsupported in this form, the fallback is two steps: fetch the article's hashes from the versioned table, then compute distances over `wording_vector` for those hashes.

### 8.3 Time rules

- Times are UTC. A version is valid from its start up to but not including the start of the next one.
- Revisions sharing a second are ordered by revision id and separated by one microsecond, as the starter does. The original timestamp is kept in `revision.ts` and is the one displayed.
- The playhead cannot pass the corpus cutoff. The open-ended final row in the database is not evidence that nothing changed afterwards.

## 9. Coverage

**Call**, with tier 1 seen by the owner.

| Tier | Articles | What works | Priority |
|---|---|---|---|
| 1 | The starter's 50 articles (about 32,000 revisions, 2 GB of wikitext) | Everything: paragraph history and vectors | Required |
| 2 | As many of the remaining 19,692 as time allows | Paragraph history and scrubbing; questions fall back to keyword match | If time allows |
| 3 | Tier 1 | Ask without choosing an article first; the vector index finds the article | Stretch |

A small "about the data" panel shows articles, revisions, paragraph versions, distinct wordings, vectors and database size, read from the database at run time.

## 10. Ingest

Python, reusing the starter's wikitext cleaner (`history.py: clean`) and its historical-insert pattern (`load.py`).

1. Download the M Parquet files and verify them against `SHA256SUMS`.
2. For each selected article, read its revisions in order, in batches, without loading the whole corpus into memory.
3. Clean each revision's wikitext into blocks: paragraphs, list items, headings.
4. Match the blocks to the previous revision's blocks (section 10.1).
5. Write revision rows, new wordings, and paragraph history rows with explicit start and end times, using `SET system_versioning_insert_history = 1` and `time_zone = '+00:00'`. Batch by bytes, not by row count.
6. Embed the paragraph and list-item wordings of tier 1 articles with bge-m3 through Ollama, skipping very short ones and any already embedded.

Every step can be stopped and rerun. An article is either fully loaded or not loaded; reloading an article replaces it.

### 10.1 Matching paragraphs across revisions

This is the hard part and the main risk. Rules, applied in order for each new revision:

1. **Full revert.** If the revision's `sha1` equals that of an earlier revision of the same article, reuse that revision's exact paragraph identities.
2. **Unchanged.** Align the old and new sequences of block hashes. Blocks in matching runs keep their identity.
3. **Moved.** A leftover new block with the same hash as a leftover old block keeps that identity and gets a new position.
4. **Edited.** Within each replaced stretch, pair old and new blocks of the same kind by text similarity, best pairs first, above a threshold (the starter uses 0.5). A pair keeps the identity and gets a new wording.
5. **Restored.** A leftover new block whose hash equals the last wording of a paragraph no longer present reuses that identity, which leaves a gap in its history. Failing that, a close match against paragraphs removed in the last few revisions.
6. **New.** Anything left gets a new identity. Old blocks left unmatched end.

A revision with empty text but a non-zero byte count is treated as missing data, not as a blanked page: the previous state carries forward and the revision is flagged.

The matcher is a pure function from (previous state, new blocks) to (new state), so it is tested first and in isolation.

**Every history row records how it was linked** (`match_rule`) and, for an edit, how similar the two wordings were (`similarity`). **Call.** This is settled before the first ingest because it is in the table. The screen uses it to say how firm a link is (section 10.2), and thresholds can be re-examined afterwards without ingesting again.

**The cleaner is hardened before use.** **Call.** The starter's cleaner drops everything after an unclosed `{{` or `{|`. On Wikipedia an unclosed template opener shows as literal text and the rest of the page still renders, so the cleaner would report a removal and later a restoration that no reader ever saw. The cleaner is changed to treat an unclosed opener as literal text, with a test written first.

### 10.2 Labels on the answer's timeline

Derived from the history rows alone:

| Observation | Label |
|---|---|
| First row | first appears |
| Wording differs from the previous one | text changed |
| Wording differs and the link is loose (similarity near the threshold) | heavily rewritten, drawn as a hollow tick |
| No row for a period | removed |
| Row after a gap, same wording as before | restored unchanged |
| Row after a gap, different wording | restored, reworded |
| A wording sitting between two identical ones | replaced, reverted after *duration* |

A label never claims more certainty than the link behind it has.

## 11. How we know it is right

- **Round trip.** For a sample of revisions of every loaded article, the blocks returned by the frame query at that revision's time equal the cleaner's output for that revision's raw text, in order. This proves the stored state is correct at every sampled moment.
- **Boundaries.** Before the first revision; exactly on a boundary; between two revisions; two revisions in the same second; at and after the corpus cutoff.
- **Matcher cases.** Unchanged, edited, moved, removed then restored, full revert, vandalism blip, missing-text revision.
- **Real stories.** Before the interface is finished, find three to five real (article, question) pairs whose answer visibly changes, including one revert and one gap, and read them by hand. The default article and example questions are chosen from what the data actually contains. If Talvisota has no good story, another article leads. **Call:** the assistant reads the Finnish and gives the owner each story as a short English summary with its revision links; the owner decides which stories lead. Each story's question is tried in Finnish and in English, because bge-m3 is multilingual and a judge may type English, and the weak-match threshold is set from both.
- **Measurements** recorded with hardware, database version and corpus size: frame query time, ask time split into embedding and ranking, ingest speed, database size, and the coverage counts.

The round trip proves state, not identity. Whether a rewritten paragraph is "the same paragraph" is a judgment the matcher makes; the real stories are read by hand for that reason.

## 12. Stack

All **Calls**. Items marked seen were shown to the owner.

- MariaDB in Docker, image pinned by digest.
- Python for ingest and for the small API server, so the matcher, the timeline logic and the database code live in one place. (Python for ingest: seen.)
- TypeScript in the browser, built with Vite. (TypeScript for the screen: seen.)
- bge-m3 through Ollama for embeddings, the same model as the starter and the supplied S vectors. (Seen.) This needs Ollama installed and a 1.2 GB model download.
- Passage text alone is the embedding input. If retrieval is poor on real questions, prefix the article title and re-embed.

## 13. Order of work

The plan will detail this. The order matters because each step removes a risk.

1. **Prove the query shapes** on a pinned MariaDB with a tiny hand-made fixture: historical insert, `AS OF`, a boundary, the ranking join, a vector index on a plain table.
2. **One article end to end**, with the round-trip test passing.
3. **Find the real stories** and pick the default.
4. **The screen on real data.**
5. **All of tier 1**, measured.
6. **Tier 2**, then tier 3, only if the hero flow is solid.

If time runs short, cut in this order: tier 3, tier 2, other-match chips, the heat tint. Never cut the correctness tests or the live query.

## 14. Risks

| Risk | Response |
|---|---|
| Matching errors show as false edits | Matcher tested first; thresholds tuned on real articles; demo stories read by hand |
| The cleaner drops templates, tables and references | Accepted; edits inside them are not shown, and the screen says the text is simplified |
| An unclosed template makes the cleaner drop the rest of the page | Cleaner changed to treat it as literal text, test first (section 10.1) |
| The pure-Python cleaner is slow on gigabytes of text | Process articles in parallel; tier 2 is allowed not to finish |
| Time travel plus vector ranking in one statement is unverified | Step 1 tests it; a two-step fallback exists |
| The chosen article has no good story | Step 3 chooses from the data before the interface is tuned |
| Disk fills | Estimated use for tier 1 is under 2 GB (unmeasured); watch during tier 2 |
| Deadline is unknown | Cut order in section 13 |

## 15. Left to the builder

Names, file layout, the database driver, any framework inside the browser code, batch sizes, parallelism, similarity and weak-match thresholds (tuned on real data), minimum length for embedding, play speed and dwell times, font bundling, and whether `pos` is a number or a string key. The scrub loop must not go through a per-frame framework re-render.

## 17. Amendment, 14 November 2026: Wikipedia's look

**Decided** by the owner after seeing the built screen: use Wikipedia's layout and visual
design, with the timeline integrated into it. This replaces section 7.2 item 10 (the dark
frame and paper page of the prototype) and the minimap.

- The whole screen follows Wikipedia's current skin (Vector 2022): header, title, tabs,
  contents sidebar, its typography and colours. It is rebuilt in this project's own
  stylesheet; Wikimedia's stylesheet files (GPL) are not copied.
- The Wikipedia logo and wordmark are not used: they are Wikimedia trademarks. The page
  carries its own name and says it is not Wikipedia.
- **Call** (the owner was offered two placements and did not choose): the timeline sits
  under the article tabs, as the opened history tab, and stays in view while the article
  scrolls. The alternative is docking it at the bottom.
- A contents list built from the article's headings at the playhead replaces the minimap.
  It changes as the article does, marks the section holding the answer, and shows how
  much each section has been reworded.
- Changes are drawn in Wikipedia's own diff colours: blue for added, yellow with a strike
  for removed; red for a wording that was reverted.
- The query panel and the timeline key move to the right-hand column.
- Interface text is English over Finnish article text, as before. No control is decorative:
  the "Read on Wikipedia" tab opens the real article.

## 18. Amendment, 14 November 2026: the overview returns, the header goes quiet

**Decided** by the owner after seeing the Wikipedia look:

- The strip at the top right (the "not Wikipedia" line, "About the data", and the note on
  whether an article's story was read by hand) is removed from the header and the title row.
  **Call:** the three are kept, small, at the foot of the left column rather than deleted:
  "About the data" is a working panel the demo uses, and the other two are the page's
  honesty about what it is. Deleting them outright is the owner's to ask for.
- The overview of the whole article (one bar per block, tinted like the page, the answer
  marked) comes back. The owner offered two places: on the right, or on the left merged into
  the contents list. **Call:** on the right, between the article and the right-hand column,
  where a document map is expected. It also shows which part of the article is in view, and
  pressing or dragging on it moves the article. A short article leaves the strip partly
  empty, so the article is seen to grow as the playhead moves forward. The contents list
  stays as it is, with its per-section dots.

## 19. Amendment, 14 November 2026: then and now

**Asked for** by the owner: a question about something the article used to say should be told
"it read like that on date X, and reads differently now".

- The ranking already covered every wording an article ever had. What was missing was saying
  *which* wording matched. The answer now carries, for each matching paragraph, the wording
  closest to the question over that paragraph's whole history (one more
  `FOR SYSTEM_TIME ALL` query joined to the vectors).
- When that wording is not the one at the playhead, a box above the answer says when the
  article read like that, quotes it, counts the words that differ from the wording shown,
  and offers a jump to that moment. A wording that was put back more than once is given with
  its whole span and how many times it stood. Its stretches are marked on the timeline.
- When the playhead is on that wording, it is labelled as the closest, with when it stopped
  standing and a jump to the end of the corpus if the paragraph reads differently there.
- It states what the history shows and nothing more: no claim that the old wording was wrong
  or the new one right.
- **Call:** the playhead does not move on its own when a question is asked. The page shows
  today's wording and points at the old one; the reader chooses to go there.
- **Call:** which stretch counts as "closest" is the model's ranking of wordings, with no
  threshold. Two wordings that differ by a comma can be told apart; the count of differing
  words lets the reader see when that is all it is.
- Only articles with vectors get this. A question answered by keyword singles out no wording.
- A fourth story, read by hand, shows it: the President of Finland's official car.

## 16. Not yet established

- The submission deadline, required format, team size, and whether judges drive the demo. The owner was asked and approved the design without giving them, so the plan uses the stated fallback: due Sunday 15 November in the morning, a repository plus a short video plus the owner presenting live, one person building. These are planning assumptions, not confirmed facts; the owner should check the organisers' instructions.
- Whether the matcher's results on real articles are good enough to tell true stories. Step 3 answers this.
- Whether a vector index can sit on a system-versioned table. The design does not depend on it.
