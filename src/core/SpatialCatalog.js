import { fuzzyMatch } from '../parser/fuzzyMatch.js';

function normalizeText(value) {
  return String(value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizeAliases(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalizeText).filter(Boolean))];
}

function normalizeField(field, fallbackId) {
  const input = typeof field === 'string' ? { id: field } : { ...field };
  const id = String(input.id || fallbackId || '').trim();
  if (!id) throw new TypeError('Every catalog field must have an id.');

  return Object.freeze({
    ...input,
    id,
    label: input.label || id,
    aliases: normalizeAliases(input.aliases),
    type: input.type || 'string',
  });
}

function normalizeFields(fields) {
  if (!fields) return [];
  if (Array.isArray(fields)) return fields.map((field) => normalizeField(field));
  return Object.entries(fields).map(([id, field]) => normalizeField(field, id));
}

function normalizeLayer(layer, fallbackId) {
  const input = typeof layer === 'string' ? { id: layer } : { ...layer };
  const id = String(input.id || fallbackId || '').trim();
  if (!id) throw new TypeError('Every catalog layer must have an id.');

  const fields = normalizeFields(input.fields);
  const fieldIds = new Set();
  for (const field of fields) {
    if (fieldIds.has(field.id)) {
      throw new TypeError(`Duplicate field id "${field.id}" in layer "${id}".`);
    }
    fieldIds.add(field.id);
  }

  return Object.freeze({
    ...input,
    id,
    label: input.label || id,
    aliases: normalizeAliases(input.aliases),
    fields: Object.freeze(fields),
    capabilities: input.capabilities
      ? Object.freeze([...new Set(input.capabilities.map(String))])
      : null,
  });
}

/**
 * A small, serializable description of the layers and fields an application
 * exposes to natural-language commands.
 */
export class SpatialCatalog {
  /**
   * @param {import('./types.js').CatalogDefinition|Array<import('./types.js').CatalogLayer|string>} [definition]
   */
  constructor(definition = {}) {
    const source = Array.isArray(definition) ? { layers: definition } : definition;
    const layerInput = source.layers || [];
    const layers = Array.isArray(layerInput)
      ? layerInput.map((layer) => normalizeLayer(layer))
      : Object.entries(layerInput).map(([id, layer]) => normalizeLayer(layer, id));

    const layerIds = new Set();
    for (const layer of layers) {
      if (layerIds.has(layer.id)) throw new TypeError(`Duplicate layer id "${layer.id}".`);
      layerIds.add(layer.id);
    }

    this.version = String(source.version || '1');
    this.layers = Object.freeze(layers);
  }

  /**
   * Resolve a layer id, label, or alias.
   * @param {string} value
   * @param {{ fuzzy?: boolean }} [options]
   */
  resolveLayer(value, options = {}) {
    const query = normalizeText(value).replace(/\s+layer$/, '');
    if (!query) return null;

    for (const layer of this.layers) {
      const names = [layer.id, layer.label, ...layer.aliases].map(normalizeText);
      if (names.includes(query)) return { layer, matched: query, score: 1, fuzzy: false };
    }

    if (options.fuzzy === false) return null;
    const candidates = [];
    const owners = new Map();
    for (const layer of this.layers) {
      for (const name of [layer.id, layer.label, ...layer.aliases].map(normalizeText)) {
        if (!owners.has(name)) {
          candidates.push(name);
          owners.set(name, layer);
        }
      }
    }
    const match = fuzzyMatch(query, candidates, {
      maxDistance: Math.max(2, Math.floor(query.length * 0.2)),
      threshold: 0.72,
    });
    if (!match) return null;
    return {
      layer: owners.get(match.match),
      matched: match.match,
      score: match.score,
      fuzzy: true,
    };
  }

  /**
   * Find the longest catalog layer name occurring in free text.
   * @param {string} text
   */
  findLayer(text) {
    const normalized = normalizeText(text);
    let best = null;
    for (const layer of this.layers) {
      for (const name of [layer.id, layer.label, ...layer.aliases].map(normalizeText)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (name && new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, 'i').test(normalized)) {
          if (!best || name.length > best.matched.length) {
            best = { layer, matched: name, score: 1, fuzzy: false };
          }
        }
      }
    }
    return best;
  }

  /**
   * Resolve a field for a specific layer.
   * @param {object|string} layerOrId
   * @param {string} value
   * @param {{ fuzzy?: boolean }} [options]
   */
  resolveField(layerOrId, value, options = {}) {
    const layer = typeof layerOrId === 'string'
      ? this.resolveLayer(layerOrId)?.layer
      : layerOrId;
    if (!layer) return null;

    const query = normalizeText(value);
    for (const field of layer.fields) {
      const names = [field.id, field.label, ...field.aliases].map(normalizeText);
      if (names.includes(query)) return { field, matched: query, score: 1, fuzzy: false };
    }

    if (options.fuzzy === false) return null;
    const candidates = [];
    const owners = new Map();
    for (const field of layer.fields) {
      for (const name of [field.id, field.label, ...field.aliases].map(normalizeText)) {
        if (!owners.has(name)) {
          candidates.push(name);
          owners.set(name, field);
        }
      }
    }
    const match = fuzzyMatch(query, candidates, {
      maxDistance: Math.max(2, Math.floor(query.length * 0.2)),
      threshold: 0.72,
    });
    if (!match) return null;
    return {
      field: owners.get(match.match),
      matched: match.match,
      score: match.score,
      fuzzy: true,
    };
  }

  /**
   * Whether a catalog layer explicitly supports an operation. Omitting a
   * capability list delegates the decision to the adapter.
   * @param {object|string} layerOrId
   * @param {string} operationType
   */
  supports(layerOrId, operationType) {
    const layer = typeof layerOrId === 'string'
      ? this.resolveLayer(layerOrId)?.layer
      : layerOrId;
    if (!layer) return false;
    return layer.capabilities === null || layer.capabilities.includes(operationType);
  }

  toJSON() {
    return { version: this.version, layers: this.layers };
  }
}
