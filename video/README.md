# The WikiLens film

A film of under a minute about WikiLens: recordings of the real page with a camera moving over
them, narrated, with a title and a close drawn in code. The real page is on screen from the
second second to the last ten. Built with [Remotion](https://www.remotion.dev).

The footage is not a mock-up. `record/takes.mjs` drives the running site in a headless browser
(typing the questions, dragging the timeline, clicking the buttons) and saves what the browser
drew, at twice the pixel density so close-ups stay sharp.

## Make it

The site must be running with its data loaded and the four story articles embedded (see the
project README), and Ollama must be up, because two takes ask real questions.

```bash
cd video
pnpm install
pnpm record            # four takes of the real page into public/footage/ (about 3 minutes)
pnpm voice --env /path/to/.env   # the narration into public/voice/ (needs ELEVENLABS_API_KEY in that file)
pnpm render            # out/wikilens-promo.mp4, 1920 x 1080, 30 frames a second, with sound
```

The narration is spoken by [ElevenLabs](https://elevenlabs.io). `record/voice.mjs` reads only the
`ELEVENLABS_` lines of the file it is given, sends the key nowhere but to ElevenLabs, and never
prints or stores it. A line whose text has not changed is not asked for again. The voice is the
stock voice "George" unless `ELEVENLABS_VOICE_ID` says otherwise; the model is
`eleven_multilingual_v2` unless `--model` says otherwise.

Other commands:

```bash
node record/takes.mjs then            # record one take again (ask, then, grow, query)
pnpm stills /tmp/stills 0.5 70 400    # single frames, at half size, to look at before a full render
pnpm studio                           # Remotion's editor, to scrub the film
pnpm test && pnpm typecheck
```

`ffmpeg` must be on the path for recording. Footage, narration and renders are not kept in git.

## How it is put together

| | |
|---|---|
| `record/capture.mjs` | Records a page: the browser's own screencast frames at 2x, a pointer drawn into the page (a headless browser has none), and the moments and places the film cuts and zooms to, written beside the video as JSON |
| `record/takes.mjs` | The four takes: `ask` (ask, drag back, step forward), `then` (the question about the past), `grow` (play the whole history), `query` (a steady drag for the query panel) |
| `src/camera.ts` | The camera: a shot is a rectangle of the page, and the camera eases from one to the next. Tested in `tests/` |
| `record/voice.mjs` | The narration: the lines, and for each the audio, its length and when each word begins |
| `src/shots.ts`, `src/plan.ts` | The framings and the running order |
| `src/scenes/` | One file per scene. Each works out its own length and where its narration falls |
| `src/components/` | Footage through the camera, the caption line, the chapter tag, the timeline emblem, the fade every scene shares |

Nothing is timed by hand. Each take's marks come from the recording and each line's word times
from the voice, so a scene lasts as long as what is said in it, the picture changes on the word
that speaks of it, and cuts follow what happened on the page. `src/plan.ts` refuses to build a
film in which two lines would be spoken at once. After recording again, look at the stills.

## What is said in it

- The sentence in the closing scene is this project's translation of a sentence of the Finnish
  article *Suomen tasavallan presidentti*. The dates are the ones in its history: first written
  13 July 2008, changed 24 May 2024.
- The counts (19,742 articles, 862,076 revisions, 1,219,370 paragraph versions) are the ones
  in `docs/measurements.md`.
- "23 years" is the article *Talvisota*: first revision October 2003, corpus end October 2026.
- "Twenty years of edits" is the tracked paragraph of *Suomettuminen*: first written in 2006,
  still in the article at the corpus end in 2026.
- The bars of the timeline emblem on the title and end cards are made up. Everything inside a
  recording is the real page on real data.
- The typing and the drags are shown faster than they were made (1.6 times), and the article
  growing about 2.3 times faster. Nothing else about the page is altered.
- The only sound is the narration. There is no music.

## Licences

Remotion is free for individuals and small teams and needs a company licence above that:
see its licence before using this in a company. What may be done with the narration depends on
the ElevenLabs plan of the account that made it. Article text shown in the film is from Finnish
Wikipedia, CC BY-SA 4.0. WikiLens is not affiliated with Wikipedia or the Wikimedia Foundation.
