import { blockedExternalRequests, expect, test } from './test.js';
import { compiledPlan, openDemo, pipelineStages, runCommand } from './fixtures.js';

/** The Leaflet view the demo is currently showing. */
const mapView = (page) => page.evaluate(() => window.voicegis.view());

/** India's bundled extent, for containment assertions. */
const INDIA_BOUNDS = [[6.55, 68.11], [35.67, 97.4]];

test.beforeEach(async ({ page }) => {
  await openDemo(page);
});

test('"go to India and zoom in" frames the country by bounds', async ({ page }) => {
  const world = await mapView(page);

  await runCommand(page, 'go to India and zoom in');

  await expect(page.locator('#plan-status')).toHaveText('succeeded');
  expect(await pipelineStages(page)).toEqual({
    compile: 'done', ground: 'done', authorize: 'done', execute: 'done',
  });

  await expect(page.locator('.op')).toHaveCount(2);
  const detail = await page.locator('.op-detail').first().innerText();
  expect(detail).toContain('frame India');
  expect(detail).toContain('bounds');

  // The plan carries bounds, not a point.
  const plan = await compiledPlan(page);
  expect(plan.operations[0].args.bounds).toEqual(INDIA_BOUNDS);
  expect(plan.operations[0].args.center).toBeUndefined();
  expect(plan.operations[0].args.source).toBe('gazetteer');
  expect(plan.operations[1].type).toBe('view.zoom');

  // And the map actually moved there: fitBounds framed the extent, then the
  // second operation zoomed in on top of it.
  const view = await mapView(page);
  expect(view.lat).toBeGreaterThan(INDIA_BOUNDS[0][0]);
  expect(view.lat).toBeLessThan(INDIA_BOUNDS[1][0]);
  expect(view.lng).toBeGreaterThan(INDIA_BOUNDS[0][1]);
  expect(view.lng).toBeLessThan(INDIA_BOUNDS[1][1]);
  expect(view.zoom).toBeGreaterThan(world.zoom);
});

test('"go to Delhi" centres on the city', async ({ page }) => {
  await runCommand(page, 'go to Delhi');

  await expect(page.locator('#plan-status')).toHaveText('succeeded');
  const detail = await page.locator('.op-detail').first().innerText();
  expect(detail).toContain('centre on Delhi');

  const plan = await compiledPlan(page);
  expect(plan.operations[0].args.center).toEqual([28.7041, 77.1025]);
  expect(plan.operations[0].args.bounds).toBeUndefined();

  const view = await mapView(page);
  expect(view.lat).toBeCloseTo(28.7041, 1);
  expect(view.lng).toBeCloseTo(77.1025, 1);
  expect(view.zoom).toBe(9);
});

test('an unknown place is actionable, and its suggestion runs', async ({ page }) => {
  await runCommand(page, 'go to Dehradun');

  await expect(page.locator('#plan-status')).toHaveText('needs input');
  expect(await pipelineStages(page)).toMatchObject({ ground: 'failed' });

  const issue = page.locator('.issue[data-code="unknown_place"]');
  await expect(issue).toBeVisible();
  await expect(issue).toContainText('is not a known place');

  const suggestion = issue.locator('.suggestion').first();
  await expect(suggestion).toBeVisible();
  const suggested = await suggestion.innerText();

  await suggestion.click();
  await page.waitForFunction(
    () => document.getElementById('plan-status')?.textContent?.trim() !== 'running'
  );
  await expect(page.locator('#command-input')).toHaveValue(`go to ${suggested}`);
  await expect(page.locator('#plan-status')).toHaveText('succeeded');
});

test('navigation combined with an invalid command executes nothing', async ({ page }) => {
  await runCommand(page, 'go to Delhi and count sasquatches');

  await expect(page.locator('#plan-status')).toHaveText('needs input');
  await expect(page.locator('.op')).toHaveCount(1);
  await expect(page.locator('.op')).toHaveAttribute('data-result', 'not_executed');
  await expect(page.locator('#atomic-note')).toContainText('did not run');

  // "count sasquatches" parses as a count over an unknown layer, so the
  // request got past Compile and stopped at Ground.
  expect(await pipelineStages(page)).toMatchObject({ compile: 'done', ground: 'failed' });
});

test('a typo in a place name still resolves', async ({ page }) => {
  await runCommand(page, 'go to Dehli');
  await expect(page.locator('#plan-status')).toHaveText('succeeded');
  expect(await page.locator('.op-detail').first().innerText()).toContain('Delhi');
});

test('the gazetteer is listed in the Catalog tab', async ({ page }) => {
  await page.click('#tab-catalog');
  await expect(page.locator('#places .place-chip[data-kind="country"]').first()).toBeVisible();
  await expect(page.locator('.places-note')).toContainText('no geocoding service is called');
});

test('no request is made to a geocoding service', async ({ page }) => {
  const requested = [];
  page.on('request', (request) => requested.push(request.url()));

  await runCommand(page, 'go to India');
  await runCommand(page, 'go to Delhi');
  await runCommand(page, 'go to Atlantis');

  // Nothing resembling a geocoder, and — via the suite-wide network guard —
  // nothing outside the preview origin at all.
  expect(requested.filter((url) => /nominatim|geocod|googleapis|mapbox|opencage/i.test(url)))
    .toEqual([]);
  expect(blockedExternalRequests(page)).toEqual([]);
});
