// The film's narration, spoken by ElevenLabs.
//   node record/voice.mjs --env /path/to/.env      reads ELEVENLABS_API_KEY (and ELEVENLABS_VOICE_ID,
//                                                  if set) from that file
//   ELEVENLABS_API_KEY=... node record/voice.mjs   or from the environment
//   ... --model eleven_v3                          another model than the default
// Writes public/voice/<id>.mp3 for each line and public/voice/voice.json with how long each line
// is and when each of its words begins, which the film is cut to. A line whose text, voice and
// model have not changed is not asked for again, so running this twice costs nothing.
// The key is only ever sent to api.elevenlabs.io. It is never printed or written anywhere.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb';      // "George", one of ElevenLabs' stock voices
// The model is chosen for a film, not taken from another project's settings: a low-latency model that
// suits a live product is the wrong one for narration that is made once and listened to closely.
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const OUT = path.resolve(import.meta.dirname, '../public/voice');
const MANIFEST = path.join(OUT, 'voice.json');

// What is said. Every claim here is checked against the project's docs: see video/README.md.
const LINES = [
  { id: 'intro', text: 'This is WikiLens.' },
  { id: 'ask1', text: 'Ask an article one question.' },
  { id: 'ask2', text: 'The paragraph that answers lights up, right where it sits.' },
  { id: 'scrub2', text: 'Drag the timeline. The answer rewrites itself, word by word, through twenty years of edits.' },
  { id: 'scrub3', text: 'Step through it, change by change.' },
  { id: 'then2', text: 'Now ask about the past. Is the president’s car a Mercedes?' },
  { id: 'then3', text: 'Not today. But it finds the wording that said so, and when it stood.' },
  { id: 'then4', text: 'One click, and you are there.' },
  { id: 'grow', text: 'Or just press play, and watch twenty-three years of one article grow, from its first line to today.' },
  { id: 'query1', text: 'Underneath, one database.' },
  { id: 'query2', text: 'Every paragraph is a row in a MariaDB system-versioned table.' },
  { id: 'query3', text: 'Every frame is one time-travel query, with vector search right beside it.' },
  { id: 'closing', text: 'The answer changed. Wikipedia kept every version.' },
  { id: 'end', text: 'WikiLens. Wikipedia through time, one question at a time.' },
];

/** The ElevenLabs settings from a .env file: only lines that begin ELEVENLABS_, nothing else in it is read. */
async function settingsFrom(file) {
  const found = {};
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    const match = /^(ELEVENLABS_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (match !== null) found[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return found;
}

function probeSeconds(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Number(out.trim())) : reject(new Error(`ffprobe could not read ${file}`))));
  });
}

/** When each word of the line begins, from the per-character timings the API returns. */
function wordStarts(alignment) {
  const words = [];
  let word = '';
  let start = 0;
  alignment.characters.forEach((character, index) => {
    if (/\s/.test(character)) {
      if (word !== '') words.push({ word, start: Number(start.toFixed(3)) });
      word = '';
      return;
    }
    if (word === '') start = alignment.character_start_times_seconds[index];
    word += character;
  });
  if (word !== '') words.push({ word, start: Number(start.toFixed(3)) });
  return words;
}

async function speak(line, { key, voice, model }) {
  const response = await fetch(`${API}/${voice}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: line.text, model_id: model }),
  });
  if (!response.ok) {
    // The body says why (bad voice, no credit left, ...). It never holds the key.
    throw new Error(`ElevenLabs refused "${line.id}" (${response.status}): ${(await response.text()).slice(0, 400)}`);
  }
  const body = await response.json();
  if (typeof body.audio_base64 !== 'string' || body.alignment === undefined || body.alignment === null) {
    throw new Error(`ElevenLabs answered "${line.id}" without audio or word timings`);
  }
  return { audio: Buffer.from(body.audio_base64, 'base64'), words: wordStarts(body.alignment) };
}

const envFlag = process.argv.indexOf('--env');
const fromFile = envFlag === -1 ? {} : await settingsFrom(process.argv[envFlag + 1]);
const key = fromFile.ELEVENLABS_API_KEY ?? process.env.ELEVENLABS_API_KEY;
if (key === undefined || key === '') {
  throw new Error('no ELEVENLABS_API_KEY: pass --env <file with it> or set it in the environment');
}
const voice = fromFile.ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
const modelFlag = process.argv.indexOf('--model');
const model = modelFlag === -1 ? DEFAULT_MODEL : process.argv[modelFlag + 1];

await mkdir(OUT, { recursive: true });
const before = await readFile(MANIFEST, 'utf8').then(JSON.parse, () => ({ lines: {} }));
const lines = {};
let spent = 0;
for (const line of LINES) {
  const hash = createHash('sha256').update(`${voice}|${model}|${line.text}`).digest('hex').slice(0, 16);
  const file = path.join(OUT, `${line.id}.mp3`);
  const kept = before.lines?.[line.id];
  if (kept !== undefined && kept.hash === hash) {
    lines[line.id] = kept;
    continue;
  }
  const spoken = await speak(line, { key, voice, model });
  await writeFile(file, spoken.audio);
  spent += line.text.length;
  lines[line.id] = { text: line.text, seconds: Number((await probeSeconds(file)).toFixed(3)), words: spoken.words, hash };
  process.stdout.write(`${line.id}: ${lines[line.id].seconds} s\n`);
}
await writeFile(MANIFEST, `${JSON.stringify({ model, lines }, null, 2)}\n`);
// Lines that are no longer in the film leave no audio behind.
for (const file of await readdir(OUT)) {
  if (file.endsWith('.mp3') && lines[file.slice(0, -4)] === undefined) await rm(path.join(OUT, file));
}
const total = Object.values(lines).reduce((sum, line) => sum + line.seconds, 0);
process.stdout.write(`${LINES.length} lines, ${total.toFixed(1)} s of speech, model ${model}; ${spent} characters asked for in this run\n`);
