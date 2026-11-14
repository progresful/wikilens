// Records the real WikiLens page for the film: a headless browser at twice the pixel density,
// its frames taken straight from the browser's own screencast (no lossy screen recorder in
// between), a pointer drawn into the page because a headless browser has none, and the
// moments and places the film later cuts and zooms to written next to the video.
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

export const STAGE = { width: 1600, height: 900, scale: 2 };
export const FOOTAGE_FPS = 60;

const JPEG_QUALITY = 92;
const TAIL_SECONDS = 1;       // the last picture is held this long past the end, so a cut never runs out of film
const STEP_MS = 1000 / 60;

// Drawn into the page before its own scripts run. It only follows the mouse and shows presses.
const POINTER_SCRIPT = `(() => {
  const ARROW = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="30" viewBox="0 0 26 30">'
    + '<path d="M3 2v21l5.2-4.9 3.6 8.4 3.9-1.7-3.6-8.2H19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  let pointer = null;
  let x = -100;
  let y = -100;
  const place = () => {
    if (pointer !== null) pointer.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)';
  };
  const mount = () => {
    if (pointer !== null || document.documentElement === null) return;
    pointer = document.createElement('div');
    pointer.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;'
      + 'filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));will-change:transform;';
    pointer.innerHTML = ARROW;
    document.documentElement.appendChild(pointer);
    place();
  };
  const press = () => {
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;left:' + (x - 16) + 'px;top:' + (y - 16) + 'px;width:32px;height:32px;'
      + 'border-radius:50%;border:2px solid rgba(51,102,204,.9);background:rgba(51,102,204,.18);'
      + 'z-index:2147483646;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out;';
    document.documentElement.appendChild(ring);
    requestAnimationFrame(() => { ring.style.transform = 'scale(2.1)'; ring.style.opacity = '0'; });
    setTimeout(() => ring.remove(), 520);
  };
  addEventListener('mousemove', (event) => { x = event.clientX; y = event.clientY; mount(); place(); }, true);
  addEventListener('mousedown', () => { mount(); press(); }, true);
  addEventListener('DOMContentLoaded', mount);
})();`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}\n${errors.slice(-2000)}`))));
  });
}

/**
 * Open the page and start recording it. Returns the page, the helpers that move the pointer
 * like a hand would, and finish(), which stops the recording and writes <name>.mp4 and
 * <name>.json (marks in seconds from the first frame, boxes in page pixels) into outDir.
 */
export async function record({ name, url, outDir, framesDir, ready }) {
  const dir = path.join(framesDir, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  // The scale is set on the browser itself, not emulated per page: only then does the screencast
  // come out in device pixels (3200 x 1800) rather than page pixels.
  const browser = await chromium.launch({
    args: [`--force-device-scale-factor=${STAGE.scale}`, `--window-size=${STAGE.width},${STAGE.height}`],
  });
  const context = await browser.newContext({ viewport: null, locale: 'en-GB' });
  const page = await context.newPage();
  await page.addInitScript(POINTER_SCRIPT);
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  await page.goto(url);
  await ready(page);

  const frames = [];
  const writes = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
    frames.push({ file, t: metadata.timestamp });
    writes.push(writeFile(file, Buffer.from(data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: JPEG_QUALITY, everyNthFrame: 1,
    maxWidth: STAGE.width * STAGE.scale, maxHeight: STAGE.height * STAGE.scale,
  });

  const started = Date.now() / 1000;
  const marks = [];
  const boxes = {};
  let mouse = { x: STAGE.width / 2, y: STAGE.height + 40 };

  const stage = {
    page,
    wait: sleep,
    /** Note a moment the film will cut or zoom on. */
    mark(label) {
      marks.push({ label, t: Date.now() / 1000 });
    },
    /** Note where an element is, in page pixels, under a name the film refers to. */
    async box(label, selector) {
      const found = await page.locator(selector).first().boundingBox();
      if (found === null) throw new Error(`${name}: nothing matches ${selector}`);
      boxes[label] = found;
      return found;
    },
    /**
     * Move the pointer to a point, easing in and out, in `ms`. Where the pointer is depends on the
     * clock, not on how many moves were sent, so a busy browser makes the move coarser, not longer.
     */
    async glide(to, ms = 650, ease = easeInOut) {
      const from = mouse;
      const begun = Date.now();
      for (;;) {
        const k = Math.min(1, (Date.now() - begun) / ms);
        const eased = ease(k);
        mouse = { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
        await page.mouse.move(mouse.x, mouse.y);
        if (k >= 1) return;
        await sleep(STEP_MS);
      }
    },
    /** Move the pointer onto an element (a point inside it, as fractions of its box). */
    async glideTo(selector, { fx = 0.5, fy = 0.5, ms = 650 } = {}) {
      const found = await page.locator(selector).first().boundingBox();
      if (found === null) throw new Error(`${name}: nothing matches ${selector}`);
      await stage.glide({ x: found.x + found.width * fx, y: found.y + found.height * fy }, ms);
    },
    async click() {
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
    },
    async type(text, perKey = 46) {
      for (const key of text) {
        await page.keyboard.type(key);
        await sleep(perKey * (0.6 + Math.random() * 0.8));
      }
    },
    async finish() {
      await sleep(250);
      const ended = Date.now() / 1000 - started;
      await cdp.send('Page.stopScreencast');
      await Promise.all(writes);
      await browser.close();
      if (frames.length < 2) throw new Error(`${name}: the browser gave no frames`);
      // Time zero is the moment recording began. The first frame the browser hands over is the page as
      // it already stood, stamped when it was painted, which can be seconds earlier: it is moved to zero.
      const at = (frame) => Math.max(0, frame.t - started);
      // The browser sends a frame only when the page changes, so each is held until the next one, and
      // the last until the take ended and a little longer. ffmpeg lays them on an even 60 fps grid.
      const seconds = ended + TAIL_SECONDS;
      const lines = frames.flatMap((frame, index) => {
        const next = frames[index + 1];
        const until = next === undefined ? seconds : at(next);
        return [`file '${frame.file}'`, `duration ${Math.max(1 / FOOTAGE_FPS, until - at(frame)).toFixed(6)}`];
      });
      const list = path.join(dir, 'frames.txt');
      await writeFile(list, `${lines.join('\n')}\nfile '${frames[frames.length - 1].file}'\n`);
      const video = path.join(outDir, `${name}.mp4`);
      await run('ffmpeg', [
        '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', `fps=${FOOTAGE_FPS},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '14',
        '-g', '30', '-movflags', '+faststart', video,
      ]);
      const report = {
        name, fps: FOOTAGE_FPS, width: STAGE.width, height: STAGE.height, scale: STAGE.scale,
        seconds: Number(seconds.toFixed(3)), capturedFrames: frames.length,
        // Browser frames are stamped by the browser, marks by this process: same clock, same machine.
        marks: Object.fromEntries(marks.map((mark) => [mark.label, Number((mark.t - started).toFixed(3))])),
        boxes, problems,
      };
      await writeFile(path.join(outDir, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
      await rm(dir, { recursive: true, force: true });
      return report;
    },
  };
  return stage;
}
