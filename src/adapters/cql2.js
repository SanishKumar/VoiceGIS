/**
 * Translate the typed VoiceGIS predicate AST into CQL2-Text.
 *
 * CQL2 is the filter language of OGC API - Features Part 3, so this module is
 * what lets a spoken condition reach a standards-compliant feature server
 * without anyone building a query string by concatenation.
 *
 * @module adapters/cql2
 */

import { AdapterEvaluationError, convertUnit } from './predicate.js';

const COMPARISON_SYMBOLS = Object.freeze({
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
});

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Quote a property name only when it is not a bare CQL2 identifier.
 * @param {string} name
 */
export function encodeIdentifier(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new AdapterEvaluationError('A property name is required.', { name });
  }
  if (SAFE_IDENTIFIER.test(name)) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Encode a scalar as a CQL2 literal. Strings are single-quoted with doubled
 * inner quotes, which is the only escaping CQL2-Text defines.
 * @param {string|number|boolean} value
 */
export function encodeLiteral(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new AdapterEvaluationError('Numeric literals must be finite.', { value });
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value === null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Escape LIKE metacharacters so a spoken value is matched literally.
 * @param {string|number|boolean} value
 */
function escapeLikeValue(value) {
  return String(value).replace(/([\\%_])/g, '\\$1');
}

/**
 * Round coordinates so generated URLs stay compact without losing precision
 * that matters at any realistic map scale (~0.1 m).
 * @param {number} value
 */
function coordinate(value) {
  return Number(value.toFixed(6));
}

/**
 * Render a GeoJSON geometry as WKT for embedding in a CQL2 spatial predicate.
 * @param {object} geometry
 * @returns {string}
 */
export function geometryToWkt(geometry) {
  const ring = (positions) => positions
    .map(([lon, lat]) => `${coordinate(lon)} ${coordinate(lat)}`)
    .join(', ');
  const rings = (polygon) => polygon.map((r) => `(${ring(r)})`).join(', ');

  switch (geometry?.type) {
    case 'Point':
      return `POINT(${coordinate(geometry.coordinates[0])} ${coordinate(geometry.coordinates[1])})`;
    case 'MultiPoint':
      return `MULTIPOINT(${ring(geometry.coordinates)})`;
    case 'LineString':
      return `LINESTRING(${ring(geometry.coordinates)})`;
    case 'MultiLineString':
      return `MULTILINESTRING(${geometry.coordinates.map((line) => `(${ring(line)})`).join(', ')})`;
    case 'Polygon':
      return `POLYGON(${rings(geometry.coordinates)})`;
    case 'MultiPolygon':
      return `MULTIPOLYGON(${geometry.coordinates.map((polygon) => `(${rings(polygon)})`).join(', ')})`;
    default:
      throw new AdapterEvaluationError(
        `Geometry type "${geometry?.type}" cannot be encoded as WKT.`,
        { type: geometry?.type }
      );
  }
}

/**
 * @param {import('../core/types.js').ComparisonPredicate} predicate
 * @param {{ fields?:Record<string, import('../core/types.js').CatalogField>, caseInsensitive?:boolean }} options
 */
function encodeComparison(predicate, options) {
  const property = encodeIdentifier(predicate.field);
  const { operator } = predicate;
  let { value } = predicate;

  if (operator === 'eq' && value === null) return `${property} IS NULL`;
  if (operator === 'neq' && value === null) return `${property} IS NOT NULL`;

  if (typeof value === 'number') {
    const storedUnit = options.fields?.[predicate.field]?.unit;
    if (predicate.unit && storedUnit && predicate.unit !== storedUnit) {
      value = convertUnit(value, predicate.unit, storedUnit);
    }
  }

  if (operator === 'contains' || operator === 'not_contains' || operator === 'starts_with') {
    const escaped = escapeLikeValue(value);
    const pattern = operator === 'starts_with' ? `${escaped}%` : `%${escaped}%`;
    const subject = options.caseInsensitive ? `CASEI(${property})` : property;
    const literal = options.caseInsensitive
      ? `CASEI(${encodeLiteral(pattern)})`
      : encodeLiteral(pattern);
    const expression = `${subject} LIKE ${literal}`;
    return operator === 'not_contains' ? `NOT (${expression})` : expression;
  }

  const symbol = COMPARISON_SYMBOLS[operator];
  if (!symbol) {
    throw new AdapterEvaluationError(`Operator "${operator}" has no CQL2 equivalent.`, { operator });
  }

  if (options.caseInsensitive && typeof value === 'string') {
    return `CASEI(${property}) ${symbol} CASEI(${encodeLiteral(value)})`;
  }
  return `${property} ${symbol} ${encodeLiteral(value)}`;
}

/**
 * Translate a predicate AST to a CQL2-Text expression.
 *
 * @param {import('../core/types.js').SpatialPredicate} predicate
 * @param {{ fields?:Record<string, import('../core/types.js').CatalogField>, caseInsensitive?:boolean }} [options]
 * @returns {string}
 */
export function predicateToCql2(predicate, options = {}) {
  if (!predicate || typeof predicate !== 'object') {
    throw new AdapterEvaluationError('A predicate object is required.', { predicate });
  }

  if (predicate.type === 'group') {
    const operator = predicate.operator === 'or' ? 'OR' : 'AND';
    if (!['and', 'or'].includes(predicate.operator)) {
      throw new AdapterEvaluationError(
        `Unsupported predicate group operator "${predicate.operator}".`,
        { operator: predicate.operator }
      );
    }
    const conditions = predicate.conditions || [];
    if (conditions.length === 0) {
      throw new AdapterEvaluationError('A predicate group needs at least one condition.', {});
    }
    if (conditions.length === 1) return predicateToCql2(conditions[0], options);
    return conditions
      .map((condition) => {
        const encoded = predicateToCql2(condition, options);
        return condition.type === 'group' ? `(${encoded})` : encoded;
      })
      .join(` ${operator} `);
  }

  // Read through a widened local: plans can arrive from a network boundary,
  // so this stays a runtime guard even though the declared type excludes it.
  const type = /** @type {string} */ (predicate.type);
  if (type !== 'comparison') {
    throw new AdapterEvaluationError(`Unsupported predicate type "${type}".`, { type });
  }

  return encodeComparison(predicate, options);
}

/**
 * Build a CQL2 spatial predicate testing intersection with one or more
 * geometries.
 *
 * CQL2's standard function set has no distance operator, so proximity is
 * expressed by intersecting a precomputed geodesic buffer. That keeps the
 * filter portable across conformant servers instead of relying on a
 * vendor extension.
 *
 * @param {object[]} geometries
 * @param {{ geometryProperty?:string }} [options]
 * @returns {string}
 */
export function intersectsCql2(geometries, options = {}) {
  const property = encodeIdentifier(options.geometryProperty || 'geom');
  if (!Array.isArray(geometries) || geometries.length === 0) {
    throw new AdapterEvaluationError('At least one geometry is required.', {});
  }
  const clauses = geometries.map(
    (geometry) => `S_INTERSECTS(${property}, ${geometryToWkt(geometry)})`
  );
  return clauses.length === 1 ? clauses[0] : clauses.join(' OR ');
}

/**
 * Combine expressions with AND, parenthesising each part.
 * @param {Array<string|null|undefined>} expressions
 * @returns {string|null}
 */
export function andCql2(expressions) {
  const parts = expressions.filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return parts.map((part) => `(${part})`).join(' AND ');
}
