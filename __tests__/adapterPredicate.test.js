import { jest } from '@jest/globals';
import {
  AdapterEvaluationError,
  bboxOf,
  convertUnit,
  distanceToMeters,
  evaluatePredicate,
  geodesicCircle,
  geometryDistanceMeters,
  haversineMeters,
  padBbox,
} from '../src/adapters/predicate.js';

describe('evaluatePredicate', () => {
  const properties = {
    mag: 6.2,
    place: 'South of Tokyo, Japan',
    alert: 'Red',
    tsunami: 1,
    felt: null,
  };

  test('evaluates numeric comparisons', () => {
    const gt = { type: 'comparison', field: 'mag', operator: 'gt', value: 5 };
    const lt = { type: 'comparison', field: 'mag', operator: 'lt', value: 5 };
    expect(evaluatePredicate(gt, properties)).toBe(true);
    expect(evaluatePredicate(lt, properties)).toBe(false);
  });

  test('compares strings case-insensitively by default', () => {
    const predicate = { type: 'comparison', field: 'alert', operator: 'eq', value: 'red' };
    expect(evaluatePredicate(predicate, properties)).toBe(true);
    expect(evaluatePredicate(predicate, properties, { caseSensitive: true })).toBe(false);
  });

  test('supports contains, not_contains, and starts_with', () => {
    const base = { type: 'comparison', field: 'place' };
    expect(evaluatePredicate({ ...base, operator: 'contains', value: 'tokyo' }, properties)).toBe(true);
    expect(evaluatePredicate({ ...base, operator: 'not_contains', value: 'peru' }, properties)).toBe(true);
    expect(evaluatePredicate({ ...base, operator: 'starts_with', value: 'south' }, properties)).toBe(true);
    expect(evaluatePredicate({ ...base, operator: 'starts_with', value: 'japan' }, properties)).toBe(false);
  });

  test('treats numeric flags as booleans', () => {
    const predicate = { type: 'comparison', field: 'tsunami', operator: 'eq', value: true };
    expect(evaluatePredicate(predicate, properties)).toBe(true);
  });

  test('applies SQL-like null semantics', () => {
    const isNull = { type: 'comparison', field: 'felt', operator: 'eq', value: null };
    const notNull = { type: 'comparison', field: 'felt', operator: 'neq', value: null };
    const compare = { type: 'comparison', field: 'felt', operator: 'gt', value: 0 };
    const missing = { type: 'comparison', field: 'absent', operator: 'eq', value: 'x' };

    expect(evaluatePredicate(isNull, properties)).toBe(true);
    expect(evaluatePredicate(notNull, properties)).toBe(false);
    expect(evaluatePredicate(compare, properties)).toBe(false);
    expect(evaluatePredicate(missing, properties)).toBe(false);
  });

  test('reconciles a spoken unit with the catalog unit', () => {
    // Stored in hectares, spoken in acres.
    const fields = { area: { id: 'area', unit: 'hectare' } };
    const predicate = {
      type: 'comparison',
      field: 'area',
      operator: 'gt',
      value: 10,
      unit: 'acre',
    };
    // 10 acres ≈ 4.047 ha
    expect(evaluatePredicate(predicate, { area: 5 }, { fields })).toBe(true);
    expect(evaluatePredicate(predicate, { area: 3 }, { fields })).toBe(false);
  });

  test('refuses to compare incompatible units instead of guessing', () => {
    const fields = { area: { id: 'area', unit: 'hectare' } };
    const predicate = {
      type: 'comparison',
      field: 'area',
      operator: 'gt',
      value: 10,
      unit: 'kilometer',
    };
    expect(() => evaluatePredicate(predicate, { area: 5 }, { fields }))
      .toThrow(AdapterEvaluationError);
  });

  test('evaluates and/or groups', () => {
    const group = {
      type: 'group',
      operator: 'and',
      conditions: [
        { type: 'comparison', field: 'mag', operator: 'gte', value: 6 },
        { type: 'comparison', field: 'alert', operator: 'eq', value: 'red' },
      ],
    };
    expect(evaluatePredicate(group, properties)).toBe(true);

    const orGroup = {
      type: 'group',
      operator: 'or',
      conditions: [
        { type: 'comparison', field: 'mag', operator: 'gt', value: 9 },
        { type: 'comparison', field: 'alert', operator: 'eq', value: 'red' },
      ],
    };
    expect(evaluatePredicate(orGroup, properties)).toBe(true);
  });

  test('rejects unknown predicate shapes', () => {
    expect(() => evaluatePredicate({ type: 'sql', raw: 'DROP TABLE' }, properties))
      .toThrow(AdapterEvaluationError);
    expect(() => evaluatePredicate(
      { type: 'group', operator: 'xor', conditions: [] },
      properties
    )).toThrow(AdapterEvaluationError);
  });
});

describe('unit conversion', () => {
  test('converts within a dimension', () => {
    expect(convertUnit(1, 'kilometer', 'meter')).toBeCloseTo(1000);
    expect(convertUnit(1, 'hectare', 'square_meter')).toBeCloseTo(10000);
    expect(convertUnit(1, 'mile', 'meter')).toBeCloseTo(1609.344);
  });

  test('rejects cross-dimension conversion', () => {
    expect(() => convertUnit(1, 'hectare', 'meter')).toThrow(/area unit/);
  });

  test('normalizes compiled distances', () => {
    expect(distanceToMeters({ value: 5, unit: 'kilometer' })).toBe(5000);
    expect(() => distanceToMeters({ value: 5, unit: 'hectare' })).toThrow(AdapterEvaluationError);
    expect(() => distanceToMeters({ value: NaN, unit: 'meter' })).toThrow(AdapterEvaluationError);
  });
});

describe('geometry helpers', () => {
  test('haversine matches a known distance', () => {
    // London to Paris: published great-circle distance is ~343.5 km.
    const london = [-0.1276, 51.5072];
    const paris = [2.3522, 48.8566];
    expect(haversineMeters(london, paris) / 1000).toBeCloseTo(343.5, 1);
    expect(haversineMeters(london, london)).toBe(0);
  });

  test('measures point-to-polygon distance and containment', () => {
    const square = {
      type: 'Polygon',
      coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
    };
    const inside = { type: 'Point', coordinates: [0.5, 0.5] };
    const outside = { type: 'Point', coordinates: [2, 0.5] };

    expect(geometryDistanceMeters(inside, square)).toBe(0);
    expect(geometryDistanceMeters(outside, square) / 1000).toBeCloseTo(111, 0);
  });

  test('respects polygon holes', () => {
    const donut = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]],
        [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]],
      ],
    };
    const inHole = { type: 'Point', coordinates: [2, 2] };
    expect(geometryDistanceMeters(inHole, donut)).toBeGreaterThan(0);
  });

  test('builds a closed geodesic circle of the requested radius', () => {
    const center = [10, 45];
    const circle = geodesicCircle(center, 1000, 32);
    const ring = circle.coordinates[0];

    expect(circle.type).toBe('Polygon');
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const vertex of ring) {
      expect(haversineMeters(center, vertex)).toBeCloseTo(1000, 0);
    }
  });

  test('pads a bounding box by a metric distance', () => {
    const padded = padBbox([10, 45, 10, 45], 111000);
    expect(padded[1]).toBeCloseTo(44, 0);
    expect(padded[3]).toBeCloseTo(46, 0);
    // Longitude padding widens with latitude.
    expect(padded[2] - padded[0]).toBeGreaterThan(padded[3] - padded[1]);
  });

  test('computes bounds across multi-part geometry', () => {
    const geometry = {
      type: 'MultiPoint',
      coordinates: [[-5, -2], [3, 8], [1, 1]],
    };
    expect(bboxOf(geometry)).toEqual([-5, -2, 3, 8]);
  });

  test('rejects unknown geometry types loudly', () => {
    expect(() => bboxOf({ type: 'Circle', coordinates: [0, 0] }))
      .toThrow(AdapterEvaluationError);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});
