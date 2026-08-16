/**
 * The test base for this suite.
 *
 * Two guarantees every spec inherits:
 *
 * 1. **No external network.** A single route handler serves every request.
 *    Same-origin requests go to the preview server, the two known third
 *    parties are answered from fixtures, and anything else is aborted and
 *    recorded. The suite therefore passes with outbound networking blocked,
 *    and a newly introduced CDN dependency fails the run instead of silently
 *    working on a developer's machine.
 *
 * 2. **Errors fail the test.** An uncaught page error or a `console.error`
 *    fails the test that caused it, rather than leaving a broken page to
 *    produce a confusing assertion failure later.
 */

import { test as base, expect } from '@playwright/test';
import { QUAKE_FIXTURE, TILE_PNG } from './fixtures-data.js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Per-page collections the fixtures below assert on. */
const externalHits = new WeakMap();
const pageErrors = new WeakMap();

/**
 * Serve every request locally. Returns the array of blocked external URLs.
 * @param {import('@playwright/test').Page} page
 */
async function installNetworkGuard(page) {
  const blocked = [];
  externalHits.set(page, blocked);

  // One handler for everything: no reliance on route-precedence rules.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());

    if (url.protocol === 'data:' || url.protocol === 'blob:') {
      return route.continue();
    }
    if (LOCAL_HOSTS.has(url.hostname)) {
      return route.continue();
    }
    if (url.hostname.endsWith('earthquake.usgs.gov')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(QUAKE_FIXTURE),
      });
    }
    if (url.hostname.endsWith('basemaps.cartocdn.com')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG });
    }

    blocked.push(url.toString());
    return route.abort('blockedbyclient');
  });

  return blocked;
}

/**
 * Fail as soon as the page reports a problem.
 * @param {import('@playwright/test').Page} page
 */
export function assertNoPageErrors(page) {
  const errors = pageErrors.get(page) || [];
  if (errors.length > 0) {
    throw new Error(`Page reported ${errors.length} error(s):\n  ${errors.join('\n  ')}`);
  }
}

/** External URLs the guard refused, for assertions inside a spec. */
export function blockedExternalRequests(page) {
  return externalHits.get(page) || [];
}

/**
 * Discard recorded errors and blocked requests.
 *
 * For the one test that trips the guard on purpose: a blocked request also
 * logs a console error, and the teardown assertions would otherwise fail the
 * test that proved the guard works.
 *
 * @param {import('@playwright/test').Page} page
 */
export function resetPageRecords(page) {
  (pageErrors.get(page) || []).length = 0;
  (externalHits.get(page) || []).length = 0;
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    pageErrors.set(page, errors);

    page.on('pageerror', (error) => {
      errors.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
    });

    await installNetworkGuard(page);
    await use(page);

    // Teardown assertions: nothing escaped, nothing threw.
    expect(
      blockedExternalRequests(page),
      'the demo must not request anything outside the preview origin'
    ).toEqual([]);
    expect(errors, 'the page must not log errors').toEqual([]);
  },
});

export { expect };
