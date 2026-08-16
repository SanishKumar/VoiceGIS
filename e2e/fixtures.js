/**
 * Page helpers shared by the specs. Network stubbing and error capture live
 * in `test.js`, which every spec imports its `test` from.
 */

import { expect } from '@playwright/test';
import { assertNoPageErrors } from './test.js';

export {
  ABOVE_M5,
  AT_LEAST_M6,
  IN_JAPAN,
  QUAKE_FIXTURE,
  TOTAL_QUAKES,
} from './fixtures-data.js';

/**
 * Load the demo and wait until its data is in place.
 * @param {import('@playwright/test').Page} page
 */
export async function openDemo(page) {
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForFunction(
    () => document.getElementById('stat-shown')?.textContent?.trim() !== '—'
  );
  assertNoPageErrors(page);
}

/**
 * Type a command and run it, waiting for the pipeline to settle.
 *
 * Checks for page errors afterwards so a broken run surfaces here rather than
 * as a puzzling assertion failure further down the test.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} command
 */
export async function runCommand(page, command) {
  await page.fill('#command-input', command);
  await page.click('#run-button');
  await page.waitForFunction(
    () => document.getElementById('plan-status')?.textContent?.trim() !== 'running'
  );
  assertNoPageErrors(page);
}

/**
 * The current state of each pipeline stage.
 * @param {import('@playwright/test').Page} page
 */
export function pipelineStages(page) {
  return page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('.pipeline li')]
      .map((node) => [node.dataset.stage, node.dataset.state])
  ));
}

/**
 * The compiled plan as an object.
 *
 * Read via `textContent`, not `innerText`: the disclosure is collapsed by
 * default and `innerText` only returns rendered text.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function compiledPlan(page) {
  const raw = await page.locator('#plan-json').textContent();
  return JSON.parse(raw);
}

/**
 * Toggle a permission.
 *
 * The checkbox is intentionally 1px and transparent — the visible control is
 * its label — so drive the label rather than the input.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {boolean} enabled
 */
export async function setPermission(page, name, enabled) {
  const input = page.locator(`.perm input[value="${name}"]`);
  if (await input.isChecked() === enabled) return;
  await page.locator(`.perm:has(input[value="${name}"])`).click();
  await page.waitForFunction(
    ({ value, want }) => document.querySelector(`.perm input[value="${value}"]`)?.checked === want,
    { value: name, want: enabled }
  );
}

/**
 * Bounding rectangles for a set of selectors, in viewport coordinates.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, string>} selectors
 */
export function rects(page, selectors) {
  return page.evaluate((map) => Object.fromEntries(
    Object.entries(map).map(([name, selector]) => {
      const node = document.querySelector(selector);
      if (!node) return [name, null];
      const { top, right, bottom, left, width, height } = node.getBoundingClientRect();
      return [name, { top, right, bottom, left, width, height }];
    })
  ), selectors);
}

/** Whether two rectangles share any area. */
export function overlaps(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Assert that two on-screen elements do not cover each other.
 *
 * Viewport-visibility checks miss occlusion entirely: an element can sit
 * inside the viewport and still be hidden under a sticky bar.
 */
export function expectNoOverlap(rectA, rectB, message) {
  expect(
    { overlapping: overlaps(rectA, rectB), a: rectA, b: rectB },
    message
  ).toMatchObject({ overlapping: false });
}
