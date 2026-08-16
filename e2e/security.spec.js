import { expect, test } from './test.js';
import { openDemo, runCommand } from './fixtures.js';

/**
 * A command is data. These tests fail if any user-derived string ever reaches
 * the page as markup instead of text.
 */

const PAYLOADS = [
  '<img src=x onerror="window.__xssFired = true">',
  '<script>window.__xssFired = true</script>',
  '<svg onload="window.__xssFired = true">',
  '"><iframe src="javascript:window.__xssFired=true"></iframe>',
  '<a href="javascript:window.__xssFired=true">click</a>',
];

/** Elements a payload would create if any of it were parsed as markup. */
async function injectedNodes(page) {
  return page.evaluate(() => {
    const scope = document.querySelector('.side');
    const all = [...scope.querySelectorAll('*')];
    return {
      images: scope.querySelectorAll('img').length,
      scripts: scope.querySelectorAll('script').length,
      svg: scope.querySelectorAll('svg').length,
      iframes: scope.querySelectorAll('iframe').length,
      anchors: scope.querySelectorAll('a').length,
      // Any inline event handler attribute at all.
      inlineHandlers: all.filter((node) => node.getAttributeNames()
        .some((name) => name.toLowerCase().startsWith('on'))).length,
      javascriptUrls: all.filter((node) => {
        const href = node.getAttribute?.('href') || node.getAttribute?.('src') || '';
        return href.toLowerCase().includes('javascript:');
      }).length,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.__xssFired = false; });
  await openDemo(page);
});

test('HTML typed as a command is displayed as text, never parsed', async ({ page }) => {
  for (const payload of PAYLOADS) {
    await runCommand(page, payload);

    // The literal payload is visible to the reader...
    const issueText = await page.locator('#plan-issues').innerText();
    expect(issueText).toContain(payload);

    // ...but produced no nodes and no handlers.
    const nodes = await injectedNodes(page);
    expect(nodes).toMatchObject({
      images: 0,
      scripts: 0,
      svg: 0,
      iframes: 0,
      anchors: 0,
      inlineHandlers: 0,
      javascriptUrls: 0,
    });
    expect(await page.evaluate(() => window.__xssFired)).toBe(false);
  }
});

test('a payload inside a predicate value is escaped in the operation detail', async ({ page }) => {
  const payload = '<img src=x onerror="window.__xssFired = true">';
  await runCommand(page, `filter earthquakes where place contains ${payload}`);

  const detail = page.locator('#plan-operations .op-detail').first();
  await expect(detail).toBeVisible();
  // The predicate value is rendered verbatim as text.
  expect(await detail.innerText()).toContain('<img src=x onerror=');

  const nodes = await injectedNodes(page);
  expect(nodes.images).toBe(0);
  expect(nodes.inlineHandlers).toBe(0);
  expect(await page.evaluate(() => window.__xssFired)).toBe(false);
});

test('a payload naming an unknown layer is escaped in the issue message', async ({ page }) => {
  const payload = '<b onmouseover="window.__xssFired=true">pwn</b>';
  await runCommand(page, `show ${payload} where magnitude is above 1`);

  const nodes = await injectedNodes(page);
  expect(nodes.inlineHandlers).toBe(0);
  expect(await page.locator('#plan-issues').innerText()).toContain('<b onmouseover=');
  // No <b> was created inside the panel.
  expect(await page.locator('.side b').count()).toBe(0);
  expect(await page.evaluate(() => window.__xssFired)).toBe(false);
});

test('a payload surviving into an adapter error is escaped', async ({ page }) => {
  // Export with nothing selected: the adapter throws, and its message quotes
  // the operation source.
  await runCommand(page, 'export selection as geojson');
  await page.click('#confirm-accept');
  await page.waitForFunction(
    () => document.getElementById('plan-status')?.textContent?.trim() !== 'running'
  );

  const result = page.locator('.op-result[data-result="failed"]');
  await expect(result).toBeVisible();
  expect(await result.innerText()).toContain('failed');

  const nodes = await injectedNodes(page);
  expect(nodes.inlineHandlers).toBe(0);
  expect(await page.evaluate(() => window.__xssFired)).toBe(false);
});

test('the typed plan JSON disclosure renders as text', async ({ page }) => {
  const payload = '</code><img src=x onerror="window.__xssFired=true">';
  await runCommand(page, payload);

  await page.locator('#plan-raw summary').click();
  const json = await page.locator('#plan-json').innerText();
  expect(json).toContain('"input"');

  const nodes = await injectedNodes(page);
  expect(nodes.images).toBe(0);
  expect(await page.evaluate(() => window.__xssFired)).toBe(false);
});

test('the confirmation dialog escapes operation detail', async ({ page }) => {
  await runCommand(page, 'buffer selection by 50 kilometers');

  const body = page.locator('#confirm-body');
  await expect(body).toBeVisible();
  expect(await page.locator('#confirm-body img').count()).toBe(0);
  expect(await page.evaluate(() => {
    const node = document.getElementById('confirm-body');
    return [...node.querySelectorAll('*')]
      .filter((child) => child.getAttributeNames().some((n) => n.startsWith('on'))).length;
  })).toBe(0);

  await page.click('#confirm-cancel');
});
