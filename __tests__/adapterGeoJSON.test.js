import { OPERATION } from '../src/core/constants.js';
import { createVoiceGISCore } from '../src/core/VoiceGISCore.js';
import { AdapterEvaluationError } from '../src/adapters/predicate.js';
import { createGeoJSONAdapter } from '../src/adapters/geojson.js';
import { composeAdapters } from '../src/adapters/compose.js';
import { createFunctionAdapter } from '../src/core/createFunctionAdapter.js';

function point(id, coordinates, properties = {}) {
  return {
    type: 'Feature',
    id,
    properties,
    geometry: { type: 'Point', coordinates },
  };
}

const QUAKES = {
  type: 'FeatureCollection',
  features: [
    point('q1', [139.69, 35.68], { mag: 6.4, place: 'near Tokyo', alert: 'red' }),
    point('q2', [139.9, 35.4], { mag: 4.1, place: 'east of Tokyo', alert: 'green' }),
    point('q3', [-118.24, 34.05], { mag: 5.5, place: 'Los Angeles', alert: 'yellow' }),
    point('q4', [-58.38, -34.6], { mag: 2.2, place: 'Buenos Aires', alert: null }),
  ],
};

const CITIES = {
  type: 'FeatureCollection',
  features: [
    point('tokyo', [139.6917, 35.6895], { name: 'Tokyo' }),
  ],
};

const CATALOG = {
  version: 'test-1',
  layers: [
    {
      id: 'quakes',
      label: 'Earthquakes',
      aliases: ['quakes'],
      fields: [
        { id: 'mag', label: 'Magnitude', aliases: ['magnitude'], type: 'number' },
        { id: 'place', label: 'Place', type: 'string' },
        { id: 'alert', label: 'Alert', type: 'string' },
      ],
      capabilities: [
        OPERATION.LAYER_VISIBILITY,
        OPERATION.QUERY_FILTER,
        OPERATION.QUERY_SELECT,
        OPERATION.QUERY_SPATIAL_SELECT,
        OPERATION.QUERY_COUNT,
        OPERATION.QUERY_CLEAR,
        OPERATION.ANALYSIS_BUFFER,
        OPERATION.DATA_EXPORT,
      ],
    },
    {
      id: 'cities',
      label: 'Cities',
      fields: [{ id: 'name', label: 'Name', type: 'string' }],
      capabilities: [OPERATION.LAYER_VISIBILITY, OPERATION.QUERY_FILTER],
    },
  ],
};

function makeAdapter(overrides = {}) {
  return createGeoJSONAdapter({
    layers: { quakes: QUAKES, cities: CITIES },
    catalog: CATALOG,
    ...overrides,
  });
}

function operation(type, target, args = {}) {
  return { id: `op_${type}`, type, target, args };
}

describe('GeoJSONAdapter operations', () => {
  test('filters a layer by a typed predicate', async () => {
    const adapter = makeAdapter();
    const result = await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 5 } }
    ));

    expect(result).toMatchObject({ layerId: 'quakes', matched: 2, total: 4 });
    expect(adapter.getFeatures('quakes').map((f) => f.id)).toEqual(['q1', 'q3']);
  });

  test('counts against the active filter, and against a predicate', async () => {
    const adapter = makeAdapter();
    await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 5 } }
    ));

    const filteredCount = await adapter.execute(
      operation(OPERATION.QUERY_COUNT, { kind: 'layer', layerId: 'quakes' })
    );
    expect(filteredCount).toMatchObject({ count: 2, scope: 'filtered' });

    const predicateCount = await adapter.execute(operation(
      OPERATION.QUERY_COUNT,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'alert', operator: 'eq', value: 'green' } }
    ));
    expect(predicateCount).toMatchObject({ count: 1, scope: 'predicate' });
  });

  test('clears filters for one layer or every layer', async () => {
    const adapter = makeAdapter();
    await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 5 } }
    ));
    expect(adapter.getFeatures('quakes')).toHaveLength(2);

    await adapter.execute(operation(OPERATION.QUERY_CLEAR, { kind: 'all_layers' }));
    expect(adapter.getFeatures('quakes')).toHaveLength(4);
  });

  test('selects features within a distance of a reference layer', async () => {
    const adapter = makeAdapter();
    // q1 sits ~1.6 km from Tokyo and q2 ~37 km, so the radius discriminates.
    const near = await adapter.execute(operation(
      OPERATION.QUERY_SPATIAL_SELECT,
      { kind: 'layer', layerId: 'quakes' },
      {
        relation: 'within',
        distance: { value: 10, unit: 'kilometer' },
        reference: { kind: 'layer', layerId: 'cities' },
      }
    ));

    expect(near).toMatchObject({ selected: 1, scope: 'all' });
    expect(near.distance.meters).toBe(10000);
    expect(adapter.getFeatures('quakes', { scope: 'selected' }).map((f) => f.id)).toEqual(['q1']);

    const wider = await adapter.execute(operation(
      OPERATION.QUERY_SPATIAL_SELECT,
      { kind: 'layer', layerId: 'quakes' },
      {
        relation: 'within',
        distance: { value: 50, unit: 'kilometer' },
        reference: { kind: 'layer', layerId: 'cities' },
      }
    ));
    expect(wider.selected).toBe(2);
    expect(adapter.getFeatures('quakes', { scope: 'selected' }).map((f) => f.id))
      .toEqual(['q1', 'q2']);
  });

  test('proximity selection composes with an active filter', async () => {
    const adapter = makeAdapter();
    // Only q2 is within 100 km of Tokyo once magnitudes above 5 are excluded.
    await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'lt', value: 5 } }
    ));
    const result = await adapter.execute(operation(
      OPERATION.QUERY_SPATIAL_SELECT,
      { kind: 'layer', layerId: 'quakes' },
      {
        relation: 'within',
        distance: { value: 100, unit: 'kilometer' },
        reference: { kind: 'layer', layerId: 'cities' },
      }
    ));

    expect(result).toMatchObject({ selected: 1, evaluated: 2, scope: 'filtered' });
    expect(adapter.getFeatures('quakes', { scope: 'selected' }).map((f) => f.id)).toEqual(['q2']);
  });

  test('refuses a proximity query against an unresolved literal reference', async () => {
    const adapter = makeAdapter();
    await expect(adapter.execute(operation(
      OPERATION.QUERY_SPATIAL_SELECT,
      { kind: 'layer', layerId: 'quakes' },
      {
        relation: 'within',
        distance: { value: 50, unit: 'kilometer' },
        reference: { kind: 'literal', value: 'the coast' },
      }
    ))).rejects.toThrow(/not a catalog layer/);
  });

  test('buffers selected points into geodesic polygons', async () => {
    const adapter = makeAdapter();
    await adapter.execute(operation(
      OPERATION.QUERY_SELECT,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 6 } }
    ));

    const result = await adapter.execute(operation(
      OPERATION.ANALYSIS_BUFFER,
      { kind: 'selection' },
      { distance: { value: 250, unit: 'meter' } }
    ));

    expect(result).toMatchObject({ source: 'selection', featureCount: 1 });
    expect(adapter.getState().buffers.features[0].geometry.type).toBe('Polygon');
  });

  test('refuses to buffer non-point geometry rather than returning a wrong shape', async () => {
    const adapter = createGeoJSONAdapter({
      layers: {
        zones: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            id: 'z1',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
          }],
        },
      },
    });

    await expect(adapter.execute(operation(
      OPERATION.ANALYSIS_BUFFER,
      { kind: 'layer', layerId: 'zones' },
      { distance: { value: 100, unit: 'meter' } }
    ))).rejects.toThrow(/point geometry only/);
  });

  test('exports the current selection as GeoJSON and CSV', async () => {
    const adapter = makeAdapter();
    await adapter.execute(operation(
      OPERATION.QUERY_SELECT,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'alert', operator: 'eq', value: 'red' } }
    ));

    const geojson = await adapter.execute(operation(
      OPERATION.DATA_EXPORT,
      { kind: 'selection' },
      { format: 'geojson' }
    ));
    expect(geojson).toMatchObject({ featureCount: 1, format: 'geojson' });
    expect(JSON.parse(geojson.content).features[0].id).toBe('q1');

    const csv = await adapter.execute(operation(
      OPERATION.DATA_EXPORT,
      { kind: 'selection' },
      { format: 'csv' }
    ));
    const [header, row] = csv.content.trim().split('\n');
    expect(header).toBe('longitude,latitude,mag,place,alert');
    expect(row).toBe('139.69,35.68,6.4,near Tokyo,red');
  });

  test('hands export content to the host when onExport is supplied', async () => {
    const exported = [];
    const adapter = makeAdapter({ onExport: (payload) => exported.push(payload) });

    const receiptValue = await adapter.execute(operation(
      OPERATION.DATA_EXPORT,
      { kind: 'layer', layerId: 'quakes' },
      { format: 'geojson' }
    ));

    expect(exported).toHaveLength(1);
    expect(exported[0].content).toContain('FeatureCollection');
    // Content stays out of the receipt so audit logs remain small.
    expect(receiptValue.content).toBeUndefined();
    expect(receiptValue.featureCount).toBe(4);
  });

  test('rejects an unsupported export format', async () => {
    const adapter = makeAdapter();
    await expect(adapter.execute(operation(
      OPERATION.DATA_EXPORT,
      { kind: 'layer', layerId: 'quakes' },
      { format: 'shapefile' }
    ))).rejects.toThrow(AdapterEvaluationError);
  });

  test('reports a missing layer instead of silently succeeding', async () => {
    const adapter = makeAdapter();
    await expect(adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'hydrants' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 1 } }
    ))).rejects.toThrow(/has no data loaded/);
  });
});

describe('GeoJSONAdapter state management', () => {
  test('notifies subscribers after every mutation', async () => {
    const adapter = makeAdapter();
    const states = [];
    adapter.subscribe((state) => states.push(state));

    await adapter.execute(operation(
      OPERATION.LAYER_VISIBILITY,
      { kind: 'layer', layerId: 'quakes' },
      { visible: false }
    ));

    expect(states).toHaveLength(1);
    expect(states[0].layers.quakes.visible).toBe(false);
  });

  test('reapplies an active filter when live data is refreshed', async () => {
    const adapter = makeAdapter();
    await adapter.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 5 } }
    ));
    expect(adapter.getState().layers.quakes.matched).toBe(2);

    adapter.setLayerData('quakes', {
      type: 'FeatureCollection',
      features: [
        ...QUAKES.features,
        point('q5', [12, 42], { mag: 7.7, place: 'Ionian Sea', alert: 'orange' }),
      ],
    });

    expect(adapter.getState().layers.quakes).toMatchObject({ matched: 3, total: 5 });
  });

  test('drops selected ids that disappear from refreshed data', async () => {
    const adapter = makeAdapter();
    await adapter.execute(operation(
      OPERATION.QUERY_SELECT,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 5 } }
    ));
    expect(adapter.getState().layers.quakes.selected).toBe(2);

    adapter.setLayerData('quakes', {
      type: 'FeatureCollection',
      features: QUAKES.features.filter((f) => f.id !== 'q3'),
    });
    expect(adapter.getState().layers.quakes.selected).toBe(1);
  });

  test('assigns stable synthetic ids when features have none', () => {
    const adapter = createGeoJSONAdapter({
      layers: {
        sites: {
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { n: 1 }, geometry: { type: 'Point', coordinates: [0, 0] } },
            { type: 'Feature', properties: { n: 2 }, geometry: { type: 'Point', coordinates: [1, 1] } },
          ],
        },
      },
    });
    expect(adapter.getState().layers.sites.total).toBe(2);
    expect(adapter.isSelected('sites', 'sites:0')).toBe(false);
  });
});

describe('end-to-end through VoiceGISCore', () => {
  test('compiles spoken text and executes it against real features', async () => {
    const adapter = makeAdapter();
    const gis = createVoiceGISCore({
      catalog: CATALOG,
      adapter,
      policy: { permissions: ['view', 'query'] },
    });

    const plan = await gis.compile('show quakes where magnitude is greater than 5');
    expect(plan.status).toBe('ready');

    const receipt = await gis.execute(plan);
    expect(receipt.status).toBe('succeeded');
    expect(receipt.results.at(-1).value).toMatchObject({ matched: 2, total: 4 });
    expect(adapter.getFeatures('quakes')).toHaveLength(2);
  });

  test('a blocked export never reaches the adapter', async () => {
    const adapter = makeAdapter();
    const gis = createVoiceGISCore({
      catalog: CATALOG,
      adapter,
      policy: { permissions: ['view', 'query'] },
    });

    const plan = await gis.compile('export quakes as geojson');
    expect(plan.status).toBe('blocked');

    const receipt = await gis.execute(plan);
    expect(receipt.status).toBe('failed');
    expect(adapter.getState().layers.quakes.matched).toBe(4);
  });

  test('composed adapters route by capability', async () => {
    const moves = [];
    const mapAdapter = createFunctionAdapter({
      [OPERATION.VIEW_ZOOM]: ({ args }) => {
        moves.push(args.delta);
        return { zoomed: args.delta };
      },
    });
    const data = makeAdapter();
    const composed = composeAdapters(data, mapAdapter);

    expect(composed.supports(OPERATION.QUERY_FILTER)).toBe(true);
    expect(composed.supports(OPERATION.VIEW_ZOOM)).toBe(true);
    expect(composed.supports(OPERATION.FEATURE_ADD)).toBe(false);

    await composed.execute(operation(OPERATION.VIEW_ZOOM, null, { delta: 1 }));
    await composed.execute(operation(
      OPERATION.QUERY_FILTER,
      { kind: 'layer', layerId: 'quakes' },
      { predicate: { type: 'comparison', field: 'mag', operator: 'gt', value: 5 } }
    ));

    expect(moves).toEqual([1]);
    expect(data.getFeatures('quakes')).toHaveLength(2);
  });
});
