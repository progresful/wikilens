-- Tables for WikiLens. Applied by db.apply_schema(), which drops and recreates all of them.

DROP TABLE IF EXISTS paragraph;
DROP TABLE IF EXISTS wording_vector;
DROP TABLE IF EXISTS wording;
DROP TABLE IF EXISTS revision;
DROP TABLE IF EXISTS article;
DROP TABLE IF EXISTS corpus_fact;

-- One row per loaded article.
CREATE TABLE article (
  page_id                INT UNSIGNED NOT NULL PRIMARY KEY,   -- Wikipedia's own id
  title                  VARCHAR(255) NOT NULL,
  revisions              INT UNSIGNED NOT NULL,
  first_ts               DATETIME NOT NULL,
  last_ts                DATETIME NOT NULL,
  tier                   TINYINT UNSIGNED NOT NULL,           -- 1: history and vectors, 2: history only
  text_missing_revisions INT UNSIGNED NOT NULL DEFAULT 0      -- revisions whose text the dump did not carry
) CHARACTER SET utf8mb4;

-- One row per Wikipedia revision. Plain table: metadata only, no article text.
CREATE TABLE revision (
  rev_id     INT UNSIGNED NOT NULL PRIMARY KEY,
  page_id    INT UNSIGNED NOT NULL,
  ts         DATETIME NOT NULL,          -- Wikipedia's timestamp, UTC, as supplied; the one shown to readers
  valid_from TIMESTAMP(6) NOT NULL,      -- ts, moved 1 microsecond later where two revisions share a second
  parent_id  INT UNSIGNED,
  user       VARCHAR(255),
  anonymous  BOOL NOT NULL DEFAULT 0,
  minor      BOOL NOT NULL DEFAULT 0,
  comment    TEXT,
  sha1       CHAR(31),
  bytes      INT UNSIGNED NOT NULL DEFAULT 0,
  KEY page_time (page_id, valid_from)
) CHARACTER SET utf8mb4;

-- Each distinct block of text, stored once however many revisions carried it.
CREATE TABLE wording (
  hash BINARY(16) NOT NULL PRIMARY KEY,  -- of kind + text
  kind ENUM('p', 'li', 'h') NOT NULL,    -- paragraph, list item, heading
  text MEDIUMTEXT NOT NULL,
  FULLTEXT KEY ft_text (text)
) CHARACTER SET utf8mb4;

-- The core. One row per paragraph of an article; MariaDB keeps every earlier state as a
-- history row. Ingest writes those with Wikipedia's real edit times
-- (system_versioning_insert_history), so FOR SYSTEM_TIME AS OF '2013-06-01' is the article
-- as it stood on 1 June 2013.
CREATE TABLE paragraph (
  page_id    INT UNSIGNED NOT NULL,
  para_id    INT UNSIGNED NOT NULL,      -- identity of a paragraph within its article
  pos        DOUBLE NOT NULL,            -- reading order
  hash       BINARY(16) NOT NULL,        -- which wording it has in this period
  rev_id     INT UNSIGNED NOT NULL,      -- revision that produced this state
  match_rule TINYINT UNSIGNED NOT NULL,  -- how this state was linked to the one before (matcher.Rule)
  similarity FLOAT,                      -- text similarity when the link is an edit; NULL otherwise
  row_start  TIMESTAMP(6) GENERATED ALWAYS AS ROW START INVISIBLE,
  row_end    TIMESTAMP(6) GENERATED ALWAYS AS ROW END INVISIBLE,
  PERIOD FOR SYSTEM_TIME (row_start, row_end),
  PRIMARY KEY (page_id, para_id),
  -- MariaDB's own history index is ordered by row_end; this one lets an old AS OF start from
  -- the versions that began before the moment asked for.
  KEY start_key (page_id, row_start)
) CHARACTER SET utf8mb4
  WITH SYSTEM VERSIONING;

-- Vectors live in a plain table, so the vector index is on documented ground.
CREATE TABLE wording_vector (
  hash      BINARY(16) NOT NULL PRIMARY KEY,
  embedding VECTOR(1024) NOT NULL,
  VECTOR INDEX (embedding) M=16 DISTANCE=cosine
);

-- Facts about the loaded corpus that the screen shows.
CREATE TABLE corpus_fact (
  name  VARCHAR(64) NOT NULL PRIMARY KEY,
  value VARCHAR(255) NOT NULL
) CHARACTER SET utf8mb4;
