// Render single frames of the film, to look at before rendering all of it.
//   node scripts/stills.mjs <out-dir> <scale> <frame> [<frame> ...]
import path from 'node:path';

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const [outDir, scale, ...frames] = process.argv.slice(2);
if (outDir === undefined || scale === undefined || frames.length === 0) {
  throw new Error('usage: node scripts/stills.mjs <out-dir> <scale> <frame> [<frame> ...]');
}
const root = path.resolve(import.meta.dirname, '..');
const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.ts'), publicDir: path.join(root, 'public') });
const composition = await selectComposition({ serveUrl, id: 'Promo' });
process.stdout.write(`the film is ${composition.durationInFrames} frames, ${(composition.durationInFrames / composition.fps).toFixed(1)} s\n`);
for (const frame of frames.map(Number)) {
  const output = path.join(outDir, `f${String(frame).padStart(4, '0')}.jpeg`);
  await renderStill({ composition, serveUrl, frame, output, scale: Number(scale), imageFormat: 'jpeg', jpegQuality: 88 });
  process.stdout.write(`${output}\n`);
}
