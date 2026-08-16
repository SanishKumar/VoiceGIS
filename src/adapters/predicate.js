/**
 * Shared evaluation helpers for VoiceGIS adapters.
 *
 * These utilities turn the typed predicate AST produced by the command
 * compiler into concrete decisions about real features. They are deliberately
 * dependency-free and never build query strings by concatenation.
 *
 * @module adapters/predicate
 */

/** Mean Earth radius (IUGG) in metres. */
const EARTH_RADIUS_M = 6371008.8;

const LENGTH_IN_METERS = Object.freeze({
  meter: 1,
  kilometer: 1000,
  mile: 1609.344,
  foot: 0.3048,
});

const AREA_IN_SQUARE_METERS = Object.freeze({
  square_meter: 1,
  hectare: 10000,
  acre: 4046.8564224,
  square_foot: 0.09290304,
});

/**
 * Thrown when an adapter cannot evaluate an operation correctly. Adapters
 * surface this as a failed operation result rather than guessing, so a wrong
 * answer never reaches the map.
 */
export class AdapterEvaluationError extends Error {
  /**
   * @param {string} message
   * @param {Record<string, *>} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'AdapterEvaluationError';
    this.details = details;
  }
}

/**
 * Resolve the conversion table a unit belongs to.
 * @param {string} unit
 * @returns {{ table: Record<string, number>, dimension: 'length'|'area' }|null}
 */
function unitFamily(unit) {
  if (unit in LENGTH_IN_METERS) return { table: LENGTH_IN_METERS, dimension: 'length' };
  if (unit in AREA_IN_SQUARE_METERS) return { table: AREA_IN_SQUARE_METERS, dimension: 'area' };
  return null;
}

/**
 * Convert a magnitude between two units of the same dimension.
 *
 * @param {number} value
 * @param {string} fromUnit
 * @param {string} toUnit
 * @returns {number}
 * @throws {AdapterEvaluationError} when the units are unknown or incompatible.
 */
export function convertUnit(value, fromUnit, toUnit) {
  if (!fromUnit || !toUnit || fromUnit === toUnit) return value;

  const from = unitFamily(fromUnit);
  const to = unitFamily(toUnit);
  if (!from || !to) {
    throw new AdapterEvaluationError(
      `Cannot convert between "${fromUnit}" and "${toUnit}": unknown unit.`,
      { fromUnit, toUnit }
    );
  }
  if (from.dimension !== to.dimension) {
    throw new AdapterEvaluationError(
      `Cannot convert ${from.dimension} unit "${fromUnit}" to ${to.dimension} unit "${toUnit}".`,
      { fromUnit, toUnit }
    );
  }
  return (value * from.table[fromUnit]) / to.table[toUnit];
}

/**
 * Normalize a compiled distance to metres.
 *
 * @param {{ value:number, unit:string }} distance
 * @returns {number}
 */
export function distanceToMeters(distance) {
  if (!distance || typeof distance.value !== 'number' || !Number.isFinite(distance.value)) {
    throw new AdapterEvaluationError('A numeric distance is required.', { distance });
  }
  if (!(distance.unit in LENGTH_IN_METERS)) {
    throw new AdapterEvaluationError(
      `Distance unit "${distance.unit}" is not a supported length unit.`,
      { distance }
    );
  }
  return distance.value * LENGTH_IN_METERS[distance.unit];
}

/**
 * Read a property, treating missing values as null.
 * @param {Record<string, *>|null|undefined} properties
 * @param {string} field
 */
function readProperty(properties, field) {
  const value = properties?.[field];
  return value === undefined ? null : value;
}

/**
 * Compare a feature value against a predicate literal.
 *
 * Null-valued properties follow SQL-like semantics: every comparison other
 * than an explicit null equality check evaluates to false.
 *
 * @param {*} actual
 * @param {import('../core/types.js').ComparisonPredicate} predicate
 * @param {{ field?: import('../core/types.js').CatalogField, caseSensitive?: boolean }} [options]
 * @returns {boolean}
 */
function compare(actual, predicate, options = {}) {
  const { operator, value } = predicate;

  if (operator === 'eq' && value === null) return actual === null;
  if (operator === 'neq' && value === null) return actual !== null;
  if (actual === null) return false;

  switch (operator) {
    case 'contains':
    case 'not_contains':
    case 'starts_with': {
      const haystack = options.caseSensitive ? String(actual) : String(actual).toLowerCase();
      const needle = options.caseSensitive ? String(value) : String(value).toLowerCase();
      if (operator === 'contains') return haystack.includes(needle);
      if (operator === 'not_contains') return !haystack.includes(needle);
      return haystack.startsWith(needle);
    }
    default:
      break;
  }

  let left = actual;
  let right = value;

  if (typeof right === 'number') {
    const numeric = typeof left === 'number' ? left : Number(left);
    if (!Number.isFinite(numeric)) return false;
    left = numeric;

    // The compiler carries the spoken unit; the catalog carries the stored
    // unit. Reconcile them rather than comparing incompatible magnitudes.
    const spokenUnit = predicate.unit;
    const storedUnit = options.field?.unit;
    if (spokenUnit && storedUnit && spokenUnit !== storedUnit) {
      right = convertUnit(right, spokenUnit, storedUnit);
    }
  } else if (typeof right === 'boolean') {
    // GeoJSON commonly encodes flags as 0/1.
    if (typeof left === 'number') left = left !== 0;
    else if (typeof left === 'string') left = /^(true|yes|1)$/i.test(left);
  } else if (typeof right === 'string' && typeof left === 'string' && !options.caseSensitive) {
    left = left.toLowerCase();
    right = right.toLowerCase();
  }

  switch (operator) {
    case 'eq': return left === right;
    case 'neq': return left !== right;
    case 'gt': return left > right;
    case 'gte': return left >= right;
    case 'lt': return left < right;
    case 'lte': return left <= right;
    default:
      throw new AdapterEvaluationError(`Unsupported predicate operator "${operator}".`, {
        operator,
      });
  }
}

/**
 * Evaluate a typed predicate against a feature's properties.
 *
 * @param {import('../core/types.js').SpatialPredicate} predicate
 * @param {Record<string, *>} properties
 * @param {{ fields?: Record<string, import('../core/types.js').CatalogField>, caseSensitive?: boolean }} [options]
 * @returns {boolean}
 */
export function evaluatePredicate(predicate, properties, options = {}) {
  if (!predicate || typeof predicate !== 'object') {
    throw new AdapterEvaluationError('A predicate object is required.', { predicate });
  }

  if (predicate.type === 'group') {
    const conditions = predicate.conditions || [];
    if (predicate.operator === 'or') {
      return conditions.some((condition) => evaluatePredicate(condition, properties, options));
    }
    if (predicate.operator === 'and') {
      return conditions.every((condition) => evaluatePredicate(condition, properties, options));
    }
    throw new AdapterEvaluationError(
      `Unsupported predicate group operator "${predicate.operator}".`,
      { operator: predicate.operator }
    );
  }

  // Read through a widened local: plans can arrive from a network boundary,
  // so this stays a runtime guard even though the declared type excludes it.
  const type = /** @type {string} */ (predicate.type);
  if (type !== 'comparison') {
    throw new AdapterEvaluationError(`Unsupported predicate type "${type}".`, { type });
  }

  return compare(readProperty(properties, predicate.field), predicate, {
    field: options.fields?.[predicate.field],
    caseSensitive: options.caseSensitive,
  });
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two [lon, lat] positions, in metres.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function haversineMeters(a, b) {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(b[0] - a[0]);

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance from a position to a segment, in metres.
 *
 * Uses a local equirectangular projection around the segment, which is
 * accurate well beyond the range of any realistic proximity query.
 *
 * @param {number[]} point
 * @param {number[]} start
 * @param {number[]} end
 * @returns {number}
 */
export function distanceToSegmentMeters(point, start, end) {
  const latScale = Math.cos(toRadians((start[1] + end[1]) / 2));
  const metersPerDegree = (Math.PI / 180) * EARTH_RADIUS_M;

  const px = (point[0] - start[0]) * latScale * metersPerDegree;
  const py = (point[1] - start[1]) * metersPerDegree;
  const sx = (end[0] - start[0]) * latScale * metersPerDegree;
  const sy = (end[1] - start[1]) * metersPerDegree;

  const lengthSquared = sx * sx + sy * sy;
  if (lengthSquared === 0) return haversineMeters(point, start);

  const t = Math.max(0, Math.min(1, (px * sx + py * sy) / lengthSquared));
  const dx = px - t * sx;
  const dy = py - t * sy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Ray-casting containment test for a single linear ring.
 * @param {number[]} point
 * @param {number[][]} ring
 */
function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = (yi > point[1]) !== (yj > point[1])
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Containment test honouring polygon holes.
 * @param {number[]} point
 * @param {number[][][]} polygon
 */
function pointInPolygon(point, polygon) {
  if (!polygon.length || !pointInRing(point, polygon[0])) return false;
  return polygon.slice(1).every((hole) => !pointInRing(point, hole));
}

/**
 * Decompose any GeoJSON geometry into flat primitive parts.
 *
 * @param {object|null} geometry
 * @returns {{ points: number[][], lines: number[][][], polygons: number[][][][] }}
 */
export function decomposeGeometry(geometry) {
  const points = [];
  const lines = [];
  const polygons = [];

  const walk = (geom) => {
    if (!geom) return;
    switch (geom.type) {
      case 'Point': points.push(geom.coordinates); break;
      case 'MultiPoint': points.push(...geom.coordinates); break;
      case 'LineString': lines.push(geom.coordinates); break;
      case 'MultiLineString': lines.push(...geom.coordinates); break;
      case 'Polygon': polygons.push(geom.coordinates); break;
      case 'MultiPolygon': polygons.push(...geom.coordinates); break;
      case 'GeometryCollection': (geom.geometries || []).forEach(walk); break;
      default:
        throw new AdapterEvaluationError(`Unsupported geometry type "${geom.type}".`, {
          type: geom.type,
        });
    }
  };

  walk(geometry);
  return { points, lines, polygons };
}

/**
 * Every vertex in a geometry, used for coarse bounding-box work.
 * @param {object|null} geometry
 * @returns {number[][]}
 */
export function positionsOf(geometry) {
  const { points, lines, polygons } = decomposeGeometry(geometry);
  return [
    ...points,
    ...lines.flat(),
    ...polygons.flat(2),
  ];
}

/**
 * Axis-aligned bounds as [minLon, minLat, maxLon, maxLat].
 * @param {object|null} geometry
 * @returns {number[]|null}
 */
export function bboxOf(geometry) {
  const positions = positionsOf(geometry);
  if (positions.length === 0) return null;

  let minLon = Infinity; let minLat = Infinity;
  let maxLon = -Infinity; let maxLat = -Infinity;
  for (const [lon, lat] of positions) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Shortest distance from a position to a decomposed geometry, in metres.
 * @param {number[]} point
 * @param {{ points:number[][], lines:number[][][], polygons:number[][][][] }} parts
 */
function distanceToParts(point, parts) {
  let best = Infinity;

  for (const candidate of parts.points) {
    best = Math.min(best, haversineMeters(point, candidate));
    if (best === 0) return 0;
  }

  const rings = [
    ...parts.lines,
    ...parts.polygons.flat(),
  ];
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i += 1) {
      best = Math.min(best, distanceToSegmentMeters(point, ring[i - 1], ring[i]));
    }
  }

  for (const polygon of parts.polygons) {
    if (pointInPolygon(point, polygon)) return 0;
  }

  return best;
}

/**
 * Shortest distance between two GeoJSON geometries, in metres.
 *
 * Exact for point-to-point and point-to-boundary cases. For area and line
 * pairs it takes the minimum over each geometry's vertices against the
 * other's edges, which is the standard approximation for proximity queries.
 *
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function geometryDistanceMeters(a, b) {
  const partsA = decomposeGeometry(a);
  const partsB = decomposeGeometry(b);

  let best = Infinity;
  for (const point of positionsOf(a)) {
    best = Math.min(best, distanceToParts(point, partsB));
    if (best === 0) return 0;
  }
  for (const point of positionsOf(b)) {
    best = Math.min(best, distanceToParts(point, partsA));
    if (best === 0) return 0;
  }
  return best;
}

/**
 * Expand bounds by a distance in metres, returning degree bounds.
 *
 * Used as a cheap pre-filter so proximity queries stay fast on large layers
 * without changing the result of the exact test that follows.
 *
 * @param {number[]} bbox
 * @param {number} meters
 * @returns {number[]}
 */
export function padBbox(bbox, meters) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const latPadding = (meters / EARTH_RADIUS_M) * (180 / Math.PI);
  const widestLat = Math.min(89.9, Math.max(Math.abs(minLat), Math.abs(maxLat)));
  const lonScale = Math.max(0.01, Math.cos(toRadians(widestLat)));
  const lonPadding = latPadding / lonScale;
  return [
    minLon - lonPadding,
    minLat - latPadding,
    maxLon + lonPadding,
    maxLat + latPadding,
  ];
}

/**
 * Whether two bounding boxes overlap.
 * @param {number[]} a
 * @param {number[]} b
 */
export function bboxIntersects(a, b) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/**
 * Position reached by travelling a distance along a bearing from a start
 * position, on a sphere.
 *
 * @param {number[]} origin - [lon, lat]
 * @param {number} meters
 * @param {number} bearingRadians
 * @returns {number[]}
 */
export function destinationPoint(origin, meters, bearingRadians) {
  const angular = meters / EARTH_RADIUS_M;
  const lat1 = toRadians(origin[1]);
  const lon1 = toRadians(origin[0]);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular)
    + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearingRadians)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );

  return [
    (((lon2 * 180) / Math.PI + 540) % 360) - 180,
    (lat2 * 180) / Math.PI,
  ];
}

/**
 * A closed geodesic circle approximated as a GeoJSON polygon ring.
 *
 * @param {number[]} center - [lon, lat]
 * @param {number} radiusMeters
 * @param {number} [steps=64]
 * @returns {object} GeoJSON Polygon geometry
 */
export function geodesicCircle(center, radiusMeters, steps = 64) {
  const ring = [];
  for (let i = 0; i < steps; i += 1) {
    ring.push(destinationPoint(center, radiusMeters, (i / steps) * 2 * Math.PI));
  }
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Representative position for a geometry, used for map fly-to behaviour.
 * @param {object|null} geometry
 * @returns {number[]|null}
 */
export function centroidOf(geometry) {
  const bounds = bboxOf(geometry);
  if (!bounds) return null;
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

export const UNITS = Object.freeze({
  length: Object.keys(LENGTH_IN_METERS),
  area: Object.keys(AREA_IN_SQUARE_METERS),
});
