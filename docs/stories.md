# Stories read by hand

14 November 2026. Three paragraphs whose histories I read in Finnish, wording by wording, to
check that what the screen shows is what happened. The order below is the order in
`backend/wikilens/stories.json`, which decides what the app opens on and which example
questions it offers. **The order is provisional: the project owner has not chosen yet.**

How they were found: `python -m wikilens.stories --pages …` lists the paragraphs of an article
with the most eventful histories; `--life PAGE:PARAGRAPH` prints one paragraph's whole life.
Paragraph numbers are internal and change if the articles are reloaded with a different
cleaner or matcher; the questions do not.

Each question was asked through the API in Finnish and in English with bge-m3.
Distance is cosine distance; lower is closer.

| Article | Question (fi / en) | Top match is the intended paragraph | Distance |
|---|---|---|---|
| Suomettuminen | Kuka keksi käsitteen suomettuminen? / Who coined the term Finlandization? | yes / yes | 0.397 / 0.410 |
| Lapuanliike | Mikä lapuanliike oli? / What was the Lapua Movement? | yes / yes | 0.301 / 0.352 |
| Talvisota | Miten talvisota syttyi? / How did the Winter War begin? | yes / yes | 0.306 / 0.356 |

Phrasings that put the intended paragraph second, not first: "Why did the Winter War start?"
(a paragraph on the world's condemnation of the attack came first) and "Mistä käsite
suomettuminen on peräisin?" (an older paragraph with the same content came first). The
"also matches" chips on screen switch to the intended one in a click.

## 1. Suomettuminen: who coined "Finlandization"?

Paragraph on the origin of the term; 31 segments from 2006 to 2024. A clean, substantive
history with almost no vandalism.

- **24 Mar 2006** ([rev 940160](https://fi.wikipedia.org/?oldid=940160)): first appears. The
  term was "introduced in West Germany in the 1960s".
- **19 Nov 2006** ([1916274](https://fi.wikipedia.org/?oldid=1916274)): "West Germany" becomes
  "the Federal Republic of Germany".
- **26 Apr 2008** ([4692644](https://fi.wikipedia.org/?oldid=4692644)): an earlier origin is
  added: introduced "originally in Austria as early as the 1950s", then used heavily in Germany.
- **29 Jun 2008** ([5023580](https://fi.wikipedia.org/?oldid=5023580)): a 1971 definition by
  Lauri Aho, editor of Uusi Suomi, is quoted.
- **4 Aug 2008** ([5216713](https://fi.wikipedia.org/?oldid=5216713)): "the 1960s" becomes
  "the late 1960s".
- **20 Nov 2008** ([5846669](https://fi.wikipedia.org/?oldid=5846669)): who used it is added:
  opponents of Chancellor Willy Brandt, criticising his Ostpolitik as too pro-Soviet.
- **9 Jan 2009**: removed and restored twice within two minutes.
- **2 Feb 2010** ([7969939](https://fi.wikipedia.org/?oldid=7969939)): the sentences on how to
  translate the word are cut. The screen labels this "heavily rewritten" and draws the link
  as loose, which is fair: about half the paragraph went.
- **14 Mar 2021** ([19635715](https://fi.wikipedia.org/?oldid=19635715)): a name is put to
  the origin: Professor Richard Löventhal of the Free University of Berlin, around 1960.
- **2024** ([22525451](https://fi.wikipedia.org/?oldid=22525451),
  [22602449](https://fi.wikipedia.org/?oldid=22602449)): wording tidied; the name's spelling
  corrected to Löwenthal.

Read against the text: every step above is what the revisions show. No matching mistakes seen.

## 2. Lapuanliike: what was the Lapua Movement?

The article's opening paragraph since 12 March 2020; 36 segments. A history of how to
characterise a political movement.

- **12 Mar 2020, 09:39** ([18788591](https://fi.wikipedia.org/?oldid=18788591)): the opening
  is written afresh: a "radical right-wing popular movement" of 1929 to 1932.
- **12 Mar 2020, 11:17** ([18788761](https://fi.wikipedia.org/?oldid=18788761)):
  "anti-communist and" is added in front of "radical right-wing".
- **12 Mar 2020, 22:39** ([18790094](https://fi.wikipedia.org/?oldid=18790094)): both
  descriptions are removed, with a sentence saying far-right agitation threatened the young
  democracy. Within eight minutes ([18790100](https://fi.wikipedia.org/?oldid=18790100),
  [18790104](https://fi.wikipedia.org/?oldid=18790104)) the two descriptions are back.
- **13 Mar 2020** ([18790429](https://fi.wikipedia.org/?oldid=18790429)): a sentence is added
  on pressure by violence, the threat of violence, and political terror.
- **15 Mar 2020** ([18795909](https://fi.wikipedia.org/?oldid=18795909)): restructured; labelled
  "heavily rewritten", loose link. The content carries over; the label is accurate.
- **2 May 2021** ([19749467](https://fi.wikipedia.org/?oldid=19749467)): the movement becomes
  "influential".
- **14 Nov 2022** ([21010488](https://fi.wikipedia.org/?oldid=21010488)): "still highly
  respected in Lapua today" is added about its leader and reverted after two hours.

Worth knowing: before 12 March 2020 the article opened with a different paragraph, rewritten
from scratch that day, so the matcher gives it a new identity. Scrubbing earlier than that
date shows "this paragraph first appears on 12 Mar 2020". That is correct by the rules, and
it is the right thing to say in a demo if someone drags left.

## 3. Talvisota: how did the Winter War begin?

The article's opening paragraph since December 2009; 71 segments, most of them vandalism
reverted within minutes. The substantive story is in 2023 and 2024.

- **6 Dec 2009** ([7690165](https://fi.wikipedia.org/?oldid=7690165)): the war "began with a
  Soviet attack without a declaration of war".
- **10 Mar 2011** ([9898907](https://fi.wikipedia.org/?oldid=9898907)): reworded, reverted
  after 21 hours, then reworded again the same day.
- **3 Jul 2013** ([13364388](https://fi.wikipedia.org/?oldid=13364388)): the sentence is
  turned around: "the Soviet Union began the Winter War by attacking".
- **8 May 2023, 05:21** ([21531280](https://fi.wikipedia.org/?oldid=21531280)): a cause is
  added: the outbreak "was preceded by negotiations to move Finland's eastern border
  peacefully further from the city of St Petersburg".
- **8 May 2023, 05:25** ([21531283](https://fi.wikipedia.org/?oldid=21531283)): four minutes
  later a sentence is added saying the Finnish negotiator, foreign minister Eljas Erkko,
  contributed to the outbreak by his unyielding line.
- **23 Sep 2023** ([21846496](https://fi.wikipedia.org/?oldid=21846496)): the sentence about
  Erkko is removed.
- **30 Nov 2023** ([22018696](https://fi.wikipedia.org/?oldid=22018696)): "negotiations to
  move the border peacefully" becomes "negotiations in which Finland was pressured to move
  the border".
- **28 Apr 2024** ([22355557](https://fi.wikipedia.org/?oldid=22355557)): "conducted by Eljas
  Erkko" is inserted; it is reverted on 12 July 2024, two months later.

So within a year the opening paragraph went from "peaceful negotiations" and a named Finnish
minister to "Finland was pressured". This is the strongest story of the three.

**Caution before showing it to an audience.** The vandalism in this paragraph's history is
shown as it was written, each for a moment during play: an ethnic slur for Russians (2011,
2016, 2020, 2024), sexual words (2019), a homophobic phrase (2018), and a line of Russian
profanity (2021). The app labels each "replaced, reverted after N min" and says nothing about
intent. Stepping with the arrow keys from 2023 onward avoids all of it. This is why the
article is listed third and not first.

One labelling detail: on 4 Dec 2019 a two-step vandal edit was undone in one step. The
screen says "text changed", "text changed", "restored unchanged". That is what the rows show;
the "replaced, reverted" label is only given to a single wording that sat between two
identical ones.

## What was tuned

- `WEAK_DISTANCE` set to 0.5. On these articles, questions the article answers scored 0.29 to
  0.44; unrelated ones ("What is the capital of Australia?", a baking question, physics
  jargon) scored 0.54 to 0.60, matching leftover vandalism text.
- The cleaner now drops lines that are only a link to another language's article, and decodes
  HTML entities. Both showed up as noise when reading real paragraphs.
- The matcher's thresholds (0.5 for an edit, 0.6 for a reworded restoration) were left alone:
  in the three histories read, identities held through every edit, vandal edit and revert.
