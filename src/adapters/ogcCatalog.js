/**
 * Derive a VoiceGIS catalog from a live OGC API - Features service.
 *
 * Writing a catalog by hand is the slowest part of adopting this library, and
 * a conformant service already publishes everything needed: `/collections`
 * names the layers, `/collections/{id}/queryables` types their fields, and
 * `/conformance` says which operations the service can actually perform.
 *
 * The conformance check is the important part. A service that does not
 * implement OGC API - Features Part 3 filtering may still accept a `filter`
 * parameter, answer 200, and hand back *every* feature as though the filter
 * had been applied. Granting query capabilities on such a service produces
 * confident wrong answers, so capabilities are derived from what the service
 * advertises rather than assumed.
 *
 * @module adapters/ogcCatalog
 */

import { OPERATION } from '../core/constants.js';
import { AdapterEvaluationError } from './predicate.js';

/** Conformance classes this module looks for. */
export const CONFORMANCE = Object.freeze({
  FILTER: 'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/filter',
  FEATURES_FILTER: 'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/features-filter',
  QUERYABLES: 'http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/queryables',
  CQL2_TEXT: 'http://www.opengis.net/spec/cql2/1.0/conf/cql2-text',
  BASIC_CQL2: 'http://www.opengis.net/spec/cql2/1.0/conf/basic-cql2',
  ADVANCED_COMPARISON: 'http://www.opengis.net/spec/cql2/1.0/conf/advanced-comparison-operators',
  CASE_INSENSITIVE: 'http://www.opengis.net/spec/cql2/1.0/conf/case-insensitive-comparison',
  BASIC_SPATIAL: 'http://www.opengis.net/spec/cql2/1.0/conf/basic-spatial-functions',
  SPATIAL_FUNCTIONS: 'http://www.opengis.net/spec/cql2/1.0/conf/spatial-functions',
});

/** Small stable hash so a schema change invalidates previously compiled plans. */
function fingerprint(value) {
  let hash = 0x811c9dc5;
  const text = JSON.stringify(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Map an OGC queryable to a catalog field type.
 *
 * An unrecognised or absent type is left undefined on purpose: the compiler
 * treats an undeclared field conservatively, which is safer than asserting a
 * type the service never promised.
 */
function fieldTypeFor(queryable) {
  if (queryable.format === 'date-time' || queryable.format === 'date') return 'date';
  switch (queryable.type) {
    case 'string': return 'string';
    case 'number':
    case 'integer': return 'number';
    case 'boolean': return 'boolean';
    default: return undefined;
  }
}

const isGeometry = (queryable) => typeof queryable?.format === 'string'
  && queryable.format.startsWith('geometry');

/** "dutch_windmills" should also answer to "dutch windmills". */
function aliasesFor(id, title) {
  const candidates = new Set();
  const spaced = String(id).replace(/[_-]+/g, ' ').trim();
  if (spaced && spaced !== id) candidates.add(spaced);
  if (title && title !== id) candidates.add(String(title).trim());
  return [...candidates].filter(Boolean);
}

async function getJson(fetchImpl, url, signal, what) {
  const response = await fetchImpl(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new AdapterEvaluationError(
      `Could not read ${what}: the service responded ${response.status}.`,
      { url, status: response.status }
    );
  }
  return response.json();
}

/** Run tasks with a small concurrency bound so large services stay polite. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Build a catalog, geometry-property map, and capability set from a service.
 *
 * @param {string} baseUrl - Service landing page, e.g. `https://example.org/ogc`.
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {AbortSignal} [options.signal]
 * @param {string[]} [options.include] - Only these collection ids.
 * @param {string[]} [options.exclude] - Skip these collection ids.
 * @param {number} [options.concurrency] - Defaults to 6.
 * @param {number} [options.maxCollections] - Defaults to 200.
 * @returns {Promise<{
 *   catalog: import('../core/types.js').CatalogDefinition,
 *   geometryProperty: Record<string, string>,
 *   conformance: Record<string, boolean>,
 *   warnings: string[],
 *   collections: Array<{id:string, title?:string, fieldCount:number}>,
 * }>}
 */
export async function catalogFromOgcService(baseUrl, options = {}) {
  if (!baseUrl) throw new TypeError('An OGC API - Features baseUrl is required.');

  const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('No fetch implementation is available; pass options.fetch.');
  }

  const base = String(baseUrl).replace(/\/+$/, '');
  const { signal } = options;
  const warnings = [];

  const conformanceDoc = await getJson(
    fetchImpl, `${base}/conformance?f=json`, signal, 'conformance'
  );
  const classes = new Set(conformanceDoc.conformsTo || []);
  const has = (uri) => classes.has(uri);

  const conformance = {
    filter: has(CONFORMANCE.FILTER) && has(CONFORMANCE.FEATURES_FILTER),
    cql2Text: has(CONFORMANCE.CQL2_TEXT),
    basicCql2: has(CONFORMANCE.BASIC_CQL2),
    queryables: has(CONFORMANCE.QUERYABLES),
    advancedComparison: has(CONFORMANCE.ADVANCED_COMPARISON),
    caseInsensitive: has(CONFORMANCE.CASE_INSENSITIVE),
    spatial: has(CONFORMANCE.BASIC_SPATIAL) || has(CONFORMANCE.SPATIAL_FUNCTIONS),
  };

  // Filtering needs both the Part 3 filter classes and the CQL2 encoding.
  const canFilter = conformance.filter && conformance.cql2Text && conformance.basicCql2;

  if (!canFilter) {
    warnings.push(
      'This service does not advertise OGC API - Features Part 3 filtering with CQL2-Text. '
      + 'Attribute queries are NOT enabled: a service in this state has been observed to accept '
      + 'a filter, answer 200, and return every feature as though it had been applied. '
      + 'Only visibility, export and clearing are offered.'
    );
    if (conformance.cql2Text && !conformance.filter) {
      warnings.push(
        'It advertises cql2-text but not conf/filter. That only describes an encoding it '
        + 'understands, not that the items endpoint honours it.'
      );
    }
  }
  if (canFilter && !conformance.advancedComparison) {
    warnings.push('LIKE is unavailable, so "contains" and "starts with" conditions may be rejected.');
  }
  if (canFilter && !conformance.spatial) {
    warnings.push('No CQL2 spatial functions, so proximity selection is not enabled.');
  }

  const capabilities = [
    OPERATION.LAYER_VISIBILITY,
    OPERATION.QUERY_CLEAR,
    OPERATION.SELECTION_CLEAR,
    OPERATION.DATA_EXPORT,
    ...(canFilter
      ? [OPERATION.QUERY_FILTER, OPERATION.QUERY_SELECT, OPERATION.QUERY_COUNT]
      : []),
    ...(canFilter && conformance.spatial ? [OPERATION.QUERY_SPATIAL_SELECT] : []),
  ];

  const collectionsDoc = await getJson(
    fetchImpl, `${base}/collections?f=json`, signal, 'the collection list'
  );
  let collections = collectionsDoc.collections || [];

  if (options.include) {
    const wanted = new Set(options.include);
    collections = collections.filter((entry) => wanted.has(entry.id));
  }
  if (options.exclude) {
    const unwanted = new Set(options.exclude);
    collections = collections.filter((entry) => !unwanted.has(entry.id));
  }

  const maxCollections = options.maxCollections ?? 200;
  if (collections.length > maxCollections) {
    warnings.push(
      `The service lists ${collections.length} collections; only the first ${maxCollections} `
      + 'were read. Use the include option to choose the ones you need.'
    );
    collections = collections.slice(0, maxCollections);
  }

  const described = await mapLimit(collections, options.concurrency ?? 6, async (entry) => {
    let queryables = {};
    try {
      const doc = await getJson(
        fetchImpl,
        `${base}/collections/${encodeURIComponent(entry.id)}/queryables?f=json`,
        signal,
        `queryables for "${entry.id}"`
      );
      queryables = doc.properties || {};
    } catch {
      warnings.push(`Could not read queryables for "${entry.id}"; it is listed with no fields.`);
    }

    const fields = [];
    let geometryProperty = null;

    for (const [name, queryable] of Object.entries(queryables)) {
      if (isGeometry(queryable)) {
        if (!geometryProperty) geometryProperty = name;
        continue;
      }
      const type = fieldTypeFor(queryable);
      fields.push({
        id: name,
        ...(queryable.title && queryable.title !== name ? { label: queryable.title } : {}),
        ...(type ? { type } : {}),
      });
    }

    return { entry, fields, geometryProperty };
  });

  // Aliases must stay unique: SpatialCatalog rejects a name two layers answer to.
  const claimed = new Set(described.map(({ entry }) => String(entry.id).toLowerCase()));
  const layers = [];
  /** @type {Record<string, string>} */
  const geometryProperty = {};
  const summary = [];

  for (const { entry, fields, geometryProperty: geom } of described) {
    const aliases = aliasesFor(entry.id, entry.title).filter((alias) => {
      const key = alias.toLowerCase();
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    });

    layers.push({
      id: entry.id,
      ...(entry.title ? { label: entry.title } : {}),
      ...(aliases.length > 0 ? { aliases } : {}),
      fields,
      capabilities,
    });
    if (geom) geometryProperty[entry.id] = geom;
    summary.push({ id: entry.id, title: entry.title, fieldCount: fields.length });
  }

  if (layers.length === 0) {
    throw new AdapterEvaluationError(
      'The service published no collections, so there is nothing to build a catalog from.',
      { baseUrl: base }
    );
  }

  const host = (() => {
    try { return new URL(base).host; } catch { return base; }
  })();

  return {
    catalog: {
      version: `ogc:${host}:${fingerprint({ layers, capabilities })}`,
      layers,
    },
    geometryProperty,
    conformance: { ...conformance, canFilter },
    warnings,
    collections: summary,
  };
}
