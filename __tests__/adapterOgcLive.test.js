/**
 * Live integration check for the OGC API - Features adapter.
 *
 * Skipped unless `VOICEGIS_LIVE_OGC=1`, because it needs the public internet
 * and a third-party service that can change or go down. Everything else in
 * the suite runs offline against injected fetches; this exists to prove the
 * CQL2 the adapter emits is accepted by a real conformant implementation.
 *
 *   VOICEGIS_LIVE_OGC=1 npm test -- adapterOgcLive
 *
 * Target: ldproxy's public "zoomstack" demo, which advertises
 * ogcapi-features-3 conf/filter, conf/features-filter, cql2-text, basic-cql2,
 * basic-spatial-functions and advanced-comparison-operators. It deliberately
 * does *not* report `numberMatched`, which exercises the paged count path.
 */

import { OPERATION } from '../src/core/constants.js';
import { createOgcApiFeaturesAdapter } from '../src/adapters/ogcApiFeatures.js';
import { catalogFromOgcService } from '../src/adapters/ogcCatalog.js';

const LIVE = process.env.VOICEGIS_LIVE_OGC === '1';
const describeLive = LIVE ? describe : describe.skip;

const BASE_URL = 'https://demo.ldproxy.net/zoomstack';
const TIMEOUT = 45_000;

const CATALOG = {
  version: 'ldproxy-zoomstack',
  layers: [
    {
      id: 'airports',
      label: 'Airports',
      fields: [{ id: 'name', label: 'Name', type: 'string' }],
      capabilities: [
        OPERATION.QUERY_FILTER,
        OPERATION.QUERY_COUNT,
        OPERATION.QUERY_SELECT,
        OPERATION.QUERY_SPATIAL_SELECT,
        OPERATION.DATA_EXPORT,
      ],
    },
    {
      id: 'railway_stations',
      label: 'Railway stations',
      fields: [{ id: 'name', label: 'Name', type: 'string' }],
      capabilities: [OPERATION.QUERY_FILTER],
    },
  ],
};

function makeAdapter(overrides = {}) {
  return createOgcApiFeaturesAdapter({
    baseUrl: BASE_URL,
    catalog: CATALOG,
    geometryProperty: 'geom',
    limit: 50,
    maxPages: 10,
    ...overrides,
  });
}

function operation(type, target, args = {}) {
  return { id: `op_${type}`, type, target, args };
}

const airports = { kind: 'layer', layerId: 'airports' };

describeLive('OGC adapter against a live ldproxy service', () => {
  test('the service still advertises the conformance this adapter needs', async () => {
    const response = await fetch(`${BASE_URL}/conformance?f=json`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    expect(response.ok).toBe(true);
    const { conformsTo } = await response.json();

    for (const required of [
      'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/filter',
      'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/features-filter',
      'http://www.opengis.net/spec/cql2/1.0/conf/cql2-text',
      'http://www.opengis.net/spec/cql2/1.0/conf/basic-cql2',
    ]) {
      expect(conformsTo).toContain(required);
    }
  }, TIMEOUT);

  test('a compiled equality predicate is accepted and filters', async () => {
    const adapter = makeAdapter();

    const all = await adapter.execute(operation(OPERATION.QUERY_FILTER, airports, {}));
    expect(all.returned).toBeGreaterThan(0);

    const name = adapter.getFeatures('airports')[0].properties.name;
    const filtered = await adapter.execute(operation(OPERATION.QUERY_FILTER, airports, {
      predicate: { type: 'comparison', field: 'name', operator: 'eq', value: name },
    }));

    expect(filtered.filter).toBe(`name = '${name.replace(/'/g, "''")}'`);
    expect(filtered.returned).toBeGreaterThan(0);
    expect(filtered.returned).toBeLessThan(all.returned);
    for (const feature of adapter.getFeatures('airports')) {
      expect(feature.properties.name).toBe(name);
    }
  }, TIMEOUT);

  test('a LIKE predicate from "contains" is accepted', async () => {
    const adapter = makeAdapter();
    const result = await adapter.execute(operation(OPERATION.QUERY_FILTER, airports, {
      predicate: { type: 'comparison', field: 'name', operator: 'contains', value: 'Airport' },
    }));

    expect(result.filter).toBe("name LIKE '%Airport%'");
    expect(result.returned).toBeGreaterThan(0);
    for (const feature of adapter.getFeatures('airports')) {
      expect(feature.properties.name).toMatch(/Airport/i);
    }
  }, TIMEOUT);

  test('an AND group is accepted', async () => {
    const adapter = makeAdapter();
    const result = await adapter.execute(operation(OPERATION.QUERY_FILTER, airports, {
      predicate: {
        type: 'group',
        operator: 'and',
        conditions: [
          { type: 'comparison', field: 'name', operator: 'contains', value: 'Airport' },
          { type: 'comparison', field: 'name', operator: 'not_contains', value: 'Heliport' },
        ],
      },
    }));

    expect(result.filter).toContain(' AND ');
    expect(result.returned).toBeGreaterThan(0);
  }, TIMEOUT);

  test('pagination follows the service rel=next to a complete result', async () => {
    // A page size well below the collection size forces several real hops.
    const adapter = makeAdapter({ limit: 5, maxPages: 50 });
    const result = await adapter.execute(operation(OPERATION.QUERY_FILTER, airports, {}));

    expect(result.pages).toBeGreaterThan(1);
    expect(result.truncated).toBe(false);
    expect(result.complete).toBe(true);
    expect(adapter.getFeatures('airports')).toHaveLength(result.returned);

    // Every feature is distinct: offset synthesis against a shifting result
    // set is exactly what produces duplicates here.
    const ids = adapter.getFeatures('airports').map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, TIMEOUT);

  test('a page-bounded read is reported as incomplete, not as an answer', async () => {
    const adapter = makeAdapter({ limit: 5, maxPages: 2 });
    const result = await adapter.execute(operation(OPERATION.QUERY_FILTER, airports, {}));

    expect(result.truncated).toBe(true);
    expect(result.complete).toBe(false);

    // And a count over the same bound refuses rather than guessing, because
    // this service does not report numberMatched.
    await expect(adapter.execute(operation(OPERATION.QUERY_COUNT, airports, {})))
      .rejects.toThrow(/Cannot count .* exactly/);
  }, TIMEOUT);

  test('counting pages to an exact total when allowed to finish', async () => {
    const adapter = makeAdapter({ limit: 100, maxPages: 50 });
    const counted = await adapter.execute(operation(OPERATION.QUERY_COUNT, airports, {}));

    expect(counted.complete).toBe(true);
    expect(counted.count).toBeGreaterThan(0);

    const listed = await adapter.execute(operation(OPERATION.QUERY_FILTER, airports, {}));
    expect(counted.count).toBe(listed.returned);
  }, TIMEOUT);

  test('a proximity query round-trips S_INTERSECTS through the service', async () => {
    const adapter = makeAdapter({ limit: 100, maxPages: 50, referenceLimit: 5 });

    const result = await adapter.execute(operation(OPERATION.QUERY_SPATIAL_SELECT, airports, {
      relation: 'within',
      distance: { value: 100, unit: 'kilometer' },
      reference: { kind: 'layer', layerId: 'railway_stations' },
    }));

    expect(result.filter).toContain('S_INTERSECTS(geom, POLYGON((');
    expect(result.distance.meters).toBe(100_000);
    expect(result.referenceGeometries).toBe(5);
    expect(typeof result.selected).toBe('number');
  }, TIMEOUT);

  test('a rejected filter surfaces the service status rather than failing silently', async () => {
    const adapter = makeAdapter();
    await expect(adapter.execute(operation(OPERATION.QUERY_FILTER, airports, {
      predicate: { type: 'comparison', field: 'no_such_queryable', operator: 'eq', value: 'x' },
    }))).rejects.toThrow(/responded \d+/);
  }, TIMEOUT);
});

/**
 * Catalog derivation against real services.
 *
 * The two targets differ in exactly the way that matters: ldproxy implements
 * Part 3 filtering, pygeoapi advertises the CQL2 encoding but not the filter
 * class — and its items endpoint returns every feature regardless of the
 * filter it is sent. The derived capabilities must reflect that difference.
 */
describeLive('catalogFromOgcService against live services', () => {
  test('ldproxy: derives a filterable catalog with per-collection geometry', async () => {
    const derived = await catalogFromOgcService(BASE_URL, { signal: AbortSignal.timeout(TIMEOUT) });

    expect(derived.catalog.layers.length).toBeGreaterThan(5);
    expect(derived.conformance.canFilter).toBe(true);

    const airports = derived.catalog.layers.find((layer) => layer.id === 'airports');
    expect(airports.label).toBe('Airports');
    expect(airports.fields.map((field) => field.id)).toContain('name');
    // The geometry queryable is not offered as a filterable field.
    expect(airports.fields.map((field) => field.id)).not.toContain('geom');
    expect(derived.geometryProperty.airports).toBe('geom');

    expect(airports.capabilities).toContain(OPERATION.QUERY_FILTER);
    expect(airports.capabilities).toContain(OPERATION.QUERY_SPATIAL_SELECT);
  }, TIMEOUT);

  test('ldproxy: the derived catalog drives a real query end to end', async () => {
    const derived = await catalogFromOgcService(BASE_URL, { signal: AbortSignal.timeout(TIMEOUT) });

    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: BASE_URL,
      catalog: derived.catalog,
      geometryProperty: derived.geometryProperty,
      limit: 50,
      maxPages: 10,
    });

    const result = await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'airports' },
      { predicate: { type: 'comparison', field: 'name', operator: 'contains', value: 'Airport' } }
    ));

    expect(result.returned).toBeGreaterThan(0);
    for (const feature of adapter.getFeatures('airports')) {
      expect(feature.properties.name).toMatch(/Airport/i);
    }
  }, TIMEOUT);

  test('pygeoapi: a service that ignores filters is denied query capabilities', async () => {
    const PYGEOAPI = 'https://demo.pygeoapi.io/master';
    const derived = await catalogFromOgcService(PYGEOAPI, { signal: AbortSignal.timeout(TIMEOUT) });

    expect(derived.conformance.cql2Text).toBe(true);
    expect(derived.conformance.filter).toBe(false);
    expect(derived.conformance.canFilter).toBe(false);

    const lakes = derived.catalog.layers.find((layer) => layer.id === 'lakes');
    expect(lakes).toBeDefined();
    expect(lakes.capabilities).not.toContain(OPERATION.QUERY_FILTER);
    expect(lakes.capabilities).toContain(OPERATION.LAYER_VISIBILITY);
    expect(derived.warnings.join(' ')).toMatch(/does not advertise/);

    // Demonstrate why: the service answers 200 and ignores the filter.
    const url = `${PYGEOAPI}/collections/lakes/items?f=json&limit=5`
      + `&filter=${encodeURIComponent("name LIKE '%Huron%'")}&filter-lang=cql2-text`;
    const body = await (await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })).json();
    const names = (body.features || []).map((feature) => feature.properties.name);

    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => /Huron/i.test(name))).toBe(false);
  }, TIMEOUT);

  test('pygeoapi: geometry property is detected as "geometry", not "geom"', async () => {
    const derived = await catalogFromOgcService('https://demo.pygeoapi.io/master', {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    expect(derived.geometryProperty.lakes).toBe('geometry');
  }, TIMEOUT);
});
