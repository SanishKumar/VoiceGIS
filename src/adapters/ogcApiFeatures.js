/**
 * Execution adapter for OGC API - Features services.
 *
 * Typed predicates are translated to CQL2-Text and sent as the standard
 * `filter` query parameter (OGC API - Features Part 3). Nothing is
 * string-concatenated from user speech: the compiler resolves catalog field
 * ids, and this adapter encodes literals.
 *
 * @module adapters/ogcApiFeatures
 */

import { OPERATION } from '../core/constants.js';
import { SpatialCatalog } from '../core/SpatialCatalog.js';
import {
  AdapterEvaluationError,
  decomposeGeometry,
  distanceToMeters,
  geodesicCircle,
} from './predicate.js';
import { andCql2, intersectsCql2, predicateToCql2 } from './cql2.js';
import { serializeFeatures } from './serialize.js';

/**
 * Operations this adapter can execute.
 *
 * Buffering is deliberately absent: OGC API - Features has no standard
 * geometry-processing endpoint, so the capability contract reports the truth
 * and a buffer command fails preflight instead of halfway through.
 *
 * @type {readonly string[]}
 */
export const OGC_ADAPTER_CAPABILITIES = Object.freeze([
  OPERATION.LAYER_VISIBILITY,
  OPERATION.QUERY_FILTER,
  OPERATION.QUERY_CLEAR,
  OPERATION.QUERY_SELECT,
  OPERATION.QUERY_SPATIAL_SELECT,
  OPERATION.QUERY_COUNT,
  OPERATION.SELECTION_CLEAR,
  OPERATION.DATA_EXPORT,
]);

function requireLayerId(operation) {
  const layerId = operation.target?.layerId;
  if (operation.target?.kind !== 'layer' || !layerId) {
    throw new AdapterEvaluationError(
      `Operation "${operation.type}" requires a catalog layer target.`,
      { target: operation.target ?? null }
    );
  }
  return layerId;
}

/**
 * @typedef {object} OgcApiFeaturesAdapterOptions
 * @property {string} baseUrl - Service landing page, e.g. `https://example.org/ogc`.
 * @property {string} [name]
 * @property {Record<string, string>} [collections] - layerId → collectionId.
 * @property {SpatialCatalog|import('../core/types.js').CatalogDefinition} [catalog]
 * @property {typeof fetch} [fetch]
 * @property {Record<string, string>} [headers]
 * @property {string} [geometryProperty] - Queryable name of the geometry. Defaults to `geom`.
 * @property {number} [limit] - Page size requested from the service. Defaults to 500.
 * @property {number} [maxPages] - Safety bound on pagination. Defaults to 20.
 * @property {boolean} [caseInsensitive] - Wrap string comparisons in CASEI().
 * @property {number} [referenceLimit] - Max reference features fetched for proximity queries.
 * @property {boolean} [followCrossOrigin]
 *   Allow a `rel="next"` link that points at a different origin. Off by
 *   default: pagination should not silently move to another host.
 * @property {(state:object) => void} [onChange]
 * @property {(payload:object) => void} [onExport]
 */

/**
 * @typedef {object} OgcPageOptions
 * @property {string|null} [filter]
 * @property {number} [limit]
 * @property {number} [offset]
 * @property {AbortSignal} [signal]
 */

/**
 * Queries an OGC API - Features service on behalf of compiled commands.
 */
export class OgcApiFeaturesAdapter {
  /**
   * `baseUrl` is required; it is validated at runtime so a misconfigured
   * adapter fails at construction rather than on the first query.
   *
   * @param {Partial<OgcApiFeaturesAdapterOptions>} [options]
   */
  constructor(options = {}) {
    if (!options.baseUrl) {
      throw new TypeError('An OGC API - Features baseUrl is required.');
    }

    this.name = options.name || 'ogc-api-features-adapter';
    this.capabilities = OGC_ADAPTER_CAPABILITIES;
    this.baseUrl = String(options.baseUrl).replace(/\/+$/, '');
    this.collections = options.collections || {};
    this.headers = options.headers || {};
    this.geometryProperty = options.geometryProperty || 'geom';
    this.limit = options.limit || 500;
    this.maxPages = options.maxPages || 20;
    this.caseInsensitive = options.caseInsensitive === true;
    this.referenceLimit = options.referenceLimit || 100;
    this.followCrossOrigin = options.followCrossOrigin === true;
    this.onExport = options.onExport || null;
    this._fetch = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);

    if (typeof this._fetch !== 'function') {
      throw new TypeError('No fetch implementation is available; pass options.fetch.');
    }

    this.catalog = options.catalog
      ? (options.catalog instanceof SpatialCatalog
        ? options.catalog
        : new SpatialCatalog(options.catalog))
      : null;

    /** @type {Map<string, {visible:boolean, filter:object|null, features:object[], matched:number|null, total:number|null, complete:boolean}>} */
    this.layers = new Map();
    /** @type {Map<string, object[]>} */
    this.selection = new Map();
    /** @type {Map<string, boolean>} Whether each stored selection is the whole answer. */
    this.selectionComplete = new Map();
    /** @type {Set<Function>} */
    this._listeners = new Set();
    if (options.onChange) this._listeners.add(options.onChange);
  }

  /* ---------------------------------------------------------------- *
   * Host-facing API
   * ---------------------------------------------------------------- */

  /** @param {(state:object) => void} listener */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  getState() {
    /** @type {Record<string, object>} */
    const layers = {};
    for (const [layerId, entry] of this.layers) {
      layers[layerId] = {
        visible: entry.visible,
        filter: entry.filter,
        matched: entry.matched,
        total: entry.total,
        loaded: entry.features.length,
        complete: entry.complete,
        selected: this.selection.get(layerId)?.length ?? 0,
        selectionComplete: this.selectionComplete.get(layerId) ?? true,
      };
    }
    return {
      layers,
      selection: Object.fromEntries([...this.selection].map(([id, f]) => [id, f.length])),
    };
  }

  /**
   * @param {string} layerId
   * @param {{ scope?: 'filtered'|'selected' }} [options]
   */
  getFeatures(layerId, options = {}) {
    if (options.scope === 'selected') return this.selection.get(layerId) || [];
    return this.layers.get(layerId)?.features || [];
  }

  /** The collection id backing a catalog layer. */
  collectionFor(layerId) {
    return this.collections[layerId] || layerId;
  }

  /**
   * Build the items URL for a layer. Exposed so hosts can log or proxy it.
   *
   * @param {string} layerId
   * @param {{ filter?:string|null, limit?:number, offset?:number }} [options]
   * @returns {string}
   */
  buildItemsUrl(layerId, options = {}) {
    const url = new URL(`${this.baseUrl}/collections/${encodeURIComponent(this.collectionFor(layerId))}/items`);
    url.searchParams.set('f', 'json');
    url.searchParams.set('limit', String(options.limit ?? this.limit));
    if (options.offset) url.searchParams.set('offset', String(options.offset));
    if (options.filter) {
      url.searchParams.set('filter', options.filter);
      url.searchParams.set('filter-lang', 'cql2-text');
    }
    return url.toString();
  }

  /* ---------------------------------------------------------------- *
   * Adapter contract
   * ---------------------------------------------------------------- */

  /** @param {string} type */
  supports(type) {
    return OGC_ADAPTER_CAPABILITIES.includes(type);
  }

  /**
   * @param {import('../core/types.js').SpatialOperation} operation
   * @param {Partial<import('../core/types.js').ExecutionContext>} [context]
   */
  async execute(operation, context = {}) {
    const { type, args = {} } = operation;
    const signal = context.signal;

    switch (type) {
      case OPERATION.LAYER_VISIBILITY: return this._setVisibility(operation, args);
      case OPERATION.QUERY_FILTER: return this._query(operation, args, { store: 'layer', signal });
      case OPERATION.QUERY_SELECT: return this._query(operation, args, { store: 'selection', signal });
      case OPERATION.QUERY_SPATIAL_SELECT: return this._spatialSelect(operation, args, signal);
      case OPERATION.QUERY_COUNT: return this._count(operation, args, signal);
      case OPERATION.QUERY_CLEAR: return this._clearFilters(operation);
      case OPERATION.SELECTION_CLEAR: return this._clearSelection();
      case OPERATION.DATA_EXPORT: return this._export(operation, args);
      default:
        throw new AdapterEvaluationError(`Adapter does not support "${type}".`, { type });
    }
  }

  /* ---------------------------------------------------------------- *
   * Operations
   * ---------------------------------------------------------------- */

  _setVisibility(operation, args) {
    const layerId = requireLayerId(operation);
    const entry = this._entry(layerId);
    entry.visible = args.visible !== false;
    this._emit();
    return { layerId, visible: entry.visible };
  }

  async _query(operation, args, { store, signal, extraFilter = null }) {
    const layerId = requireLayerId(operation);
    const entry = this._entry(layerId);
    const filter = andCql2([
      args.predicate ? predicateToCql2(args.predicate, this._cqlOptions(layerId)) : null,
      extraFilter,
    ]);

    const { features, numberMatched, url, pages, truncated, complete } = await this._fetchItems(
      layerId,
      { filter, signal }
    );

    if (store === 'selection') {
      this.selection.set(layerId, features);
      this.selectionComplete.set(layerId, complete);
    } else {
      entry.filter = args.predicate ?? null;
      entry.features = features;
      entry.matched = numberMatched ?? features.length;
      entry.complete = complete;
    }
    this._emit();

    return {
      layerId,
      collection: this.collectionFor(layerId),
      [store === 'selection' ? 'selected' : 'matched']: numberMatched ?? features.length,
      returned: features.length,
      pages,
      // Surfaced so a host never mistakes a page-bounded result for a
      // complete one. `matched` is the service's count; `returned` is what
      // this adapter actually holds.
      truncated,
      complete,
      filter,
      url,
    };
  }

  async _spatialSelect(operation, args, signal) {
    if (args.relation && args.relation !== 'within') {
      throw new AdapterEvaluationError(
        `Spatial relation "${args.relation}" is not supported by this adapter.`,
        { relation: args.relation }
      );
    }

    const meters = distanceToMeters(args.distance);
    const buffers = await this._referenceBuffers(args.reference, meters, signal);
    const spatialFilter = intersectsCql2(buffers, { geometryProperty: this.geometryProperty });

    const result = await this._query(operation, args, {
      store: 'selection',
      signal,
      extraFilter: spatialFilter,
    });

    return {
      ...result,
      distance: { ...args.distance, meters },
      reference: args.reference,
      referenceGeometries: buffers.length,
    };
  }

  async _count(operation, args, signal) {
    const layerId = requireLayerId(operation);
    const filter = args.predicate
      ? predicateToCql2(args.predicate, this._cqlOptions(layerId))
      : null;

    // Ask for a single feature: a conformant service still reports the full
    // match count, which avoids paging an entire collection to count it.
    const probe = await this._fetchPage(layerId, { filter, limit: 1, signal });
    if (typeof probe.body.numberMatched === 'number') {
      return {
        layerId,
        collection: this.collectionFor(layerId),
        count: probe.body.numberMatched,
        filter,
        url: probe.url,
        source: 'numberMatched',
        complete: true,
      };
    }

    const { features, url, complete, pages } = await this._fetchItems(layerId, { filter, signal });

    // A count that stopped at the page bound is not a count. Reporting the
    // features gathered so far as the answer would be a plainly wrong number,
    // and the caller asked "how many", not "how many did you manage to read".
    if (!complete) {
      throw new AdapterEvaluationError(
        `Cannot count collection "${this.collectionFor(layerId)}" exactly: the service does not `
        + `report numberMatched and the result exceeded ${pages} page(s). `
        + 'Raise maxPages, or use a service that reports numberMatched.',
        { layerId, filter, pages, gathered: features.length, url }
      );
    }

    return {
      layerId,
      collection: this.collectionFor(layerId),
      count: features.length,
      filter,
      url,
      source: 'paged',
      complete: true,
    };
  }

  _clearFilters(operation) {
    const target = operation.target;
    const layerIds = target?.kind === 'layer' && target.layerId
      ? [target.layerId]
      : [...this.layers.keys()];

    for (const layerId of layerIds) {
      const entry = this._entry(layerId);
      entry.filter = null;
      entry.features = [];
      entry.matched = null;
      entry.complete = true;
    }
    this._emit();
    return { cleared: layerIds };
  }

  _clearSelection() {
    const cleared = [...this.selection.values()].reduce((sum, list) => sum + list.length, 0);
    this.selection.clear();
    this.selectionComplete.clear();
    this._emit();
    return { cleared };
  }

  _export(operation, args) {
    const target = operation.target;
    let features = [];
    let source = '';
    let complete = true;

    if (target?.kind === 'selection') {
      features = [...this.selection.values()].flat();
      source = 'selection';
      complete = [...this.selection.keys()]
        .every((layerId) => this.selectionComplete.get(layerId) !== false);
    } else if (target?.kind === 'layer' && target.layerId) {
      features = this.getFeatures(target.layerId);
      source = target.layerId;
      complete = this.layers.get(target.layerId)?.complete !== false;
    } else {
      throw new AdapterEvaluationError(
        `Operation "${operation.type}" needs a layer or selection target.`,
        { target: target ?? null }
      );
    }

    if (features.length === 0) {
      throw new AdapterEvaluationError(
        `Nothing to export: ${source} has no fetched features. Run a query first.`,
        { source }
      );
    }

    // An export leaves the application and gets treated as a dataset. Handing
    // out a page-bounded prefix under the layer's name would misrepresent it,
    // so it takes an explicit opt-in.
    if (!complete && args.allowPartial !== true) {
      throw new AdapterEvaluationError(
        `Refusing to export ${source}: the fetched result is incomplete, so the file would `
        + 'not contain every matching feature. Raise maxPages, narrow the query, or pass '
        + 'allowPartial to export the fetched subset deliberately.',
        { source, fetched: features.length }
      );
    }

    const serialized = serializeFeatures(features, args.format, { name: `VoiceGIS ${source}` });
    const filename = `voicegis-${source.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${serialized.extension}`;
    const summary = {
      source,
      format: serialized.format,
      mimeType: serialized.mimeType,
      filename,
      featureCount: features.length,
      byteLength: serialized.content.length,
      complete,
    };

    if (this.onExport) {
      this.onExport({ ...summary, content: serialized.content });
      return summary;
    }
    return { ...summary, content: serialized.content };
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  _entry(layerId) {
    if (!this.layers.has(layerId)) {
      this.layers.set(layerId, {
        visible: true,
        filter: null,
        features: [],
        matched: null,
        total: null,
        complete: true,
      });
    }
    return this.layers.get(layerId);
  }

  _cqlOptions(layerId) {
    const layer = this.catalog?.layers.find((candidate) => candidate.id === layerId);
    return {
      fields: layer ? Object.fromEntries(layer.fields.map((f) => [f.id, f])) : undefined,
      caseInsensitive: this.caseInsensitive,
    };
  }

  /**
   * Issue one request against an already-built URL.
   *
   * @param {string} url
   * @param {{ signal?:AbortSignal, collection?:string }} [options]
   */
  async _request(url, { signal, collection } = {}) {
    const response = await this._fetch(url, {
      signal,
      headers: { accept: 'application/geo+json,application/json', ...this.headers },
    });

    if (!response.ok) {
      const detail = await response.text?.().catch(() => '') ?? '';
      throw new AdapterEvaluationError(
        `Feature service responded ${response.status}`
        + `${collection ? ` for collection "${collection}"` : ''}.`,
        { status: response.status, url, detail: detail.slice(0, 500) }
      );
    }
    return { body: await response.json(), url };
  }

  /**
   * @param {string} layerId
   * @param {OgcPageOptions} [options]
   */
  async _fetchPage(layerId, { filter, limit, offset, signal } = {}) {
    const url = this.buildItemsUrl(layerId, { filter, limit, offset });
    return this._request(url, { signal, collection: this.collectionFor(layerId) });
  }

  /**
   * Resolve the `rel="next"` link of a response against the URL it came from.
   *
   * Services paginate with opaque cursors as often as with offsets, and the
   * href may be relative. Resolving the server's own link is the only correct
   * way to page: synthesising `offset` breaks cursor-based services and can
   * silently skip or repeat features when the result set shifts between
   * requests.
   *
   * @param {object} body
   * @param {string} fromUrl
   * @returns {string|null}
   */
  _nextUrl(body, fromUrl) {
    const link = (body?.links || []).find(
      (candidate) => candidate?.rel === 'next' && candidate.href
    );
    if (!link) return null;

    let resolved;
    try {
      resolved = new URL(link.href, fromUrl).toString();
    } catch {
      throw new AdapterEvaluationError('The service returned an unusable next link.', {
        href: link.href,
        fromUrl,
      });
    }

    if (!this.followCrossOrigin && new URL(resolved).origin !== new URL(this.baseUrl).origin) {
      throw new AdapterEvaluationError(
        'The service paginated to a different origin. Set followCrossOrigin to allow it.',
        { next: resolved, expectedOrigin: new URL(this.baseUrl).origin }
      );
    }
    return resolved;
  }

  /**
   * Fetch every page of a query by following `rel="next"`, bounded by
   * `maxPages`.
   *
   * Returns `complete: false` when the result is known to be a prefix of the
   * real answer. Callers must decide what that means for their operation —
   * a partial map layer is tolerable, a partial count or export is not.
   *
   * @param {string} layerId
   * @param {OgcPageOptions} [options]
   */
  async _fetchItems(layerId, { filter, signal } = {}) {
    const features = [];
    const collection = this.collectionFor(layerId);
    const firstUrl = this.buildItemsUrl(layerId, { filter, limit: this.limit });

    let numberMatched = null;
    let url = firstUrl;
    let pages = 0;
    let truncated = false;
    const visited = new Set();

    while (url) {
      if (visited.has(url)) {
        // A service linking back to a page it already served cannot be paged
        // to completion. Stopping quietly here would return an arbitrary
        // prefix dressed up as the whole answer.
        throw new AdapterEvaluationError(
          `Collection "${collection}" returned a repeating pagination link; `
          + 'the result set cannot be read completely.',
          { url, pages, collection }
        );
      }
      visited.add(url);

      const { body } = await this._request(url, { signal, collection });
      if (pages === 0 && typeof body.numberMatched === 'number') {
        numberMatched = body.numberMatched;
      }
      features.push(...(body.features || []));
      pages += 1;

      url = this._nextUrl(body, url);
      if (url && pages >= this.maxPages) {
        truncated = true;
        break;
      }
    }

    // A service can also under-deliver without a next link.
    const short = typeof numberMatched === 'number' && features.length < numberMatched;

    return {
      features,
      numberMatched,
      url: firstUrl,
      pages,
      truncated,
      complete: !truncated && !short,
    };
  }

  /**
   * Geodesic buffers around the geometries a proximity query measures from.
   */
  async _referenceBuffers(reference, meters, signal) {
    if (reference?.kind !== 'layer' || !reference.layerId) {
      throw new AdapterEvaluationError(
        'A proximity query must reference a catalog layer.',
        { reference: reference ?? null }
      );
    }

    const { body } = await this._fetchPage(reference.layerId, {
      limit: this.referenceLimit,
      signal,
    });
    const features = body.features || [];

    if (features.length === 0) {
      throw new AdapterEvaluationError(
        `Reference layer "${reference.layerId}" returned no features to measure from.`,
        { layerId: reference.layerId }
      );
    }

    // Measuring against a subset of the reference layer silently omits every
    // feature that is only near one of the references we did not fetch. That
    // is a wrong selection, not a partial one, so refuse it.
    const total = body.numberMatched;
    if (typeof total === 'number' && total > features.length) {
      throw new AdapterEvaluationError(
        `Reference layer "${reference.layerId}" has ${total} features but only `
        + `${features.length} were fetched (referenceLimit). A proximity query against a subset `
        + 'would miss matches. Raise referenceLimit or filter the reference layer first.',
        { layerId: reference.layerId, total, fetched: features.length }
      );
    }

    const buffers = [];
    for (const feature of features) {
      const { points, lines, polygons } = decomposeGeometry(feature.geometry);
      if (lines.length > 0 || polygons.length > 0) {
        throw new AdapterEvaluationError(
          'Proximity queries against non-point reference features need a server-side '
          + 'distance function. Reference a point layer, or supply your own spatial filter.',
          { layerId: reference.layerId, geometryType: feature.geometry?.type }
        );
      }
      for (const point of points) buffers.push(geodesicCircle(point, meters, 32));
    }
    return buffers;
  }

  _emit() {
    if (this._listeners.size === 0) return;
    const state = this.getState();
    for (const listener of this._listeners) listener(state);
  }
}

/**
 * @param {Partial<OgcApiFeaturesAdapterOptions>} [options]
 * @returns {OgcApiFeaturesAdapter}
 */
export function createOgcApiFeaturesAdapter(options) {
  return new OgcApiFeaturesAdapter(options);
}
