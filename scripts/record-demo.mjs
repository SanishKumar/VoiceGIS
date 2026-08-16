/**
 * Record the README demo animation.
 *
 * Builds the demo, serves it, drives a scripted session in Chrome, and encodes
 * the frames as an animated GIF. Regenerate with:
 *
 *   node scripts/record-demo.mjs
 *
 * Uses only packages already present for development (Playwright, and sharp,
 * which arrives with the Whisper toolchain). Nothing here ships in the
 * published package.
 */

import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(root, 'docs/media/demo.gif');

const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1000, height: 560 };
const GIF_WIDTH = 800;

const TYPING_MS = 90;   // one frame per few characters, so typing reads naturally
const RESULT_MS = 1900; // long enough to read the plan and the map
const BEAT_MS = 800;

/** @type {Array<{ image: Buffer, delay: number }>} */
const frames = [];

function wait(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function serve() {
  const server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--config', 'vite.demo.config.js', '--host', '127.0.0.1',
      '--port', String(PORT), '--strictPort'],
    { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' }
  );

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return server;
    } catch { /* not up yet */ }
    await wait(500);
  }
  server.kill();
  throw new Error(`preview server did not start on ${PORT}`);
}

async function capture(page, delay) {
  frames.push({ image: await page.screenshot({ type: 'png' }), delay });
}

/** Type into the command bar so the viewer sees the sentence being written. */
async function typeCommand(page, text) {
  await page.fill('#command-input', '');
  for (const chunk of text.match(/.{1,6}/g)) {
    await page.type('#command-input', chunk, { delay: 0 });
    await capture(page, TYPING_MS);
  }
}

async function run(page, hold = RESULT_MS) {
  await page.click('#run-button');
  await page.waitForFunction(
    () => document.getElementById('plan-status')?.textContent?.trim() !== 'running',
    null,
    { timeout: 20_000 }
  );
  // Let the map animation and marker restyle finish before the held frame.
  await wait(900);
  await capture(page, hold);
}

async function main() {
  console.log('building demo…');
  execSync('npm run build:demo', { cwd: root, stdio: 'inherit' });

  const { chromium } = await import('@playwright/test');
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    throw new Error('sharp is required to encode the GIF; run npm install first.');
  }

  const server = await serve();
  const browser = await chromium.launch({ channel: 'chrome' });

  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();

    await page.goto(BASE);
    await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
    await page.waitForFunction(
      () => document.getElementById('stat-shown')?.textContent?.trim() !== '—'
    );
    await wait(2500); // let tiles settle
    await capture(page, BEAT_MS);

    // 1. A catalog-grounded filter.
    await typeCommand(page, 'show earthquakes where magnitude is greater than 5');
    await run(page);

    // 2. Navigation resolved from the bundled gazetteer, by bounds.
    await typeCommand(page, 'go to India and zoom in');
    await run(page);

    // 3. A proximity query composed against the cities layer.
    await page.fill('#command-input', 'clear filters');
    await run(page, BEAT_MS);
    await typeCommand(page, 'select earthquakes within 300 kilometers of cities');
    await run(page);

    // 4. The policy stopping an export nobody authorised.
    await page.locator('.perm:has(input[value="export"])').click();
    await wait(400);
    await capture(page, BEAT_MS);
    await typeCommand(page, 'export selection as geojson');
    await run(page, 2600);

    await context.close();
  } finally {
    await browser.close();
    server.kill();
  }

  const total = frames.reduce((sum, frame) => sum + frame.delay, 0);
  console.log(`encoding ${frames.length} frames, ${(total / 1000).toFixed(1)}s…`);

  const resized = await Promise.all(
    frames.map((frame) => sharp(frame.image).resize({ width: GIF_WIDTH }).png().toBuffer())
  );

  // Per-frame delays must be an array: a scalar only sets the first frame.
  // libvips merges visually identical neighbours and sums their delays, so
  // the page count can come out lower than the frame count without changing
  // the timing.
  const gif = await sharp(resized, { join: { animated: true } })
    .gif({ delay: frames.map((frame) => frame.delay), loop: 0, colours: 128, dither: 0.5 })
    .toBuffer();

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, gif);

  const meta = await sharp(gif, { animated: true }).metadata();
  const encoded = (meta.delay || []).reduce((sum, value) => sum + value, 0);
  console.log(`wrote ${OUTPUT} — ${(gif.length / 1024 / 1024).toFixed(2)} MB, `
    + `${meta.pages} pages, ${(encoded / 1000).toFixed(1)}s`);

  if (Math.abs(encoded - total) > 200) {
    throw new Error(`encoded duration ${encoded}ms does not match captured ${total}ms`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
