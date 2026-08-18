import { OPERATION } from '../src/core/constants.js';
import { SpatialCatalog } from '../src/core/SpatialCatalog.js';
import { CONFORMANCE, catalogFromOgcService } from '../src/adapters/ogcCatalog.js';
import { createOgcApiFeaturesAdapter } from '../src/adapters/ogcApiFeatures.js';

const FILTERING = [
  CONFORMANCE.FILTER,
  CONFORMANCE.FEATURES_FILTER,
  CONFORMANCE.CQL2_TEXT,
  CONFORMANCE.BASIC_CQL2,
  CONFORMANCE.ADVANCED_COMPARISON,
  CONFORMANCE.BASIC_SPATIAL,
];

function json(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

/**
 * A stand-in service. `conformsTo` and `queryables` are the two knobs that
 * decide what the derived catalog is allowed to do.
 */
function service({ conformsTo = FILTERING, collections, queryables }) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/conformance')) return json({ conformsTo });
    if (url.includes('/queryables')) {
      const id = url.match(/collections\/([^/]+)\/queryables/)[1];
      if (!(id in queryables)) return { ok: false, status: 404, text: async () => 'nope' };
      return json({ properties: queryables[decodeURIComponent(id)] });
    }
    if (url.includes('/collections')) return json({ collections });
    return { ok: false, status: 404, text: async () => 'nope' };
  };
  return { fetchImpl, calls };
}

const SIMPLE = {
  collections: [
    { id: 'airports', title: 'Airports' },
    { id: 'dutch_windmills', title: 'Windmills' },
  ],
  queryables: {
    airports: {
      name: { type: 'string' },
      elevation: { type: 'integer' },
      geom: { format: 'geometry-point' },
    },
    dutch_windmills: {
      NAAM: { type: 'string', title: 'Name' },
      built: { type: 'string', format: 'date-time' },
      untyped: {},
      geometry: { format: 'geometry-any' },
    },
  },
};

describe('catalogFromOgcService', () => {
  test('derives layers, labels, aliases and typed fields', async () => {
    const { fetchImpl } = service(SIMPLE);
    const result = await catalogFromOgcService('https://example.org/ogc/', { fetch: fetchImpl });

    expect(result.collections).toHaveLength(2);
    const [airports, windmills] = result.catalog.layers;

    expect(airports).toMatchObject({ id: 'airports', label: 'Airports' });
    expect(airports.fields).toEqual([
      { id: 'name', type: 'string' },
      { id: 'elevation', type: 'number' },
    ]);

    // An id with separators also answers to its spaced form.
    expect(windmills.aliases).toContain('dutch windmills');
    expect(windmills.aliases).toContain('Windmills');
  });

  test('geometry queryables become the geometry property, not fields', async () => {
    const { fetchImpl } = service(SIMPLE);
    const result = await catalogFromOgcService('https://example.org/ogc', { fetch: fetchImpl });

    expect(result.geometryProperty).toEqual({
      airports: 'geom',
      dutch_windmills: 'geometry',
    });
    for (const layer of result.catalog.layers) {
      expect(layer.fields.map((field) => field.id)).not.toContain('geom');
      expect(layer.fields.map((field) => field.id)).not.toContain('geometry');
    }
  });

  test('a date-time format becomes a date, and an untyped queryable stays untyped', async () => {
    const { fetchImpl } = service(SIMPLE);
    const result = await catalogFromOgcService('https://example.org/ogc', { fetch: fetchImpl });
    const windmills = result.catalog.layers[1];

    expect(windmills.fields).toContainEqual({ id: 'built', type: 'date' });
    // No type is better than a wrong one; the compiler treats it conservatively.
    expect(windmills.fields).toContainEqual({ id: 'untyped' });
    expect(windmills.fields).toContainEqual({ id: 'NAAM', label: 'Name', type: 'string' });
  });

  test('the derived catalog is accepted by SpatialCatalog', async () => {
    const { fetchImpl } = service(SIMPLE);
    const result = await catalogFromOgcService('https://example.org/ogc', { fetch: fetchImpl });

    const catalog = new SpatialCatalog(result.catalog);
    expect(catalog.resolveLayer('dutch windmills').layer.id).toBe('dutch_windmills');
    expect(catalog.resolveLayer('Airports').layer.id).toBe('airports');
  });

  test('the version changes when the schema changes', async () => {
    const first = await catalogFromOgcService('https://example.org/ogc', {
      fetch: service(SIMPLE).fetchImpl,
    });
    const changed = await catalogFromOgcService('https://example.org/ogc', {
      fetch: service({
        ...SIMPLE,
        queryables: {
          ...SIMPLE.queryables,
          airports: { ...SIMPLE.queryables.airports, runways: { type: 'integer' } },
        },
      }).fetchImpl,
    });

    expect(first.catalog.version).not.toBe(changed.catalog.version);
    expect(first.catalog.version).toMatch(/^ogc:example\.org:/);
  });

  /* ------------------------------------------------------------------ *
   * The point of the exercise: capabilities follow conformance
   * ------------------------------------------------------------------ */

  test('a filtering service is granted query capabilities', async () => {
    const { fetchImpl } = service(SIMPLE);
    const result = await catalogFromOgcService('https://example.org/ogc', { fetch: fetchImpl });

    expect(result.conformance.canFilter).toBe(true);
    const capabilities = result.catalog.layers[0].capabilities;
    expect(capabilities).toEqual(expect.arrayContaining([
      OPERATION.QUERY_FILTER,
      OPERATION.QUERY_SELECT,
      OPERATION.QUERY_COUNT,
      OPERATION.QUERY_SPATIAL_SELECT,
    ]));
    expect(result.warnings).toEqual([]);
  });

  test('a service that only speaks CQL2 gets no query capabilities', async () => {
    // This is pygeoapi's real posture: it advertises the CQL2 encoding but not
    // Part 3 filtering, and its items endpoint returns everything regardless
    // of the filter. Granting query capabilities here would turn a wrong
    // answer into a confident one.
    const { fetchImpl } = service({
      ...SIMPLE,
      conformsTo: [CONFORMANCE.CQL2_TEXT, CONFORMANCE.BASIC_CQL2, CONFORMANCE.QUERYABLES],
    });
    const result = await catalogFromOgcService('https://example.org/ogc', { fetch: fetchImpl });

    expect(result.conformance.canFilter).toBe(false);
    const capabilities = result.catalog.layers[0].capabilities;
    expect(capabilities).not.toContain(OPERATION.QUERY_FILTER);
    expect(capabilities).not.toContain(OPERATION.QUERY_SELECT);
    expect(capabilities).not.toContain(OPERATION.QUERY_COUNT);
    expect(capabilities).not.toContain(OPERATION.QUERY_SPATIAL_SELECT);
    // Things that do not depend on the service filtering remain available.
    expect(capabilities).toContain(OPERATION.LAYER_VISIBILITY);
    expect(capabilities).toContain(OPERATION.DATA_EXPORT);

    expect(result.warnings.join(' ')).toMatch(/does not advertise/);
    expect(result.warnings.join(' ')).toMatch(/cql2-text but not conf\/filter/);
  });

  test('no spatial functions means no proximity capability', async () => {
    const { fetchImpl } = service({
      ...SIMPLE,
      conformsTo: [
        CONFORMANCE.FILTER, CONFORMANCE.FEATURES_FILTER,
        CONFORMANCE.CQL2_TEXT, CONFORMANCE.BASIC_CQL2,
      ],
    });
    const result = await catalogFromOgcService('https://example.org/ogc', { fetch: fetchImpl });

    const capabilities = result.catalog.layers[0].capabilities;
    expect(capabilities).toContain(OPERATION.QUERY_FILTER);
    expect(capabilities).not.toContain(OPERATION.QUERY_SPATIAL_SELECT);
    expect(result.warnings.join(' ')).toMatch(/proximity selection is not enabled/);
  });

  /* ------------------------------------------------------------------ */

  test('include and exclude narrow the collection list', async () => {
    const { fetchImpl } = service(SIMPLE);
    const only = await catalogFromOgcService('https://example.org/ogc', {
      fetch: fetchImpl, include: ['airports'],
    });
    expect(only.catalog.layers.map((l) => l.id)).toEqual(['airports']);

    const without = await catalogFromOgcService('https://example.org/ogc', {
      fetch: service(SIMPLE).fetchImpl, exclude: ['airports'],
    });
    expect(without.catalog.layers.map((l) => l.id)).toEqual(['dutch_windmills']);
  });

  test('a collection with unreadable queryables is kept with no fields and a warning', async () => {
    const { fetchImpl } = service({
      ...SIMPLE,
      queryables: { airports: SIMPLE.queryables.airports },
    });
    const result = await catalogFromOgcService('https://example.org/ogc', { fetch: fetchImpl });

    const windmills = result.catalog.layers.find((l) => l.id === 'dutch_windmills');
    expect(windmills.fields).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/Could not read queryables/);
  });

  test('a service with no collections is an error, not an empty catalog', async () => {
    const { fetchImpl } = service({ collections: [], queryables: {} });
    await expect(catalogFromOgcService('https://example.org/ogc', { fetch: fetchImpl }))
      .rejects.toThrow(/no collections/);
  });

  test('a failing conformance request surfaces the status', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, text: async () => 'down' });
    await expect(catalogFromOgcService('https://example.org/ogc', { fetch: fetchImpl }))
      .rejects.toThrow(/responded 503/);
  });

  test('the derived geometry map drives the adapter per layer', async () => {
    const { fetchImpl } = service(SIMPLE);
    const derived = await catalogFromOgcService('https://example.org/ogc', { fetch: fetchImpl });

    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      catalog: derived.catalog,
      geometryProperty: derived.geometryProperty,
      fetch: async () => json({ type: 'FeatureCollection', features: [], links: [] }),
    });

    expect(adapter.geometryPropertyFor('airports')).toBe('geom');
    expect(adapter.geometryPropertyFor('dutch_windmills')).toBe('geometry');
    expect(adapter.geometryPropertyFor('unknown')).toBe('geom');
  });
});
