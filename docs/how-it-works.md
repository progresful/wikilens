# How WikiLens works

## The idea

A Wikipedia article is split into blocks: paragraphs, list items, headings. Each block is
**one row in a system-versioned MariaDB table**, and each edit to it is a history row stamped
with the time the revision was saved on Wikipedia (`system_versioning_insert_history`). So the
database's own time travel is the mechanism: "the article on 1 June 2013" is one
`FOR SYSTEM_TIME AS OF` query, and "the life of this paragraph" is its history rows.

Only changed paragraphs are stored, each distinct wording once, and each wording is embedded
once (bge-m3, 1,024 dimensions, in a `VECTOR` column of the same database).

## The queries

```sql
-- A scrub frame: the article as it stood at one moment.
SELECT para_id, hash, rev_id
FROM paragraph FOR SYSTEM_TIME AS OF TIMESTAMP '2013-06-01 00:00:00'
WHERE page_id = 1256
ORDER BY pos, para_id;

-- The answer's whole life: one paragraph's history rows.
SELECT p.hash, p.rev_id, p.row_start, p.row_end, w.text
FROM paragraph FOR SYSTEM_TIME ALL AS p JOIN wording AS w ON w.hash = p.hash
WHERE p.page_id = 1256 AND p.para_id = 479
ORDER BY p.row_start;

-- Ask: rank every wording the article ever had, including deleted ones.
SET @question = VEC_FromText('[...1024 numbers...]');
SELECT p.para_id, MIN(VEC_DISTANCE_COSINE(v.embedding, @question)) AS distance
FROM paragraph FOR SYSTEM_TIME ALL AS p JOIN wording_vector AS v ON v.hash = p.hash
WHERE p.page_id = 1256
GROUP BY p.para_id ORDER BY distance, p.para_id LIMIT 3;

-- Then and now: which wording of each matching paragraph was closest. It may be one the
-- paragraph gave up years ago. Of equally close wordings, the most recent is named.
SELECT p.para_id, p.hash, MIN(VEC_DISTANCE_COSINE(v.embedding, @question)) AS distance
FROM paragraph FOR SYSTEM_TIME ALL AS p JOIN wording_vector AS v ON v.hash = p.hash
WHERE p.page_id = 1069 AND p.para_id IN (489, 599, 711)
GROUP BY p.para_id, p.hash
HAVING MAX(TIMESTAMPDIFF(MICROSECOND, p.row_start, p.row_end)) >= 1000
ORDER BY distance, MAX(p.row_end) DESC, p.hash;
```

Every statement the application runs is in `backend/wikilens/queries.py`.

## The pieces

```
dataset M (Parquet)                                  browser
      │                                                 ▲
      ▼                                                 │ frames, wordings, ask
 ingest: clean wikitext into blocks,              FastAPI (wikilens.api)
 match each block to the previous revision,             ▲
 write versioned paragraph rows                         │
      │                                                 │
      ▼                                                 │
 MariaDB:  paragraph (system-versioned) · wording · wording_vector (VECTOR) · revision
      ▲
 embed: each distinct wording once, bge-m3 through Ollama
```

- `backend/wikilens/` — Python: `cleaner`, `matcher` (which block of a new revision is the
  same paragraph as before), `history_rows`, `ingest`, `embed`, `timeline` (the labels),
  `queries` (every SQL statement), `api`.
- `web/` — TypeScript, no framework: `scrub` (the playhead, one frame request in flight at a
  time), `diff` (word-level changes), `closest` (then and now), `sections` and `minimap`
  (contents list and overview strip), `views/`.
- `video/` — the film: a recorder that drives the real page, the narration, and the Remotion
  composition. See [video/README.md](../video/README.md).
- `deploy/` — how it runs at wikilens.pgf.lv. See [deploy/README.md](../deploy/README.md).

The answer never waits for the network: its whole history arrives with the question, and the
browser changes its wording locally as the playhead moves. The article around it comes from a
live frame query for each move.

## Limits

- **Coverage.** Every article of the dataset can be scrubbed. Questions by meaning cover the
  articles that are embedded: the 50 used by MariaDB's own system-versioning starter and the
  fourth story's article. `wikilens.embed --pages` adds any other in about a minute. The
  rest answer by keyword match and say so, and "then and now" needs vectors.
- **The corpus ends on 1 October 2026.** Nothing after that is known here, and the timeline
  stops there.
- **Text is simplified.** Templates, tables and references are not shown, so edits inside
  them are not seen.
- **Paragraph identity is a judgment.** Which blocks of two versions count as "the same
  paragraph" is decided by rules (identical, moved, similar enough, restored). A weak link is
  drawn dashed and labelled "heavily rewritten". The four stories the app offers were read by
  hand ([stories.md](stories.md)); every other article says "automatic matching, not reviewed".
- **History is shown as it was.** Vandalism appears as it was written, for as long as it
  lasted.
- **"Closest" is the model's ranking, not a verdict.** The box that points at the wording
  closest to a question says which wording matched and when it stood. It does not say which
  wording is true.
- **The API has no accounts and no limits of its own.** It listens on 127.0.0.1. On the
  public site nginx stands in front of it and rations requests.
- **Over the internet the page follows a drag more slowly.** Each frame is a live query, so
  it costs a network round trip. The answer itself still changes at once.
- **The vector index is not used by a screen yet.** `wording_vector` has an HNSW index, and
  [measurements.md](measurements.md) shows MariaDB using it for nearest-neighbour search.
  Ranking inside one article does not need it: it scores that article's wordings exactly.
  Asking across all articles, which would use the index, is not built.

## More

- [design.md](design.md): what was decided before building and why, with later amendments.
- [measurements.md](measurements.md): every number, how it was measured, and the query shapes.
- [stories.md](stories.md): the four paragraph histories read by hand.
- [demo-script.md](demo-script.md): a spoken walk through the app.
