/**
 * A deterministic gazetteer resolver for navigation commands.
 *
 * Applications that want "go to Delhi" to work should not have to accept an
 * uncontrolled network call to a geocoding service. This resolver answers
 * navigation requests from a place list the application supplies and owns,
 * and returns an actionable clarification when a place is not in that list.
 *
 * Cities resolve to a centre point; countries and regions resolve to bounds,
 * so an adapter can frame the whole extent instead of dropping a pin in the
 * middle of it.
 *
 * @module core/createPlaceResolver
 */

import { damerauLevenshtein } from '../parser/fuzzyMatch.js';
import { OPERATION } from './constants.js';

/**
 * @typedef {object} PlaceDefinition
 * @property {string} id
 * @property {string} [name] - Display name; defaults to the id.
 * @property {string[]} [aliases]
 * @property {'city'|'country'|'region'|string} [kind]
 * @property {[number, number]} [center] - `[lat, lon]`.
 * @property {number} [zoom] - Suggested zoom for a centre-based place.
 * @property {[[number, number], [number, number]]} [bounds]
 *   `[[south, west], [north, east]]`, matching Leaflet's LatLngBounds order.
 */

/**
 * Navigation phrasings this resolver claims.
 *
 * Deliberately narrow: patterns like "show me X" collide with layer commands
 * such as "show earthquakes where …", and a resolver runs before the
 * catalog-grounded compiler, so an over-eager pattern would hijack them.
 */
export const PLACE_NAVIGATION_PATTERNS = Object.freeze([
  /^(?:go|zoom|fly|navigate|move|pan|jump)\s+to\s+(.+)$/i,
  /^take\s+me\s+to\s+(.+)$/i,
  /^cent(?:er|re)\s+(?:on|at)\s+(.+)$/i,
  /^where\s+is\s+(.+?)\s*\??$/i,
]);

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/, '')
    .replace(/^the\s+/, '');
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateCenter(center, id) {
  if (!Array.isArray(center) || center.length < 2
    || !isFiniteNumber(center[0]) || !isFiniteNumber(center[1])) {
    throw new TypeError(`Place "${id}" has an invalid center; expected [lat, lon].`);
  }
  if (center[0] < -90 || center[0] > 90 || center[1] < -180 || center[1] > 180) {
    throw new TypeError(`Place "${id}" has a center outside valid coordinate ranges.`);
  }
}

function validateBounds(bounds, id) {
  const shaped = Array.isArray(bounds) && bounds.length === 2
    && Array.isArray(bounds[0]) && Array.isArray(bounds[1]);
  if (!shaped) {
    throw new TypeError(
      `Place "${id}" has invalid bounds; expected [[south, west], [north, east]].`
    );
  }
  const [[south, west], [north, east]] = bounds;
  for (const value of [south, west, north, east]) {
    if (!isFiniteNumber(value)) {
      throw new TypeError(`Place "${id}" has a non-numeric bounds coordinate.`);
    }
  }
  if (south >= north) {
    throw new TypeError(`Place "${id}" has bounds whose south edge is not below its north edge.`);
  }
  if (west >= east) {
    throw new TypeError(`Place "${id}" has bounds whose west edge is not left of its east edge.`);
  }
}

function normalizePlace(place, fallbackId) {
  const input = typeof place === 'string' ? { id: place } : { ...place };
  const id = String(input.id || fallbackId || '').trim();
  if (!id) throw new TypeError('Every place must have an id.');

  if (!input.center && !input.bounds) {
    throw new TypeError(`Place "${id}" must define a center or bounds.`);
  }
  if (input.center) validateCenter(input.center, id);
  if (input.bounds) validateBounds(input.bounds, id);

  const name = input.name || id;
  const aliases = [...new Set((input.aliases || []).map(normalize).filter(Boolean))];

  return Object.freeze({
    ...input,
    id,
    name,
    kind: input.kind || (input.bounds ? 'region' : 'city'),
    aliases: Object.freeze(aliases),
    names: Object.freeze([...new Set([normalize(id), normalize(name), ...aliases])]),
  });
}

/**
 * A searchable place index.
 */
export class PlaceIndex {
  /** @param {Array<PlaceDefinition|string>|Record<string, Omit<PlaceDefinition,'id'>>} places */
  constructor(places = []) {
    const list = Array.isArray(places)
      ? places.map((place) => normalizePlace(place))
      : Object.entries(places).map(([id, place]) => normalizePlace(place, id));

    const seen = new Set();
    for (const place of list) {
      if (seen.has(place.id)) throw new TypeError(`Duplicate place id "${place.id}".`);
      seen.add(place.id);
    }

    this.places = Object.freeze(list);
    /** @type {Map<string, object>} */
    this._byName = new Map();
    for (const place of list) {
      for (const name of place.names) {
        if (!this._byName.has(name)) this._byName.set(name, place);
      }
    }
  }

  /**
   * Resolve a spoken place phrase.
   * @param {string} value
   * @param {{ threshold?: number }} [options]
   * @returns {{ place: object, score: number, fuzzy: boolean }|null}
   */
  resolve(value, options = {}) {
    const query = normalize(value);
    if (!query) return null;

    const exact = this._byName.get(query);
    if (exact) return { place: exact, score: 1, fuzzy: false };

    const threshold = options.threshold ?? 0.72;
    const ranked = this.rank(query);
    const best = ranked[0];
    if (best && best.score >= threshold) {
      return { place: best.place, score: best.score, fuzzy: true };
    }
    return null;
  }

  /**
   * Every place ranked by similarity to a query, best first.
   * @param {string} value
   * @returns {Array<{ place: object, name: string, score: number }>}
   */
  rank(value) {
    const query = normalize(value);
    const scored = [];

    for (const place of this.places) {
      let best = 0;
      let bestName = place.name;
      for (const name of place.names) {
        const maxLength = Math.max(query.length, name.length);
        const score = maxLength === 0 ? 1 : 1 - damerauLevenshtein(query, name) / maxLength;
        if (score > best) {
          best = score;
          bestName = name;
        }
      }
      scored.push({ place, name: bestName, score: best });
    }

    return scored.sort((a, b) => b.score - a.score);
  }
}

/**
 * @typedef {object} PlaceResolverOptions
 * @property {Array<PlaceDefinition|string>|Record<string, Omit<PlaceDefinition,'id'>>|PlaceIndex} places
 * @property {number} [defaultZoom] - Zoom for centre-based places without their own. Defaults to 10.
 * @property {number} [maxSuggestions] - Defaults to 3.
 * @property {number} [threshold] - Minimum similarity accepted as a match. Defaults to 0.72.
 * @property {number} [suggestionFloor]
 *   Below this similarity the clarification offers examples instead of
 *   "did you mean", because a bad guess is worse than an honest list.
 *   Defaults to 0.34.
 * @property {RegExp[]} [patterns]
 */

/**
 * Build a compiler resolver that answers navigation commands from a gazetteer.
 *
 * @param {Partial<PlaceResolverOptions>} [options]
 * @returns {import('./types.js').CommandResolver}
 */
export function createPlaceResolver(options = {}) {
  const index = options.places instanceof PlaceIndex
    ? options.places
    : new PlaceIndex(options.places);
  const defaultZoom = options.defaultZoom ?? 10;
  const maxSuggestions = options.maxSuggestions ?? 3;
  const threshold = options.threshold ?? 0.72;
  const suggestionFloor = options.suggestionFloor ?? 0.34;
  const patterns = options.patterns || PLACE_NAVIGATION_PATTERNS;

  return function placeResolver({ text }) {
    let phrase = null;
    for (const pattern of patterns) {
      const match = String(text ?? '').trim().match(pattern);
      if (match) {
        phrase = match[1];
        break;
      }
    }
    if (!phrase) return null;

    const resolved = index.resolve(phrase, { threshold });
    if (resolved) {
      const { place, score } = resolved;
      const args = place.bounds
        ? { bounds: place.bounds }
        : { center: place.center, zoom: place.zoom ?? defaultZoom };

      return {
        operations: [{
          type: OPERATION.VIEW_SET,
          target: { kind: 'place', name: place.name, id: place.id, placeKind: place.kind },
          args: { ...args, source: 'gazetteer' },
          confidence: score,
        }],
        issues: [],
      };
    }

    const ranked = index.rank(phrase).slice(0, maxSuggestions);
    const strong = ranked.filter((entry) => entry.score >= suggestionFloor);
    const suggestions = (strong.length > 0 ? strong : ranked).map((entry) => entry.place.name);
    const suggestionKind = strong.length > 0 ? 'did_you_mean' : 'examples';
    const spoken = normalize(phrase);

    return {
      operations: [],
      issues: [{
        code: 'unknown_place',
        severity: 'input',
        message: suggestions.length === 0
          ? `"${spoken}" is not a known place.`
          : suggestionKind === 'did_you_mean'
            ? `"${spoken}" is not a known place. Did you mean ${suggestions.join(', ')}?`
            : `"${spoken}" is not a known place. Known places include ${suggestions.join(', ')}.`,
        details: { place: spoken, suggestions, suggestionKind },
      }],
    };
  };
}
