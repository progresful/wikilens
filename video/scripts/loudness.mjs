// Bring the film's sound to the loudness online video is played at (-16 LUFS, peaks under -1.5 dB),
// measuring first and then applying, without touching the picture.
//   node scripts/loudness.mjs out/wikilens-promo.mp4
import { spawn } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';

const TARGET = 'I=-16:TP=-1.5:LRA=11';
const file = process.argv[2];
if (file === undefined) throw new Error('usage: node scripts/loudness.mjs <film.mp4>');

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostats', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    child.stderr.on('data', (chunk) => { log += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(log) : reject(new Error(`ffmpeg exited ${code}\n${log.slice(-1500)}`))));
  });
}

const measuredLog = await ffmpeg(['-i', file, '-af', `loudnorm=${TARGET}:print_format=json`, '-f', 'null', '-']);
const json = measuredLog.slice(measuredLog.lastIndexOf('{'), measuredLog.lastIndexOf('}') + 1);
const measured = JSON.parse(json);
const apply = `loudnorm=${TARGET}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}`
  + `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}`;
const finished = file.replace(/\.mp4$/, '.loud.mp4');
await ffmpeg(['-y', '-i', file, '-c:v', 'copy', '-af', apply, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart', finished]);
await rm(file);
await rename(finished, file);
process.stdout.write(`sound: was ${measured.input_i} LUFS (peak ${measured.input_tp} dB), now aimed at -16 LUFS\n`);
