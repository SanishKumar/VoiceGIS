import { OPERATION } from '../src/core/constants.js';
import { AdapterEvaluationError } from '../src/adapters/predicate.js';
import {
  andCql2,
  encodeIdentifier,
  encodeLiteral,
  geometryToWkt,
  intersectsCql2,
  predicateToCql2,
} from '../src/adapters/cql2.js';
import { createOgcApiFeaturesAdapter } from '../src/adapters/ogcApiFeatures.js';

describe('CQL2 translation', () => {
  test('encodes comparison operators', () => {
    const cases = [
      ['gt', 'mag > 5'],
      ['gte', 'mag >= 5'],
      ['lt', 'mag < 5'],
      ['lte', 'mag <= 5'],
      ['eq', 'mag = 5'],
      ['neq', 'mag <> 5'],
    ];
    for (const [operator, expected] of cases) {
      expect(predicateToCql2({ type: 'comparison', field: 'mag', operator, value: 5 }))
        .toBe(expected);
    }
  });

  test('quotes string literals and doubles inner quotes', () => {
    expect(encodeLiteral("O'Brien")).toBe("'O''Brien'");
    expect(predicateToCql2({
      type: 'comparison',
      field: 'place',
      operator: 'eq',
      value: "Rock's Bay",
    })).toBe("place = 'Rock''s Bay'");
  });

  test('a value that looks like CQL2 stays a literal', () => {
    const predicate = {
      type: 'comparison',
      field: 'place',
      operator: 'eq',
      value: "x' OR 1=1 --",
    };
    expect(predicateToCql2(predicate)).toBe("place = 'x'' OR 1=1 --'");
  });

  test('quotes identifiers that are not bare CQL2 names', () => {
    expect(encodeIdentifier('mag')).toBe('mag');
    expect(encodeIdentifier('alert level')).toBe('"alert level"');
    expect(encodeIdentifier('say "hi"')).toBe('"say ""hi"""');
  });

  test('maps text operators onto LIKE and escapes wildcards', () => {
    expect(predicateToCql2({
      type: 'comparison', field: 'place', operator: 'contains', value: 'Tokyo',
    })).toBe("place LIKE '%Tokyo%'");

    expect(predicateToCql2({
      type: 'comparison', field: 'place', operator: 'starts_with', value: 'San',
    })).toBe("place LIKE 'San%'");

    expect(predicateToCql2({
      type: 'comparison', field: 'place', operator: 'not_contains', value: 'Peru',
    })).toBe("NOT (place LIKE '%Peru%')");

    // A literal percent must not become a wildcard.
    expect(predicateToCql2({
      type: 'comparison', field: 'place', operator: 'contains', value: '50%',
    })).toBe("place LIKE '%50\\%%'");
  });

  test('uses IS NULL for null equality', () => {
    expect(predicateToCql2({ type: 'comparison', field: 'felt', operator: 'eq', value: null }))
      .toBe('felt IS NULL');
    expect(predicateToCql2({ type: 'comparison', field: 'felt', operator: 'neq', value: null }))
      .toBe('felt IS NOT NULL');
  });

  test('encodes booleans', () => {
    expect(predicateToCql2({ type: 'comparison', field: 'tsunami', operator: 'eq', value: true }))
      .toBe('tsunami = TRUE');
  });

  test('converts spoken units to the catalog unit', () => {
    const fields = { area: { id: 'area', unit: 'hectare' } };
    const cql = predicateToCql2(
      { type: 'comparison', field: 'area', operator: 'gt', value: 10, unit: 'acre' },
      { fields }
    );
    expect(cql).toMatch(/^area > 4\.046/);
  });

  test('nests and/or groups', () => {
    const predicate = {
      type: 'group',
      operator: 'and',
      conditions: [
        { type: 'comparison', field: 'mag', operator: 'gte', value: 6 },
        {
          type: 'group',
          operator: 'or',
          conditions: [
            { type: 'comparison', field: 'alert', operator: 'eq', value: 'red' },
            { type: 'comparison', field: 'alert', operator: 'eq', value: 'orange' },
          ],
        },
      ],
    };
    expect(predicateToCql2(predicate))
      .toBe("mag >= 6 AND (alert = 'red' OR alert = 'orange')");
  });

  test('optionally wraps string comparisons in CASEI', () => {
    expect(predicateToCql2(
      { type: 'comparison', field: 'alert', operator: 'eq', value: 'Red' },
      { caseInsensitive: true }
    )).toBe("CASEI(alert) = CASEI('Red')");
  });

  test('rejects unsupported predicate shapes', () => {
    expect(() => predicateToCql2({ type: 'raw', sql: 'DROP TABLE users' }))
      .toThrow(AdapterEvaluationError);
    expect(() => predicateToCql2({ type: 'group', operator: 'nand', conditions: [] }))
      .toThrow(AdapterEvaluationError);
  });

  test('renders geometries as WKT', () => {
    expect(geometryToWkt({ type: 'Point', coordinates: [1.23456789, 2.5] }))
      .toBe('POINT(1.234568 2.5)');
    expect(geometryToWkt({
      type: 'Polygon',
      coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]],
    })).toBe('POLYGON((0 0, 0 1, 1 1, 0 0))');
    expect(() => geometryToWkt({ type: 'Circle' })).toThrow(AdapterEvaluationError);
  });

  test('builds intersection and conjunction helpers', () => {
    const geometry = { type: 'Point', coordinates: [0, 0] };
    expect(intersectsCql2([geometry], { geometryProperty: 'geom' }))
      .toBe('S_INTERSECTS(geom, POINT(0 0))');
    expect(andCql2(['a = 1', null, 'b = 2'])).toBe('(a = 1) AND (b = 2)');
    expect(andCql2([null, undefined])).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function collection(features, extra = {}) {
  return { type: 'FeatureCollection', features, links: [], ...extra };
}

const CATALOG = {
  version: 'ogc-1',
  layers: [
    {
      id: 'quakes',
      fields: [{ id: 'mag', type: 'number' }],
      capabilities: [OPERATION.QUERY_FILTER, OPERATION.QUERY_COUNT, OPERATION.QUERY_SPATIAL_SELECT],
    },
    { id: 'cities', fields: [{ id: 'name', type: 'string' }] },
  ],
};

function operation(type, target, args = {}) {
  return { id: `op_${type}`, type, target, args };
}

describe('OgcApiFeaturesAdapter', () => {
  test('sends a CQL2 filter with the standard filter-lang parameter', async () => {
    const calls = [];
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc/',
      catalog: CATALOG,
      fetch: async (url) => {
        calls.push(url);
        return jsonResponse(collection([
          { type: 'Feature', id: 'q1', properties: { mag: 6 }, geometry: null },
        ], { numberMatched: 42 }));
      },
    });

    const result = await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 5 } }
    ));

    const requested = new URL(calls[0]);
    expect(requested.pathname).toBe('/ogc/collections/quakes/items');
    expect(requested.searchParams.get('filter')).toBe('mag > 5');
    expect(requested.searchParams.get('filter-lang')).toBe('cql2-text');
    expect(result).toMatchObject({ matched: 42, returned: 1, collection: 'quakes' });
  });

  test('maps a catalog layer onto a differently named collection', async () => {
    const calls = [];
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      collections: { quakes: 'seismic_events' },
      fetch: async (url) => {
        calls.push(url);
        return jsonResponse(collection([]));
      },
    });

    await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 5 } }
    ));
    expect(new URL(calls[0]).pathname).toBe('/ogc/collections/seismic_events/items');
  });

  test('counts using numberMatched without paging the collection', async () => {
    const calls = [];
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      fetch: async (url) => {
        calls.push(url);
        return jsonResponse(collection([{ type: 'Feature', properties: {}, geometry: null }], {
          numberMatched: 1337,
        }));
      },
    });

    const result = await adapter.execute(operation(
      OPERATION.QUERY_COUNT,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gte', value: 4 } }
    ));

    expect(result).toMatchObject({ count: 1337, source: 'numberMatched' });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).searchParams.get('limit')).toBe('1');
  });

  test('falls back to paging when the service omits numberMatched', async () => {
    let page = 0;
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      limit: 2,
      fetch: async () => {
        page += 1;
        // Page 1 is the limit=1 probe; the paged pass then reads a complete
        // two-page result, so the count is exact despite no numberMatched.
        if (page <= 2) {
          return jsonResponse(collection(
            [{ type: 'Feature', properties: {}, geometry: null }],
            { links: [{ rel: 'next', href: 'https://example.org/ogc/p/2' }] }
          ));
        }
        return jsonResponse(collection([
          { type: 'Feature', properties: {}, geometry: null },
          { type: 'Feature', properties: {}, geometry: null },
        ], { links: [] }));
      },
    });

    const result = await adapter.execute(
      operation(OPERATION.QUERY_COUNT, { kind: 'layer', layerId: 'quakes' })
    );
    expect(result).toMatchObject({ source: 'paged', count: 3, complete: true });
  });

  test('follows the exact absolute next href the service returns', async () => {
    const requested = [];
    const pages = [
      collection([{ type: 'Feature', id: 'a', properties: {}, geometry: null }], {
        numberMatched: 3,
        links: [{ rel: 'next', href: 'https://example.org/ogc/collections/quakes/items?cursor=OPAQUE%3D%3D&limit=500' }],
      }),
      collection([{ type: 'Feature', id: 'b', properties: {}, geometry: null }], {
        links: [{ rel: 'next', href: 'https://example.org/ogc/collections/quakes/items?cursor=SECOND%3D%3D&limit=500' }],
      }),
      collection([{ type: 'Feature', id: 'c', properties: {}, geometry: null }], { links: [] }),
    ];

    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      fetch: async (url) => {
        requested.push(url);
        return jsonResponse(pages[requested.length - 1]);
      },
    });

    const result = await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 1 } }
    ));

    // Page two and three must be the server's own hrefs, byte for byte.
    expect(requested[1]).toBe('https://example.org/ogc/collections/quakes/items?cursor=OPAQUE%3D%3D&limit=500');
    expect(requested[2]).toBe('https://example.org/ogc/collections/quakes/items?cursor=SECOND%3D%3D&limit=500');
    expect(requested).toHaveLength(3);
    expect(result.returned).toBe(3);
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(false);
    // Never synthesised.
    expect(requested.slice(1).some((url) => url.includes('offset='))).toBe(false);
  });

  test('resolves a relative next href against the page it came from', async () => {
    const requested = [];
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      fetch: async (url) => {
        requested.push(url);
        if (requested.length === 1) {
          return jsonResponse(collection(
            [{ type: 'Feature', id: 'a', properties: {}, geometry: null }],
            { links: [{ rel: 'next', href: '?token=abc123&limit=500' }] }
          ));
        }
        return jsonResponse(collection([{ type: 'Feature', id: 'b', properties: {}, geometry: null }]));
      },
    });

    await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 1 } }
    ));

    expect(requested[1]).toBe('https://example.org/ogc/collections/quakes/items?token=abc123&limit=500');
  });

  test('resolves a root-relative next href', async () => {
    const requested = [];
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      fetch: async (url) => {
        requested.push(url);
        if (requested.length === 1) {
          return jsonResponse(collection(
            [{ type: 'Feature', id: 'a', properties: {}, geometry: null }],
            { links: [{ rel: 'next', href: '/ogc/next-page/xyz' }] }
          ));
        }
        return jsonResponse(collection([]));
      },
    });

    await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 1 } }
    ));

    expect(requested[1]).toBe('https://example.org/ogc/next-page/xyz');
  });

  test('stops and reports truncation at maxPages instead of pretending completeness', async () => {
    let calls = 0;
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      maxPages: 3,
      fetch: async () => {
        calls += 1;
        return jsonResponse(collection(
          [{ type: 'Feature', id: `f${calls}`, properties: {}, geometry: null }],
          { links: [{ rel: 'next', href: `https://example.org/ogc/p/${calls + 1}` }] }
        ));
      },
    });

    const result = await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 1 } }
    ));

    expect(calls).toBe(3);
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(true);
  });

  test('refuses a self-referential next link instead of returning a prefix', async () => {
    let calls = 0;
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      maxPages: 50,
      fetch: async (url) => {
        calls += 1;
        return jsonResponse(collection(
          [{ type: 'Feature', id: `f${calls}`, properties: {}, geometry: null }],
          { links: [{ rel: 'next', href: url }] }
        ));
      },
    });

    await expect(adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 1 } }
    ))).rejects.toThrow(/repeating pagination link/);
    // The repeat is caught before re-requesting, so the loop costs one fetch.
    expect(calls).toBe(1);
  });

  test('a two-page cycle is caught, not followed forever', async () => {
    let calls = 0;
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      maxPages: 100,
      fetch: async (url) => {
        calls += 1;
        const next = url.includes('page=b')
          ? 'https://example.org/ogc/items?page=a'
          : 'https://example.org/ogc/items?page=b';
        return jsonResponse(collection(
          [{ type: 'Feature', id: `f${calls}`, properties: {}, geometry: null }],
          { links: [{ rel: 'next', href: next }] }
        ));
      },
    });

    await expect(adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 1 } }
    ))).rejects.toThrow(/repeating pagination link/);
    expect(calls).toBeLessThan(6);
  });

  test('refuses to paginate to another origin unless allowed', async () => {
    const build = (followCrossOrigin) => createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      followCrossOrigin,
      fetch: async (url) => jsonResponse(collection(
        [{ type: 'Feature', id: url, properties: {}, geometry: null }],
        { links: url.includes('elsewhere') ? [] : [{ rel: 'next', href: 'https://elsewhere.test/page2' }] }
      )),
    });

    const request = () => operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 1 } }
    );

    await expect(build(false).execute(request())).rejects.toThrow(/different origin/);
    await expect(build(true).execute(request())).resolves.toMatchObject({ pages: 2 });
  });

  test('expresses proximity as intersection with a geodesic buffer', async () => {
    const calls = [];
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      geometryProperty: 'geometry',
      fetch: async (url) => {
        calls.push(url);
        if (url.includes('/collections/cities/')) {
          return jsonResponse(collection([{
            type: 'Feature',
            id: 'tokyo',
            properties: { name: 'Tokyo' },
            geometry: { type: 'Point', coordinates: [139.6917, 35.6895] },
          }]));
        }
        return jsonResponse(collection([], { numberMatched: 0 }));
      },
    });

    const result = await adapter.execute(operation(
      OPERATION.QUERY_SPATIAL_SELECT,
      { kind: 'layer', layerId: 'quakes' },
      {
        relation: 'within',
        distance: { value: 5, unit: 'kilometer' },
        reference: { kind: 'layer', layerId: 'cities' },
      }
    ));

    const filter = new URL(calls[1]).searchParams.get('filter');
    expect(filter).toContain('S_INTERSECTS(geometry, POLYGON((');
    expect(result.distance.meters).toBe(5000);
    expect(result.referenceGeometries).toBe(1);
  });

  test('does not claim buffer support it cannot honour', () => {
    const adapter = createOgcApiFeaturesAdapter({ baseUrl: 'https://example.org/ogc' });
    expect(adapter.supports(OPERATION.QUERY_FILTER)).toBe(true);
    expect(adapter.supports(OPERATION.ANALYSIS_BUFFER)).toBe(false);
  });

  test('surfaces a service error with its status', async () => {
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      fetch: async () => ({
        ok: false,
        status: 400,
        text: async () => 'Invalid filter',
        json: async () => ({}),
      }),
    });

    await expect(adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 5 } }
    ))).rejects.toThrow(/responded 400/);
  });

  /* ---------------------------------------------------------------- *
   * Completeness: a partial answer must never be presented as whole
   * ---------------------------------------------------------------- */

  const filterOp = () => operation(
    OPERATION.QUERY_FILTER,
    { kind: 'layer', layerId: 'quakes' },
    { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 1 } }
  );

  /** A service that always offers another page and never reports a total. */
  function endlessService({ numberMatched } = {}) {
    let calls = 0;
    return async () => {
      calls += 1;
      return jsonResponse(collection(
        [{ type: 'Feature', id: `f${calls}`, properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }],
        {
          ...(typeof numberMatched === 'number' ? { numberMatched } : {}),
          links: [{ rel: 'next', href: `https://example.org/ogc/p/${calls + 1}` }],
        }
      ));
    };
  }

  test('a truncated filter reports itself as incomplete', async () => {
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      maxPages: 3,
      fetch: endlessService(),
    });

    const result = await adapter.execute(filterOp());
    expect(result).toMatchObject({ truncated: true, complete: false, pages: 3, returned: 3 });
    expect(adapter.getState().layers.quakes.complete).toBe(false);
  });

  test('a short page count against numberMatched is incomplete', async () => {
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      // The service claims 500 matches but hands back one and no next link.
      fetch: async () => jsonResponse(collection(
        [{ type: 'Feature', id: 'a', properties: {}, geometry: null }],
        { numberMatched: 500, links: [] }
      )),
    });

    const result = await adapter.execute(filterOp());
    expect(result).toMatchObject({ matched: 500, returned: 1, truncated: false, complete: false });
  });

  test('count refuses to answer when paging was truncated', async () => {
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      maxPages: 2,
      fetch: endlessService(),
    });

    await expect(adapter.execute(
      operation(OPERATION.QUERY_COUNT, { kind: 'layer', layerId: 'quakes' })
    )).rejects.toThrow(/Cannot count .* exactly/);
  });

  test('count still answers exactly when the service reports numberMatched', async () => {
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      maxPages: 1,
      fetch: async () => jsonResponse(collection(
        [{ type: 'Feature', id: 'a', properties: {}, geometry: null }],
        { numberMatched: 9001, links: [{ rel: 'next', href: 'https://example.org/ogc/p/2' }] }
      )),
    });

    const result = await adapter.execute(
      operation(OPERATION.QUERY_COUNT, { kind: 'layer', layerId: 'quakes' })
    );
    expect(result).toMatchObject({ count: 9001, source: 'numberMatched', complete: true });
  });

  test('a proximity query refuses a truncated reference layer', async () => {
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      referenceLimit: 2,
      fetch: async (url) => {
        if (url.includes('/collections/cities/')) {
          return jsonResponse(collection([
            { type: 'Feature', id: 'a', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
            { type: 'Feature', id: 'b', properties: {}, geometry: { type: 'Point', coordinates: [1, 1] } },
          ], { numberMatched: 57 }));
        }
        return jsonResponse(collection([], { numberMatched: 0 }));
      },
    });

    await expect(adapter.execute(operation(
      OPERATION.QUERY_SPATIAL_SELECT,
      { kind: 'layer', layerId: 'quakes' },
      {
        relation: 'within',
        distance: { value: 5, unit: 'kilometer' },
        reference: { kind: 'layer', layerId: 'cities' },
      }
    ))).rejects.toThrow(/only 2 were fetched/);
  });

  test('a proximity query proceeds when the reference layer is fully fetched', async () => {
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      referenceLimit: 10,
      fetch: async (url) => {
        if (url.includes('/collections/cities/')) {
          return jsonResponse(collection([
            { type: 'Feature', id: 'a', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
          ], { numberMatched: 1 }));
        }
        return jsonResponse(collection([], { numberMatched: 0 }));
      },
    });

    await expect(adapter.execute(operation(
      OPERATION.QUERY_SPATIAL_SELECT,
      { kind: 'layer', layerId: 'quakes' },
      {
        relation: 'within',
        distance: { value: 5, unit: 'kilometer' },
        reference: { kind: 'layer', layerId: 'cities' },
      }
    ))).resolves.toMatchObject({ referenceGeometries: 1 });
  });

  test('exporting a truncated layer is refused unless explicitly allowed', async () => {
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      maxPages: 2,
      fetch: endlessService(),
    });

    await adapter.execute(filterOp());

    const exportOp = (args) => operation(
      OPERATION.DATA_EXPORT,
      { kind: 'layer', layerId: 'quakes' },
      args
    );

    await expect(adapter.execute(exportOp({ format: 'geojson' })))
      .rejects.toThrow(/Refusing to export/);

    // The opt-in exports the fetched subset and says so.
    const allowed = await adapter.execute(exportOp({ format: 'geojson', allowPartial: true }));
    expect(allowed).toMatchObject({ featureCount: 2, complete: false });
  });

  test('exporting a truncated selection is refused', async () => {
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      maxPages: 2,
      fetch: endlessService(),
    });

    await adapter.execute(operation(
      OPERATION.QUERY_SELECT,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 1 } }
    ));
    expect(adapter.getState().layers.quakes.selectionComplete).toBe(false);

    await expect(adapter.execute(
      operation(OPERATION.DATA_EXPORT, { kind: 'selection' }, { format: 'geojson' })
    )).rejects.toThrow(/Refusing to export/);
  });

  test('a complete export is not flagged and needs no opt-in', async () => {
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      fetch: async () => jsonResponse(collection([
        { type: 'Feature', id: 'a', properties: { mag: 6 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      ], { numberMatched: 1, links: [] })),
    });

    await adapter.execute(filterOp());
    const result = await adapter.execute(operation(
      OPERATION.DATA_EXPORT,
      { kind: 'layer', layerId: 'quakes' },
      { format: 'geojson' }
    ));
    expect(result).toMatchObject({ featureCount: 1, complete: true });
  });

  test('clearing filters resets completeness', async () => {
    const adapter = createOgcApiFeaturesAdapter({
      baseUrl: 'https://example.org/ogc',
      maxPages: 2,
      fetch: endlessService(),
    });

    await adapter.execute(filterOp());
    expect(adapter.getState().layers.quakes.complete).toBe(false);

    await adapter.execute(operation(OPERATION.QUERY_CLEAR, { kind: 'all_layers' }));
    expect(adapter.getState().layers.quakes.complete).toBe(true);
  });

  test('requires a baseUrl and a fetch implementation', () => {
    expect(() => createOgcApiFeaturesAdapter({})).toThrow(/baseUrl is required/);
    expect(() => createOgcApiFeaturesAdapter({ baseUrl: 'https://x', fetch: null }))
      .not.toThrow();
  });
});
