# Demo script

About three minutes. Start `scripts/demo.sh` beforehand and open http://127.0.0.1:8000.
Everything shown is live: no step below uses a prepared answer.

Before you present, read the caution about the Talvisota article in `docs/stories.md`.

## 0:00 The problem (20 s)

> A Wikipedia article is the latest of thousands of versions. If you want to know how its
> answer to one question changed, you read diffs for an afternoon. Here is another way.

The app opens on *Suomettuminen* (Finlandization), laid out as the Wikipedia article it is:
title, tabs, contents list. The opened tab is "History through time". The paragraphs are
tinted by how often each has been reworded, and the dots in the contents list say the same
per section: the article shows you where it has been argued over before you type anything.
The strip beside the text is the whole article, one bar per paragraph.

## 0:20 Ask once (25 s)

Click the example question **"Who coined the term Finlandization?"** (the article is in
Finnish; the question can be in English).

> I asked once. No dates to pick. The paragraph that answers lights up where it sits in the
> article, and its whole life is on the timeline: each band is one wording, darker is
> later.

Point at the green line under the question: the ranking covered every wording the article
has ever had, including deleted ones, in a few milliseconds.

## 0:45 Scrub the answer (60 s)

Press **←** a few times, then drag the timeline back to 2006 and press **space**.

> Watch the paragraph rewrite itself. 2006: "a term introduced in West Germany in the
> 1960s". 2008: someone adds that it was first used in Austria in the 1950s. Later that
> year: it was Willy Brandt's opponents who used it. 2021: a name appears, Professor
> Richard Löwenthal.

Say what the labels are: "text changed", "removed", "restored unchanged". They state what
the history shows and nothing about anyone's intent.

## 1:45 The stronger story (40 s)

Choose **Talvisota** in the picker, click **"How did the Winter War begin?"**, then use
**←** to step back through 2024 and 2023 only.

> May 2023: the war "was preceded by negotiations to move the border peacefully", and four
> minutes later a sentence blames the Finnish foreign minister's unyielding line. September:
> that sentence is gone. November: "peacefully" has become "Finland was pressured". One
> paragraph, one year, and the cause of a war changed sides.

Do not press play on this article in front of an audience unless you have decided the
vandalism in its history is acceptable to show.

## 2:25 MariaDB is the mechanism (25 s)

Point at the query box in the right-hand column while dragging.

> Every frame is this query: `FOR SYSTEM_TIME AS OF`. Each paragraph is a row in a
> system-versioned table, and each edit is a history row carrying the time it was saved on
> Wikipedia. The timeline is that paragraph's history rows. The question ranks vectors
> joined to `FOR SYSTEM_TIME ALL`, which is why it finds text that was deleted years ago.

Open **About the data** (at the foot of the left column) for the counts, read live from the database.

## 2:50 Close (10 s)

> Fifty articles, every version since 2003, about a millisecond per frame. Wikipedia through
> time, one question at a time.

Give the numbers from `docs/measurements.md`, not from memory.

## If something fails

- **Questions fail, scrubbing works:** Ollama is not running. The app says so. Start
  `ollama serve`; nothing else needs restarting.
- **"database unavailable":** `docker compose up -d --wait`, then reload the page.
- **No network:** nothing in the demo needs one.
