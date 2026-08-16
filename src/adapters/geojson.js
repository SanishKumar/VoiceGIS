/**
 * A real execution adapter for GeoJSON feature collections.
 *
 * It executes the typed operations produced by the command compiler against
 * in-memory features: attribute filters, selections, proximity selections,
 * counts, buffers, and exports. Most open spatial data is published as
 * GeoJSON, so this adapter turns VoiceGIS Core into something that does
 * useful work without any server, key, or vendor SDK.
 *
 * The adapter owns query state (filters, selection, visibility, buffers) and
 * notifies the host after every mutation so the host can render. It never
 * touches a map itself.
 *
 * @module adapters/geojson
 */

import { OPERATION } from '../core/constants.js';
import { SpatialCatalog } from '../core/SpatialCatalog.js';
import {
  AdapterEvaluationError,
  bboxIntersects,
  bboxOf,
  decomposeGeometry,
  distanceToMeters,
  evaluatePredicate,
  geodesicCircle,
  geometryDistanceMeters,
  padBbox,
} from './predicate.js';
import { serializeFeatures } from './serialize.js';

/**
 * Operations this adapter can execute.
 * @type {readonly string[]}
 */
export const GEOJSON_ADAPTER_CAPABILITIES = Object.freeze([
  OPERATION.LAYER_VISIBILITY,
  OPERATION.QUERY_FILTER,
  OPERATION.QUERY_CLEAR,
  OPERATION.QUERY_SELECT,
  OPERATION.QUERY_SPATIAL_SELECT,
  OPERATION.QUERY_COUNT,
  OPERATION.SELECTION_CLEAR,
  OPERATION.ANALYSIS_BUFFER,
  OPERATION.DATA_EXPORT,
]);

function normalizeCollection(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data.type === 'FeatureCollection') return data.features || [];
  if (data.type === 'Feature') return [data];
  throw new AdapterEvaluationError('Layer data must be a FeatureCollection or an array of features.', {
    received: data?.type ?? typeof data,
  });
}

/**
 * Precompute the per-feature information every operation needs, so repeated
 * queries never re-walk raw geometry.
 */
function indexFeatures(layerId, data, idProperty) {
  const features = normalizeCollection(data);
  const used = new Set();

  return features.map((feature, index) => {
    const raw = feature.id ?? (idProperty ? feature.properties?.[idProperty] : undefined);
    let id = raw === undefined || raw === null || raw === '' ? `${layerId}:${index}` : String(raw);
    if (used.has(id)) id = `${id}#${index}`;
    used.add(id);

    return {
      id,
      feature,
      properties: feature.properties || {},
      geometry: feature.geometry || null,
      bbox: feature.geometry ? bboxOf(feature.geometry) : null,
    };
  });
}

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
 * Executes VoiceGIS operations against GeoJSON layers.
 */
export class GeoJSONAdapter {
  /**
   * @param {object} [options]
   * @param {string} [options.name]
   * @param {Record<string, object|{data:object, idProperty?:string}>} [options.layers]
   * @param {SpatialCatalog|import('../core/types.js').CatalogDefinition} [options.catalog]
   *   Supplies field units so spoken units are reconciled with stored units.
   * @param {boolean} [options.caseSensitive=false]
   * @param {number} [options.bufferSteps=64]
   * @param {(state:object) => void} [options.onChange]
   * @param {(payload:{content:string, filename:string, mimeType:string, featureCount:number}) => void} [options.onExport]
   *   When supplied, export content is handed to the host and kept out of the
   *   execution receipt.
   */
  constructor(options = {}) {
    this.name = options.name || 'geojson-adapter';
    this.capabilities = GEOJSON_ADAPTER_CAPABILITIES;
    this.caseSensitive = options.caseSensitive === true;
    this.bufferSteps = options.bufferSteps || 64;
    this.onExport = options.onExport || null;

    this.catalog = options.catalog
      ? (options.catalog instanceof SpatialCatalog
        ? options.catalog
        : new SpatialCatalog(options.catalog))
      : null;

    /** @type {Map<string, {records:object[], visible:boolean, filter:object|null, matched:Set<string>|null, idProperty:string|undefined}>} */
    this.layers = new Map();
    /** @type {Map<string, Set<string>>} */
    this.selection = new Map();
    /** @type {object|null} */
    this.buffers = null;
    /** @type {Set<Function>} */
    this._listeners = new Set();

    if (options.onChange) this._listeners.add(options.onChange);

    for (const [layerId, value] of Object.entries(options.layers || {})) {
      const isWrapped = value && !Array.isArray(value) && 'data' in value && !value.type;
      this.setLayerData(
        layerId,
        isWrapped ? value.data : value,
        { idProperty: isWrapped ? value.idProperty : undefined, silent: true }
      );
    }
  }

  /* ---------------------------------------------------------------- *
   * Host-facing API
   * ---------------------------------------------------------------- */

  /**
   * Load or replace a layer's features. Existing filters are re-evaluated so
   * a refreshed live feed keeps the user's current query applied.
   *
   * @param {string} layerId
   * @param {object|object[]} data
   * @param {{ idProperty?:string, silent?:boolean }} [options]
   */
  setLayerData(layerId, data, options = {}) {
    const existing = this.layers.get(layerId);
    const idProperty = options.idProperty ?? existing?.idProperty;
    const entry = {
      records: indexFeatures(layerId, data, idProperty),
      visible: existing?.visible ?? true,
      filter: existing?.filter ?? null,
      matched: null,
      idProperty,
    };
    this.layers.set(layerId, entry);

    if (entry.filter) entry.matched = this._match(entry, entry.filter, layerId);
    // Drop selected ids that no longer exist in the refreshed data.
    const selected = this.selection.get(layerId);
    if (selected) {
      const live = new Set(entry.records.map((record) => record.id));
      this.selection.set(layerId, new Set([...selected].filter((id) => live.has(id))));
    }

    if (!options.silent) this._emit();
    return this;
  }

  /** @param {(state:object) => void} listener */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * A serializable snapshot of current query state.
   */
  getState() {
    /** @type {Record<string, object>} */
    const layers = {};
    for (const [layerId, entry] of this.layers) {
      layers[layerId] = {
        visible: entry.visible,
        total: entry.records.length,
        filter: entry.filter,
        matched: entry.matched ? entry.matched.size : entry.records.length,
        selected: this.selection.get(layerId)?.size ?? 0,
      };
    }
    return {
      layers,
      selection: Object.fromEntries(
        [...this.selection].map(([layerId, ids]) => [layerId, [...ids]])
      ),
      buffers: this.buffers,
    };
  }

  /**
   * Read features for rendering.
   *
   * @param {string} layerId
   * @param {{ scope?: 'all'|'filtered'|'selected' }} [options]
   * @returns {object[]} GeoJSON features
   */
  getFeatures(layerId, options = {}) {
    const entry = this._layer(layerId);
    const scope = options.scope || 'filtered';

    if (scope === 'all') return entry.records.map((record) => record.feature);
    if (scope === 'selected') {
      const selected = this.selection.get(layerId);
      if (!selected || selected.size === 0) return [];
      return entry.records.filter((record) => selected.has(record.id)).map((r) => r.feature);
    }
    if (!entry.matched) return entry.records.map((record) => record.feature);
    return entry.records.filter((record) => entry.matched.has(record.id)).map((r) => r.feature);
  }

  /** @param {string} layerId */
  isSelected(layerId, featureId) {
    return this.selection.get(layerId)?.has(String(featureId)) === true;
  }

  /* ---------------------------------------------------------------- *
   * Adapter contract
   * ---------------------------------------------------------------- */

  /** @param {string} type */
  supports(type) {
    return GEOJSON_ADAPTER_CAPABILITIES.includes(type);
  }

  /**
   * @param {import('../core/types.js').SpatialOperation} operation
   * @returns {Promise<*>}
   */
  async execute(operation) {
    const { type, args = {} } = operation;

    switch (type) {
      case OPERATION.LAYER_VISIBILITY: return this._setVisibility(operation, args);
      case OPERATION.QUERY_FILTER: return this._filter(operation, args);
      case OPERATION.QUERY_CLEAR: return this._clearFilters(operation);
      case OPERATION.QUERY_SELECT: return this._select(operation, args);
      case OPERATION.QUERY_SPATIAL_SELECT: return this._spatialSelect(operation, args);
      case OPERATION.QUERY_COUNT: return this._count(operation, args);
      case OPERATION.SELECTION_CLEAR: return this._clearSelection();
      case OPERATION.ANALYSIS_BUFFER: return this._buffer(operation, args);
      case OPERATION.DATA_EXPORT: return this._export(operation, args);
      default:
        throw new AdapterEvaluationError(`Adapter does not support "${type}".`, { type });
    }
  }

  /* ---------------------------------------------------------------- *
   * Operation implementations
   * ---------------------------------------------------------------- */

  _setVisibility(operation, args) {
    const layerId = requireLayerId(operation);
    const entry = this._layer(layerId);
    entry.visible = args.visible !== false;
    this._emit();
    return { layerId, visible: entry.visible, featureCount: entry.records.length };
  }

  _filter(operation, args) {
    const layerId = requireLayerId(operation);
    const entry = this._layer(layerId);
    entry.filter = args.predicate;
    entry.matched = this._match(entry, args.predicate, layerId);
    this._emit();
    return {
      layerId,
      matched: entry.matched.size,
      total: entry.records.length,
    };
  }

  _clearFilters(operation) {
    const target = operation.target;
    const layerIds = target?.kind === 'layer' && target.layerId
      ? [target.layerId]
      : [...this.layers.keys()];

    for (const layerId of layerIds) {
      const entry = this._layer(layerId);
      entry.filter = null;
      entry.matched = null;
    }
    this._emit();
    return { cleared: layerIds };
  }

  _select(operation, args) {
    const layerId = requireLayerId(operation);
    const entry = this._layer(layerId);
    const matched = this._match(entry, args.predicate, layerId);
    this.selection.set(layerId, matched);
    this._emit();
    return { layerId, selected: matched.size, total: entry.records.length };
  }

  _spatialSelect(operation, args) {
    const layerId = requireLayerId(operation);
    const entry = this._layer(layerId);

    if (args.relation && args.relation !== 'within') {
      throw new AdapterEvaluationError(
        `Spatial relation "${args.relation}" is not supported by this adapter.`,
        { relation: args.relation }
      );
    }

    const meters = distanceToMeters(args.distance);
    const referenceGeometries = this._referenceGeometries(args.reference);

    // Restrict to whatever the user is currently looking at, so proximity
    // queries compose with a filter applied moments earlier.
    const scope = entry.matched ? 'filtered' : 'all';
    const candidates = entry.matched
      ? entry.records.filter((record) => entry.matched.has(record.id))
      : entry.records;

    const referenceBoxes = referenceGeometries
      .map((geometry) => bboxOf(geometry))
      .filter(Boolean)
      .map((box) => padBbox(box, meters));

    const selected = new Set();
    for (const record of candidates) {
      if (!record.geometry) continue;
      if (record.bbox && referenceBoxes.length > 0
        && !referenceBoxes.some((box) => bboxIntersects(record.bbox, box))) {
        continue;
      }
      const near = referenceGeometries.some(
        (geometry) => geometryDistanceMeters(record.geometry, geometry) <= meters
      );
      if (near) selected.add(record.id);
    }

    this.selection.set(layerId, selected);
    this._emit();

    return {
      layerId,
      selected: selected.size,
      evaluated: candidates.length,
      scope,
      distance: { ...args.distance, meters },
      reference: args.reference,
    };
  }

  _count(operation, args) {
    const layerId = requireLayerId(operation);
    const entry = this._layer(layerId);

    if (args.predicate) {
      const matched = this._match(entry, args.predicate, layerId);
      return { layerId, count: matched.size, total: entry.records.length, scope: 'predicate' };
    }
    return {
      layerId,
      count: entry.matched ? entry.matched.size : entry.records.length,
      total: entry.records.length,
      scope: entry.matched ? 'filtered' : 'all',
    };
  }

  _clearSelection() {
    const cleared = [...this.selection.values()].reduce((sum, ids) => sum + ids.size, 0);
    this.selection.clear();
    this._emit();
    return { cleared };
  }

  _buffer(operation, args) {
    const meters = distanceToMeters(args.distance);
    const { features, source } = this._targetFeatures(operation);

    if (features.length === 0) {
      throw new AdapterEvaluationError(
        `Nothing to buffer: ${source} contains no features.`,
        { source }
      );
    }

    const buffered = features.map((feature) => {
      const { points, lines, polygons } = decomposeGeometry(feature.geometry);
      if (lines.length > 0 || polygons.length > 0) {
        // Offsetting lines and areas is real computational geometry. Refusing
        // is better than quietly returning a wrong shape.
        throw new AdapterEvaluationError(
          'This adapter buffers point geometry only. Buffer lines and areas in your spatial backend.',
          { geometryType: feature.geometry?.type }
        );
      }
      return {
        type: 'Feature',
        id: feature.id,
        properties: {
          ...feature.properties,
          _buffer_radius_m: meters,
        },
        geometry: points.length === 1
          ? geodesicCircle(points[0], meters, this.bufferSteps)
          : {
            type: 'MultiPolygon',
            coordinates: points.map(
              (point) => geodesicCircle(point, meters, this.bufferSteps).coordinates
            ),
          },
      };
    });

    this.buffers = { type: 'FeatureCollection', features: buffered };
    this._emit();

    return {
      source,
      featureCount: buffered.length,
      distance: { ...args.distance, meters },
    };
  }

  _export(operation, args) {
    const { features, source } = this._targetFeatures(operation);

    if (features.length === 0) {
      throw new AdapterEvaluationError(
        `Nothing to export: ${source} contains no features.`,
        { source }
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

  _layer(layerId) {
    const entry = this.layers.get(layerId);
    if (!entry) {
      throw new AdapterEvaluationError(`Layer "${layerId}" has no data loaded in this adapter.`, {
        layerId,
        loaded: [...this.layers.keys()],
      });
    }
    return entry;
  }

  /** Field definitions keyed by id, used to reconcile spoken and stored units. */
  _fieldsFor(layerId) {
    const layer = this.catalog?.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return undefined;
    return Object.fromEntries(layer.fields.map((field) => [field.id, field]));
  }

  _match(entry, predicate, layerId) {
    const options = { fields: this._fieldsFor(layerId), caseSensitive: this.caseSensitive };
    const matched = new Set();
    for (const record of entry.records) {
      if (evaluatePredicate(predicate, record.properties, options)) matched.add(record.id);
    }
    return matched;
  }

  _referenceGeometries(reference) {
    if (reference?.kind === 'layer' && reference.layerId) {
      const entry = this._layer(reference.layerId);
      const source = entry.matched
        ? entry.records.filter((record) => entry.matched.has(record.id))
        : entry.records;
      const geometries = source.map((record) => record.geometry).filter(Boolean);
      if (geometries.length === 0) {
        throw new AdapterEvaluationError(
          `Reference layer "${reference.layerId}" has no geometry to measure from.`,
          { layerId: reference.layerId }
        );
      }
      return geometries;
    }

    if (reference?.kind === 'selection') {
      const geometries = [...this.selection.keys()].flatMap(
        (layerId) => this.getFeatures(layerId, { scope: 'selected' }).map((f) => f.geometry)
      ).filter(Boolean);
      if (geometries.length === 0) {
        throw new AdapterEvaluationError('Nothing is selected to measure from.', {});
      }
      return geometries;
    }

    // The compiler emits a literal when a spoken reference is not a catalog
    // layer. Resolving free text to a place is the host's decision.
    throw new AdapterEvaluationError(
      `Spatial reference ${JSON.stringify(reference?.value ?? reference ?? null)} is not a catalog layer. `
      + 'Resolve it to a layer or coordinates before executing.',
      { reference: reference ?? null }
    );
  }

  /**
   * Resolve the feature set an operation targets, for buffer and export.
   */
  _targetFeatures(operation) {
    const target = operation.target;

    if (target?.kind === 'selection') {
      const features = [...this.selection.keys()].flatMap(
        (layerId) => this.getFeatures(layerId, { scope: 'selected' })
      );
      return { features, source: 'selection' };
    }
    if (target?.kind === 'layer' && target.layerId) {
      return {
        features: this.getFeatures(target.layerId, { scope: 'filtered' }),
        source: target.layerId,
      };
    }
    throw new AdapterEvaluationError(
      `Operation "${operation.type}" needs a layer or selection target.`,
      { target: target ?? null }
    );
  }

  _emit() {
    if (this._listeners.size === 0) return;
    const state = this.getState();
    for (const listener of this._listeners) listener(state);
  }
}

/**
 * @param {ConstructorParameters<typeof GeoJSONAdapter>[0]} [options]
 * @returns {GeoJSONAdapter}
 */
export function createGeoJSONAdapter(options = {}) {
  return new GeoJSONAdapter(options);
}
