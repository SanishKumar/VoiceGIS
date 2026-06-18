/**
 * commandParser.js
 * Converts recognized speech text into structured map action objects.
 *
 * Supports intents:
 *   zoom_in, zoom_out, go_to, show_layer, hide_layer,
 *   add_marker, switch_map, reset_view
 *
 * @module parser/CommandParser
 */

import { fuzzyMatch, fuzzyResolveLayer, fuzzyResolveCity } from './fuzzyMatch.js';
import { Geocoder } from './geocoder.js';

/** Canonical intent names */
export const INTENT = {
  ZOOM_IN: 'zoom_in',
  ZOOM_OUT: 'zoom_out',
  GO_TO: 'go_to',
  SHOW_LAYER: 'show_layer',
  HIDE_LAYER: 'hide_layer',
  ADD_MARKER: 'add_marker',
  SWITCH_MAP: 'switch_map',
  RESET_VIEW: 'reset_view',
  UNDO: 'undo',
  REDO: 'redo',
  UNKNOWN: 'unknown',
};

/**
 * Known city / place coordinates [lat, lng].
 * Fallback for offline mode or fast local resolution.
 */
export const CITY_COORDS = {
  ahmedabad: [23.0225, 72.5714],
  paris: [48.8566, 2.3522],
  'new york': [40.7128, -74.006],
  london: [51.5074, -0.1278],
  tokyo: [35.6762, 139.6503],
  mumbai: [19.076, 72.8777],
  delhi: [28.6139, 77.209],
  sydney: [-33.8688, 151.2093],
  beijing: [39.9042, 116.4074],
  moscow: [55.7558, 37.6173],
  berlin: [52.52, 13.405],
  'los angeles': [34.0522, -118.2437],
  chicago: [41.8781, -87.6298],
  toronto: [43.6532, -79.3832],
  dubai: [25.2048, 55.2708],
  singapore: [1.3521, 103.8198],
  cairo: [30.0444, 31.2357],
  lagos: [6.5244, 3.3792],
  nairobi: [-1.2921, 36.8219],
  'sao paulo': [-23.5505, -46.6333],
  'buenos aires': [-34.6037, -58.3816],
  'mexico city': [19.4326, -99.1332],
  bangalore: [12.9716, 77.5946],
  kolkata: [22.5726, 88.3639],
  chennai: [13.0827, 80.2707],
  hyderabad: [17.385, 78.4867],
  pune: [18.5204, 73.8567],
  rome: [41.9028, 12.4964],
  madrid: [40.4168, -3.7038],
  amsterdam: [52.3676, 4.9041],
  stockholm: [59.3293, 18.0686],
  oslo: [59.9139, 10.7522],
  seoul: [37.5665, 126.978],
  'kuala lumpur': [3.139, 101.6869],
  bangkok: [13.7563, 100.5018],
  jakarta: [-6.2088, 106.8456],
  manila: [14.5995, 120.9842],
  karachi: [24.8607, 67.0011],
  dhaka: [23.8103, 90.4125],
  tehran: [35.6892, 51.389],
  istanbul: [41.0082, 28.9784],
  accra: [5.6037, -0.187],
  'cape town': [-33.9249, 18.4241],
  johannesburg: [-26.2041, 28.0473],
};

/**
 * Layer alias → canonical layer id mapping.
 */
export const LAYER_ALIASES = {
  osm: 'osm',
  road: 'osm',
  roads: 'osm',
  'road view': 'osm',
  street: 'osm',
  streets: 'osm',
  'open street': 'osm',
  openstreetmap: 'osm',
  satellite: 'nasa',
  'satellite view': 'nasa',
  nasa: 'nasa',
  'nasa satellite': 'nasa',
  'nasa gibs': 'nasa',
  worldview: 'nasa',
  bhuvan: 'bhuvan',
  india: 'bhuvan',
  'india map': 'bhuvan',
  nrsc: 'bhuvan',
  copernicus: 'copernicus',
  land: 'copernicus',
  'land cover': 'copernicus',
  terrain: 'terrain',
  topo: 'terrain',
  topographic: 'terrain',
};

const SIMPLE_INTENT_PHRASES = {
  'zoom in': { intent: INTENT.ZOOM_IN },
  'magnify': { intent: INTENT.ZOOM_IN },
  'enlarge': { intent: INTENT.ZOOM_IN },
  'zoom out': { intent: INTENT.ZOOM_OUT },
  'shrink': { intent: INTENT.ZOOM_OUT },
  'minify': { intent: INTENT.ZOOM_OUT },
  'reset view': { intent: INTENT.RESET_VIEW },
  'home': { intent: INTENT.RESET_VIEW },
  'default view': { intent: INTENT.RESET_VIEW },
  'add marker': { intent: INTENT.ADD_MARKER, payload: { useCurrentLocation: false } },
  'drop a pin': { intent: INTENT.ADD_MARKER, payload: { useCurrentLocation: false } },
  'place a marker': { intent: INTENT.ADD_MARKER, payload: { useCurrentLocation: false } },
  'add marker at my location': { intent: INTENT.ADD_MARKER, payload: { useCurrentLocation: true } },
  'drop a pin here': { intent: INTENT.ADD_MARKER, payload: { useCurrentLocation: true } },
  'switch to openlayers': { intent: INTENT.SWITCH_MAP, payload: { engine: 'openlayers' } },
  'use openlayers': { intent: INTENT.SWITCH_MAP, payload: { engine: 'openlayers' } },
  'switch to leaflet': { intent: INTENT.SWITCH_MAP, payload: { engine: 'leaflet' } },
  'use leaflet': { intent: INTENT.SWITCH_MAP, payload: { engine: 'leaflet' } },
  'undo': { intent: INTENT.UNDO },
  'go back': { intent: INTENT.UNDO },
  'undo last': { intent: INTENT.UNDO },
  'redo': { intent: INTENT.REDO },
  'redo last': { intent: INTENT.REDO },
};

// Global default geocoder instance for the parser to use
export const defaultGeocoder = new Geocoder();

/**
 * Parse a recognized speech string into an action object.
 * Asynchronous to support online geocoding.
 *
 * @param {string} text - Raw recognized text (case-insensitive).
 * @param {object} [options]
 * @param {boolean} [options.enableGeocoding=true] - Whether to use Nominatim online API
 * @param {Geocoder} [options.geocoder] - Geocoder instance to use
 * @returns {Promise<{ intent: string, payload: object, raw: string, confidence: number }>}
 */
export async function parseCommand(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return { intent: INTENT.UNKNOWN, payload: {}, raw: text || '', confidence: 0 };
  }

  const raw = text;
  const t = text.toLowerCase().trim();
  const enableGeocoding = options.enableGeocoding !== false;
  const geocoder = options.geocoder || defaultGeocoder;

  // 1. Check strict regexes for simple commands
  if (/\bzoom\s*in\b/.test(t) || /\bmore\s+zoom\b/.test(t) || t === 'up' || /\bmagnify\b/.test(t) || /\benlarge\b/.test(t)) {
    return { intent: INTENT.ZOOM_IN, payload: {}, raw, confidence: 0.95 };
  }

  if (/\bzoom\s*out\b/.test(t) || /\bless\s+zoom\b/.test(t) || t === 'down' || /\bshrink\b/.test(t) || /\bminify\b/.test(t)) {
    return { intent: INTENT.ZOOM_OUT, payload: {}, raw, confidence: 0.95 };
  }

  if (/\b(reset|home|default)\s*(view|map|zoom)?\b/.test(t)) {
    return { intent: INTENT.RESET_VIEW, payload: {}, raw, confidence: 0.9 };
  }

  if (/\b(add|place|drop|set|put)\s+(a\s+)?(marker|pin|point)\b/.test(t)) {
    const atMyLocation = /\b(my\s+location|here|current)\b/.test(t);
    return { intent: INTENT.ADD_MARKER, payload: { useCurrentLocation: atMyLocation }, raw, confidence: 0.9 };
  }

  if (/\bswitch\s+to\s+open\s*layers\b/.test(t) || /\buse\s+open\s*layers\b/.test(t) || /\bopen\s*layers\s+map\b/.test(t)) {
    return { intent: INTENT.SWITCH_MAP, payload: { engine: 'openlayers' }, raw, confidence: 0.95 };
  }

  if (/\bswitch\s+to\s+leaflet\b/.test(t) || /\buse\s+leaflet\b/.test(t) || /\bleaflet\s+map\b/.test(t)) {
    return { intent: INTENT.SWITCH_MAP, payload: { engine: 'leaflet' }, raw, confidence: 0.95 };
  }

  if (/\b(undo|go\s+back|revert)\b/.test(t)) {
    return { intent: INTENT.UNDO, payload: {}, raw, confidence: 0.95 };
  }

  if (/\bredo\b/.test(t)) {
    return { intent: INTENT.REDO, payload: {}, raw, confidence: 0.95 };
  }

  // 2. Fuzzy match simple phrases
  const simpleMatch = fuzzyMatch(t, Object.keys(SIMPLE_INTENT_PHRASES), { maxDistance: 2, threshold: 0.75 });
  if (simpleMatch) {
    const mapped = SIMPLE_INTENT_PHRASES[simpleMatch.match];
    return { intent: mapped.intent, payload: mapped.payload || {}, raw, confidence: simpleMatch.score * 0.9 };
  }

  // 3. Extract parameterized intents (Show/Hide layer, Go To place)

  // --- Show / add layer ---
  const showLayerMatch = t.match(/\b(show|add|enable|load|turn\s+on|display|open)\s+(me\s+)?(?:the\s+)?(.+?)(?:\s+layer|\s+view|\s+map)?\s*$/);
  if (showLayerMatch) {
    const alias = showLayerMatch[3].trim();
    const resolved = fuzzyResolveLayer(alias, LAYER_ALIASES);
    if (resolved) {
      return { intent: INTENT.SHOW_LAYER, payload: { layerId: resolved.layerId, alias: resolved.alias }, raw, confidence: resolved.score * 0.9 };
    }
  }

  // --- Hide / remove layer ---
  const hideLayerMatch = t.match(/\b(hide|remove|disable|turn\s+off|close)\s+(?:the\s+)?(.+?)(?:\s+layer|\s+view|\s+map)?\s*$/);
  if (hideLayerMatch) {
    const alias = hideLayerMatch[2].trim();
    const resolved = fuzzyResolveLayer(alias, LAYER_ALIASES);
    if (resolved) {
      return { intent: INTENT.HIDE_LAYER, payload: { layerId: resolved.layerId, alias: resolved.alias }, raw, confidence: resolved.score * 0.9 };
    }
  }

  // --- Go to / zoom to / fly to / navigate to location ---
  const goToPatterns = [
    /\b(?:go|zoom|fly|navigate|move|take me|center|pan)\s+to\s+(.+)$/,
    /\bshow\s+(?:me\s+)?(.+?)\s+(?:on\s+(?:the\s+)?map|please)?\s*$/,
    /\bwhere\s+is\s+(.+?)\s*\??$/,
    /\bfind\s+(.+?)\s*$/,
    /\bopen\s+(.+?)\s+(?:on\s+(?:the\s+)?map)?\s*$/,
  ];

  for (const pattern of goToPatterns) {
    const m = t.match(pattern);
    if (m) {
      const placeName = m[1].trim().replace(/[.,!?]+$/, '');
      const goResult = await resolveGoTo(placeName, enableGeocoding, geocoder);
      if (goResult) {
        return { intent: INTENT.GO_TO, payload: goResult, raw, confidence: 0.9 };
      }
    }
  }

  // --- Fallback: scan free text for any known city name ---
  const cityMatch = findCityInText(t);
  if (cityMatch) {
    return {
      intent: INTENT.GO_TO,
      payload: { place: cityMatch.name, coords: cityMatch.coords, fuzzy: false, source: 'offline-scan' },
      raw,
      confidence: 0.7,
    };
  }

  return { intent: INTENT.UNKNOWN, payload: {}, raw, confidence: 0 };
}

/**
 * Resolve a go-to target to coordinates, trying local cache first then online geocoder.
 * @param {string} placeName
 * @param {boolean} enableGeocoding
 * @param {Geocoder} geocoder
 * @returns {Promise<{place: string, coords: [number, number], fuzzy: boolean, source: string}|null>}
 */
async function resolveGoTo(placeName, enableGeocoding, geocoder) {
  // Try local hardcoded coordinates (with fuzzy matching)
  const localMatch = fuzzyResolveCity(placeName, CITY_COORDS);
  if (localMatch) {
    return {
      place: localMatch.name,
      coords: localMatch.coords,
      fuzzy: localMatch.fuzzy,
      source: 'offline',
    };
  }

  // If online geocoding is enabled, try Nominatim
  if (enableGeocoding && geocoder) {
    const geoResult = await geocoder.geocode(placeName);
    if (geoResult) {
      return {
        place: geoResult.displayName,
        coords: [geoResult.lat, geoResult.lon],
        fuzzy: false,
        source: 'online',
      };
    }
  }

  return null;
}

/**
 * Resolve a layer alias to a canonical layer id (backward compatibility).
 * @param {string} alias
 * @returns {string|null}
 */
export function resolveLayer(alias) {
  if (!alias) return null;
  const key = alias.toLowerCase().trim();
  return LAYER_ALIASES[key] || null;
}

/**
 * Resolve a city/place name to [lat, lng] coordinates (backward compatibility).
 * @param {string} name
 * @returns {[number, number]|null}
 */
export function resolveCity(name) {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  return CITY_COORDS[key] || null;
}

/**
 * Scan free text for any known city name (longest match first).
 * @param {string} text
 * @returns {{ name: string, coords: [number, number] }|null}
 */
function findCityInText(text) {
  // Sort by length descending so multi-word names match before substrings
  const names = Object.keys(CITY_COORDS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (text.includes(name)) {
      return { name, coords: CITY_COORDS[name] };
    }
  }
  return null;
}
