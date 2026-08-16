import { blockedExternalRequests, expect, resetPageRecords, test } from './test.js';
import {
  ABOVE_M5,
  AT_LEAST_M6,
  IN_JAPAN,
  TOTAL_QUAKES,
  expectNoOverlap,
  openDemo,
  pipelineStages,
  rects,
  runCommand,
  setPermission,
} from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await openDemo(page);
});

/* ------------------------------------------------------- the screenshot flow */

test('compiles, executes, and reports counts from the real features', async ({ page }, testInfo) => {
  await expect(page.locator('#stat-shown')).toHaveText(String(TOTAL_QUAKES));

  await runCommand(page, 'show earthquakes where magnitude is greater than 5');

  await expect(page.locator('#plan-status')).toHaveText('succeeded');
  await expect(page.locator('.op')).toHaveCount(2);
  await expect(page.locator('.op-detail').nth(1)).toContainText('Magnitude > 5');
  await expect(page.locator('.op-result').last())
    .toHaveText(`${ABOVE_M5} of ${TOTAL_QUAKES} features match`);
  await expect(page.locator('#stat-shown')).toHaveText(String(ABOVE_M5));

  await testInfo.attach('filter-applied.png', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
});

test('a regional filter frames the region; a global one leaves the view alone', async ({ page }) => {
  const world = await page.evaluate(() => window.voicegis.view());

  // Japan's two events are close together, so the map should fly to them.
  await runCommand(page, 'show earthquakes where place contains japan');
  await expect(page.locator('.op-result').last())
    .toHaveText(`${IN_JAPAN} of ${TOTAL_QUAKES} features match`);
  const regional = await page.evaluate(() => window.voicegis.view());
  expect(regional.zoom).toBeGreaterThan(world.zoom);

  // The M5+ set spans Japan, California and Chile — fitting that would just
  // zoom back out, so the view is left where the user put it.
  await runCommand(page, 'clear filters');
  await runCommand(page, 'show earthquakes where magnitude is greater than 5');
  const global = await page.evaluate(() => window.voicegis.view());
  expect(global).toEqual(regional);
});

test('counting reports a number without touching the map', async ({ page }) => {
  await runCommand(page, 'count earthquakes where magnitude is at least 6');

  await expect(page.locator('#plan-status')).toHaveText('succeeded');
  await expect(page.locator('.op-result').last()).toHaveText(`${AT_LEAST_M6} features`);
  // A count is a read: nothing is filtered out.
  await expect(page.locator('#stat-shown')).toHaveText(String(TOTAL_QUAKES));
});

/* ------------------------------------------------ pipeline classification */

test('an unparseable command fails at Compile', async ({ page }) => {
  await runCommand(page, 'flurbulate the quantum mesh');

  expect(await pipelineStages(page)).toEqual({
    compile: 'failed', ground: 'skipped', authorize: 'skipped', execute: 'skipped',
  });
  await expect(page.locator('#plan-status')).toHaveText('needs input');
  await expect(page.locator('#pipeline-note')).toContainText('parsed');
});

test('an unknown field fails at Ground, not Compile', async ({ page }) => {
  await runCommand(page, 'show earthquakes where rainfall is above 5');

  expect(await pipelineStages(page)).toEqual({
    compile: 'done', ground: 'failed', authorize: 'skipped', execute: 'skipped',
  });
  await expect(page.locator('.issue[data-code="unknown_field"]')).toBeVisible();
  await expect(page.locator('#pipeline-note')).toContainText('catalog');
});

test('an unknown place fails at Ground and offers suggestions', async ({ page }) => {
  await runCommand(page, 'go to Atlantis');

  expect(await pipelineStages(page)).toEqual({
    compile: 'done', ground: 'failed', authorize: 'skipped', execute: 'skipped',
  });
  const issue = page.locator('.issue[data-code="unknown_place"]');
  await expect(issue).toBeVisible();
  await expect(issue.locator('.suggestion').first()).toBeVisible();
});

test('a denied permission fails at Authorize, not Ground', async ({ page }) => {
  await setPermission(page, 'export', false);
  await runCommand(page, 'export selection as geojson');

  expect(await pipelineStages(page)).toEqual({
    compile: 'done', ground: 'done', authorize: 'failed', execute: 'skipped',
  });
  await expect(page.locator('.issue[data-code="policy_denied"]')).toBeVisible();
  await expect(page.locator('#plan-status')).toHaveText('blocked');
  await expect(page.locator('#pipeline-note')).toContainText('policy');
});

test('an adapter error fails at Execute, with the earlier stages green', async ({ page }) => {
  // Nothing is selected, so the export adapter throws at run time.
  await runCommand(page, 'export selection as geojson');
  await page.click('#confirm-accept');
  await page.waitForFunction(
    () => document.getElementById('plan-status')?.textContent?.trim() !== 'running'
  );

  expect(await pipelineStages(page)).toEqual({
    compile: 'done', ground: 'done', authorize: 'done', execute: 'failed',
  });
  await expect(page.locator('.op-result[data-result="failed"]')).toContainText('Nothing to export');
});

test('a half-understood request runs nothing and says so', async ({ page }) => {
  await runCommand(page, 'go to Delhi and show hydrants');

  await expect(page.locator('#plan-status')).toHaveText('needs input');

  // The navigation was recognized...
  await expect(page.locator('.op')).toHaveCount(1);
  // ...and explicitly marked as not run.
  await expect(page.locator('.op')).toHaveAttribute('data-result', 'not_executed');

  const note = page.locator('#atomic-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('1 recognized operation did not run');
  await expect(note).toContainText('executed as a whole');
});

/* ------------------------------------------------------------ confirmation */

test('a confirmation-gated operation runs only after approval', async ({ page }) => {
  await runCommand(page, 'select earthquakes within 300 kilometers of cities');
  const selected = await page.locator('#stat-selected').innerText();
  expect(Number(selected)).toBeGreaterThan(0);

  // Cancel: no buffers drawn.
  await runCommand(page, 'buffer selection by 50 kilometers');
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.click('#confirm-cancel');
  await page.waitForFunction(
    () => document.getElementById('plan-status')?.textContent?.trim() !== 'running'
  );
  await expect(page.locator('#plan-status')).toHaveText('cancelled');
  expect(await page.evaluate(
    () => document.querySelectorAll('.leaflet-overlay-pane path').length
  )).toBe(0);

  // Accept: buffers appear.
  await runCommand(page, 'buffer selection by 50 kilometers');
  await page.click('#confirm-accept');
  await page.waitForFunction(
    () => document.getElementById('plan-status')?.textContent?.trim() !== 'running'
  );
  await expect(page.locator('#plan-status')).toHaveText('succeeded');
  await expect(page.locator('.op-result').last()).toContainText('buffers at 50,000 m');
});

/* ------------------------------------------------- permissions and layout */

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: 'mobile 375x812', width: 375, height: 812 },
];

for (const viewport of VIEWPORTS) {
  test(`pipeline, permissions and tabs stay reachable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(300); // debounced map resize

    // No horizontal overflow at any width.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // Every permission control is present and hit-testable.
    await expect(page.locator('.perm')).toHaveCount(4);
    for (const value of ['view', 'query', 'analysis', 'export']) {
      await expect(page.locator(`.perm:has(input[value="${value}"])`)).toBeVisible();
    }

    // The controls must not be buried inside the panel's own scroll area.
    const buried = await page.evaluate(() => {
      const scroller = document.getElementById('side-scroll');
      const controls = ['pipeline', 'permissions', 'tab-plan', 'tab-catalog'];
      return controls.filter((id) => scroller.contains(document.getElementById(id)));
    });
    expect(buried).toEqual([]);

    // And they must be inside the viewport without scrolling anything.
    const offscreen = await page.evaluate(() => {
      const ids = ['pipeline', 'permissions', 'tab-plan', 'tab-catalog'];
      return ids.filter((id) => {
        const rect = document.getElementById(id).getBoundingClientRect();
        return rect.width === 0 || rect.height === 0
          || rect.top < 0 || rect.bottom > window.innerHeight;
      });
    });
    expect(offscreen).toEqual([]);

    // Being inside the viewport is not the same as being visible: the sticky
    // command bar can sit on top. Check the actual rectangles.
    const box = await rects(page, {
      console: '.console',
      command: '.command',
      pipeline: '#pipeline',
      permissions: '#permissions',
      tabs: '.tabs',
      stats: '.map-stats',
      zoom: '.leaflet-control-zoom',
      legend: '.map-legend',
    });

    expectNoOverlap(box.permissions, box.console,
      'the permissions control must not sit under the command bar');
    expectNoOverlap(box.pipeline, box.console,
      'the pipeline must not sit under the command bar');
    expectNoOverlap(box.tabs, box.console,
      'the tab bar must not sit under the command bar');
    expectNoOverlap(box.stats, box.zoom,
      'the map statistics must not sit under the zoom control');
    expectNoOverlap(box.stats, box.legend,
      'the map statistics must not overlap the legend');
  });
}

test('the command bar clears the panel controls at every scroll position', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(300);

  const positions = [0, 200, 400, 99_999];
  for (const top of positions) {
    await page.evaluate((y) => window.scrollTo(0, y), top);
    await page.waitForTimeout(120);

    const box = await rects(page, {
      console: '.console',
      permissions: '#permissions',
      pipeline: '#pipeline',
      tabs: '.tabs',
    });

    expectNoOverlap(box.permissions, box.console,
      `permissions must clear the command bar at scrollY ${top}`);
    expectNoOverlap(box.pipeline, box.console,
      `pipeline must clear the command bar at scrollY ${top}`);
    expectNoOverlap(box.tabs, box.console,
      `tabs must clear the command bar at scrollY ${top}`);
  }
});

test('the last panel content can be scrolled clear of the command bar', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.click('#tab-catalog');
  await page.evaluate(() => window.scrollTo(0, 99_999));
  await page.waitForTimeout(200);

  const box = await rects(page, {
    console: '.console',
    lastCard: '#panel-catalog .places',
  });
  expectNoOverlap(box.lastCard, box.console,
    'the final catalog card must be readable above the command bar');
});

test('permission changes take effect immediately', async ({ page }) => {
  await setPermission(page, 'query', false);
  await runCommand(page, 'show earthquakes where magnitude is greater than 5');
  await expect(page.locator('#plan-status')).toHaveText('blocked');

  await setPermission(page, 'query', true);
  await runCommand(page, 'show earthquakes where magnitude is greater than 5');
  await expect(page.locator('#plan-status')).toHaveText('succeeded');
});

/* -------------------------------------------------------------------- tabs */

test('Plan is the default tab and Catalog is reachable', async ({ page }) => {
  await expect(page.locator('#tab-plan')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-plan')).toBeVisible();
  await expect(page.locator('#panel-catalog')).toBeHidden();

  await page.click('#tab-catalog');
  await expect(page.locator('#panel-catalog')).toBeVisible();
  await expect(page.locator('#panel-plan')).toBeHidden();
  await expect(page.locator('.cat-layer')).toHaveCount(2);
  await expect(page.locator('#places .place-chip').first()).toBeVisible();

  // Running a command brings the Plan tab back, since that is the answer.
  await runCommand(page, 'count earthquakes');
  await expect(page.locator('#tab-plan')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-plan')).toBeVisible();
});

test('no accordion collapses the panel structure', async ({ page }) => {
  // The only <details> in the side panel is the raw JSON disclosure.
  const details = await page.locator('.side details').count();
  expect(details).toBeLessThanOrEqual(1);
});

/* --------------------------------------------------------- network guard */

test('the demo loads no third-party code', async ({ page }) => {
  const hosts = new Set();
  page.on('request', (request) => hosts.add(new URL(request.url()).host));

  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  await runCommand(page, 'count earthquakes');

  // Scripts and styles are same-origin: Leaflet is bundled, not fetched.
  const scriptHosts = await page.evaluate(() => [
    ...[...document.querySelectorAll('script[src]')].map((n) => new URL(n.src).host),
    ...[...document.querySelectorAll('link[rel="stylesheet"]')].map((n) => new URL(n.href).host),
  ]);
  expect([...new Set(scriptHosts)]).toEqual([new URL(page.url()).host]);

  // Nothing was refused, because nothing unexpected was asked for.
  expect(blockedExternalRequests(page)).toEqual([]);
});

test('the network guard actually blocks an external request', async ({ page }) => {
  // A guard that never fires proves nothing, so make it fire on purpose.
  const status = await page.evaluate(async () => {
    try {
      await fetch('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
      return 'allowed';
    } catch {
      return 'blocked';
    }
  });

  expect(status).toBe('blocked');
  expect(blockedExternalRequests(page)).toEqual([
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  ]);

  // A blocked request also logs a console error. This test tripped the guard
  // deliberately, so clear both records before the teardown assertions.
  resetPageRecords(page);
});
