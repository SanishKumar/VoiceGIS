import { jest } from '@jest/globals';
import {
  CommandPolicy,
  OPERATION,
  PLAN_STATUS,
  SpatialCatalog,
  SpatialCommandCompiler,
  splitSpatialCommand,
} from '../src/core/index.js';

const catalogDefinition = {
  version: 'test-1',
  layers: [
    {
      id: 'parcels',
      label: 'Land parcels',
      aliases: ['plots'],
      fields: [
        { id: 'area_ha', label: 'Area', aliases: ['size'], type: 'number', unit: 'hectare' },
        { id: 'zoning', label: 'Zoning', aliases: ['zone'], type: 'string' },
      ],
      capabilities: [
        OPERATION.LAYER_VISIBILITY,
        OPERATION.QUERY_FILTER,
        OPERATION.QUERY_SELECT,
        OPERATION.QUERY_COUNT,
        OPERATION.ANALYSIS_BUFFER,
        OPERATION.DATA_EXPORT,
      ],
    },
    {
      id: 'incidents',
      aliases: ['calls'],
      fields: [{ id: 'severity', type: 'number' }],
      capabilities: [OPERATION.QUERY_SPATIAL_SELECT, OPERATION.QUERY_COUNT],
    },
    {
      id: 'hospitals',
      aliases: ['medical centers'],
      capabilities: [OPERATION.LAYER_VISIBILITY],
    },
  ],
};

function createCompiler(options = {}) {
  return new SpatialCommandCompiler({
    catalog: catalogDefinition,
    clock: () => Date.UTC(2026, 6, 18),
    ...options,
  });
}

describe('SpatialCatalog', () => {
  test('resolves layer and field aliases without changing canonical ids', () => {
    const catalog = new SpatialCatalog(catalogDefinition);

    expect(catalog.resolveLayer('plots').layer.id).toBe('parcels');
    expect(catalog.resolveField('parcels', 'size').field.id).toBe('area_ha');
    expect(catalog.version).toBe('test-1');
  });

  test('supports object shorthand and rejects duplicate ids', () => {
    const catalog = new SpatialCatalog({
      layers: {
        roads: {
          fields: {
            speed: { type: 'number' },
          },
        },
      },
    });

    expect(catalog.resolveLayer('roads').layer.fields[0].id).toBe('speed');
    expect(() => new SpatialCatalog({ layers: ['roads', 'roads'] })).toThrow('Duplicate');
  });

  test('rejects aliases that make layer or field resolution ambiguous', () => {
    expect(() => new SpatialCatalog({
      layers: [
        { id: 'roads', aliases: ['network'] },
        { id: 'rail', aliases: ['network'] },
      ],
    })).toThrow('Ambiguous layer name "network"');

    expect(() => new SpatialCatalog({
      layers: [{
        id: 'roads',
        fields: [
          { id: 'speed', aliases: ['limit'] },
          { id: 'capacity', aliases: ['limit'] },
        ],
      }],
    })).toThrow('Ambiguous field name "limit"');
  });
});

describe('SpatialCommandCompiler', () => {
  test('compiles visibility and a typed filter without generating SQL', async () => {
    const plan = await createCompiler().compile(
      'show plots where size is greater than 2 hectares'
    );

    expect(plan.status).toBe(PLAN_STATUS.READY);
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      OPERATION.LAYER_VISIBILITY,
      OPERATION.QUERY_FILTER,
    ]);
    expect(plan.operations[1]).toMatchObject({
      target: { kind: 'layer', layerId: 'parcels' },
      args: {
        predicate: {
          type: 'comparison',
          field: 'area_ha',
          operator: 'gt',
          value: 2,
          unit: 'hectare',
        },
      },
    });
    expect(JSON.stringify(plan)).not.toContain('SELECT ');
  });

  test('compiles boolean predicate groups and count commands', async () => {
    const plan = await createCompiler().compile(
      'count parcels where zoning is residential and area is at least 3'
    );

    expect(plan.status).toBe(PLAN_STATUS.READY);
    expect(plan.operations[0].type).toBe(OPERATION.QUERY_COUNT);
    expect(plan.operations[0].args.predicate).toEqual({
      type: 'group',
      operator: 'and',
      conditions: [
        {
          type: 'comparison',
          field: 'zoning',
          operator: 'eq',
          value: 'residential',
        },
        {
          type: 'comparison',
          field: 'area_ha',
          operator: 'gte',
          value: 3,
          unit: 'hectare',
        },
      ],
    });
  });

  test('compiles spatial selection with normalized distance and a layer reference', async () => {
    const plan = await createCompiler().compile(
      'select incidents within 5 km of medical centers'
    );

    expect(plan.status).toBe(PLAN_STATUS.READY);
    expect(plan.operations[0]).toMatchObject({
      type: OPERATION.QUERY_SPATIAL_SELECT,
      target: { kind: 'layer', layerId: 'incidents' },
      args: {
        relation: 'within',
        distance: { value: 5, unit: 'kilometer' },
        reference: { kind: 'layer', layerId: 'hospitals' },
      },
    });
  });

  test('safe defaults block analysis and export permissions', async () => {
    const plan = await createCompiler().compile(
      'buffer selected features by 250 meters and export selected features as geojson'
    );

    expect(plan.status).toBe(PLAN_STATUS.BLOCKED);
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      OPERATION.ANALYSIS_BUFFER,
      OPERATION.DATA_EXPORT,
    ]);
    expect(plan.issues.filter((issue) => issue.code === 'policy_denied')).toHaveLength(2);
  });

  test('authorized risky operations remain inspectable until confirmed', async () => {
    const policy = new CommandPolicy({
      permissions: ['view', 'query', 'analysis', 'export'],
      confirm: [OPERATION.ANALYSIS_BUFFER, OPERATION.DATA_EXPORT],
    });
    const plan = await createCompiler({ policy }).compile(
      'buffer selected features by 250 meters and export selected features as geojson'
    );

    expect(plan.status).toBe(PLAN_STATUS.NEEDS_CONFIRMATION);
    expect(plan.requirements.confirmationOperationIds).toHaveLength(2);
    expect(plan.issues).toEqual([]);
  });

  test('unknown layers and fields become actionable input issues', async () => {
    const unknownLayer = await createCompiler().compile('filter rivers where depth is over 2');
    const unknownField = await createCompiler().compile('filter parcels where depth is over 2');

    expect(unknownLayer.status).toBe(PLAN_STATUS.NEEDS_INPUT);
    expect(unknownLayer.issues[0].code).toBe('unknown_layer');
    expect(unknownField.status).toBe(PLAN_STATUS.NEEDS_INPUT);
    expect(unknownField.issues[0].code).toBe('unknown_field');
  });

  test('falls back to backward-compatible navigation parsing', async () => {
    const plan = await createCompiler().compile('zoom in and then pan left');

    expect(plan.status).toBe(PLAN_STATUS.READY);
    expect(plan.operations).toMatchObject([
      { type: OPERATION.VIEW_ZOOM, args: { delta: 1 } },
      { type: OPERATION.VIEW_PAN, args: { direction: 'left' } },
    ]);
  });

  test('does not call a geocoder unless network geocoding is explicitly enabled', async () => {
    const geocoder = { geocode: jest.fn(async () => ({ lat: 0, lon: 0, displayName: 'Atlantis' })) };
    const disabledPlan = await createCompiler({ geocoder }).compile('go to Atlantis');

    expect(geocoder.geocode).not.toHaveBeenCalled();
    expect(disabledPlan.status).toBe(PLAN_STATUS.NEEDS_INPUT);

    const enabledPlan = await createCompiler({ geocoder, enableGeocoding: true })
      .compile('go to Atlantis');
    expect(geocoder.geocode).toHaveBeenCalledTimes(1);
    expect(enabledPlan.operations[0].type).toBe(OPERATION.VIEW_SET);
  });

  test('accepts domain-specific resolvers without changing the compiler', async () => {
    const resolver = jest.fn(({ text }) => text === 'focus the response area'
      ? { type: OPERATION.VIEW_SET, args: { bounds: [1, 2, 3, 4] } }
      : null);
    const plan = await createCompiler({ resolvers: [resolver] })
      .compile('focus the response area');

    expect(plan.status).toBe(PLAN_STATUS.READY);
    expect(plan.operations[0].args.bounds).toEqual([1, 2, 3, 4]);
  });

  test('preserves a custom policy contract for domain-specific operations', async () => {
    const policy = {
      evaluate: jest.fn(() => ({
        allowed: true,
        permission: 'admin',
        risk: 'high',
        requiresConfirmation: true,
        reason: null,
      })),
    };
    const plan = await createCompiler({
      policy,
      resolvers: [() => ({ type: 'domain.dispatch-crews', args: { team: 'alpha' } })],
    }).compile('dispatch alpha');

    expect(policy.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'domain.dispatch-crews',
    }));
    expect(plan.status).toBe(PLAN_STATUS.NEEDS_CONFIRMATION);
    expect(plan.operations[0]).toMatchObject({
      type: 'domain.dispatch-crews',
      permission: 'admin',
      risk: 'high',
      requiresConfirmation: true,
    });
  });

  test('only splits "and" when another operation begins', () => {
    expect(splitSpatialCommand(
      'filter parcels where zoning is residential and area is over 2 and then count parcels'
    )).toEqual([
      'filter parcels where zoning is residential and area is over 2',
      'count parcels',
    ]);
  });
});
