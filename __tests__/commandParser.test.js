/**
 * commandParser.test.js — unit tests for src/parser/CommandParser.js
 */

import { jest } from '@jest/globals';
import {
  parseCommand,
  resolveCity,
  resolveLayer,
  INTENT,
  CITY_COORDS,
} from '../src/parser/CommandParser.js';

// ---------------------------------------------------------------------------
// resolveCity (sync, backward compatibility)
// ---------------------------------------------------------------------------

describe('resolveCity', () => {
  test('returns coords for a known city (lowercase)', () => {
    expect(resolveCity('paris')).toEqual([48.8566, 2.3522]);
  });

  test('lowercases input before lookup', () => {
    expect(resolveCity('Paris')).toEqual([48.8566, 2.3522]);
  });

  test('returns null for unknown city', () => {
    expect(resolveCity('atlantis')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveLayer (sync, backward compatibility)
// ---------------------------------------------------------------------------

describe('resolveLayer', () => {
  test('resolves canonical alias', () => {
    expect(resolveLayer('osm')).toBe('osm');
    expect(resolveLayer('nasa')).toBe('nasa');
  });

  test('resolves friendly aliases', () => {
    expect(resolveLayer('satellite')).toBe('nasa');
  });

  test('returns null for unknown alias', () => {
    expect(resolveLayer('unknown-layer')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseCommand — zoom
// ---------------------------------------------------------------------------

describe('parseCommand — zoom', () => {
  test('zoom in', async () => {
    const r = await parseCommand('zoom in');
    expect(r.intent).toBe(INTENT.ZOOM_IN);
    expect(r.confidence).toBeGreaterThan(0);
  });

  test('zoom out', async () => {
    const r = await parseCommand('zoom out');
    expect(r.intent).toBe(INTENT.ZOOM_OUT);
  });

  test('magnify → zoom in', async () => {
    const r = await parseCommand('magnify the map');
    expect(r.intent).toBe(INTENT.ZOOM_IN);
  });

  test('shrink → zoom out', async () => {
    const r = await parseCommand('shrink the map');
    expect(r.intent).toBe(INTENT.ZOOM_OUT);
  });
  
  test('fuzzy zoom in', async () => {
    const r = await parseCommand('zoon in');
    expect(r.intent).toBe(INTENT.ZOOM_IN);
  });
});

describe('parseCommand — pan', () => {
  test('pan left', async () => {
    const r = await parseCommand('pan left');
    expect(r.intent).toBe(INTENT.PAN_LEFT);
  });

  test('move east maps to pan right', async () => {
    const r = await parseCommand('move east');
    expect(r.intent).toBe(INTENT.PAN_RIGHT);
  });

  test('move north maps to pan up', async () => {
    const r = await parseCommand('move north');
    expect(r.intent).toBe(INTENT.PAN_UP);
  });
});

// ---------------------------------------------------------------------------
// parseCommand — go to
// ---------------------------------------------------------------------------

describe('parseCommand — go to', () => {
  test('go to <city>', async () => {
    const r = await parseCommand('go to paris', { enableGeocoding: false });
    expect(r.intent).toBe(INTENT.GO_TO);
    expect(r.payload.place).toBe('paris');
    expect(r.payload.coords).toEqual(CITY_COORDS.paris);
  });

  test('zoom to <city>', async () => {
    const r = await parseCommand('zoom to ahmedabad', { enableGeocoding: false });
    expect(r.intent).toBe(INTENT.GO_TO);
    expect(r.payload.coords).toEqual(CITY_COORDS.ahmedabad);
  });

  test('fuzzy go to <city>', async () => {
    const r = await parseCommand('go to ahmdabad', { enableGeocoding: false });
    expect(r.intent).toBe(INTENT.GO_TO);
    expect(r.payload.coords).toEqual(CITY_COORDS.ahmedabad);
  });

  test('unknown city fallback without geocoding', async () => {
    const r = await parseCommand('go to atlantis', { enableGeocoding: false });
    expect(r.intent).toBe(INTENT.UNKNOWN);
  });

  test('online geocoding for unknown city', async () => {
    const mockGeocoder = {
      geocode: jest.fn().mockResolvedValue({ lat: 10, lon: 20, displayName: 'Atlantis' })
    };
    const r = await parseCommand('go to atlantis', { enableGeocoding: true, geocoder: mockGeocoder });
    expect(r.intent).toBe(INTENT.GO_TO);
    expect(r.payload.coords).toEqual([10, 20]);
    expect(r.payload.place).toBe('Atlantis');
    expect(mockGeocoder.geocode).toHaveBeenCalledWith('atlantis');
  });
});

// ---------------------------------------------------------------------------
// parseCommand — layers
// ---------------------------------------------------------------------------

describe('parseCommand — show/hide layer', () => {
  test('show satellite', async () => {
    const r = await parseCommand('show satellite');
    expect(r.intent).toBe(INTENT.SHOW_LAYER);
    expect(r.payload.layerId).toBe('nasa');
  });

  test('fuzzy show layer', async () => {
    const r = await parseCommand('show sattelite'); // typo
    expect(r.intent).toBe(INTENT.SHOW_LAYER);
    expect(r.payload.layerId).toBe('nasa');
  });

  test('hide satellite', async () => {
    const r = await parseCommand('hide satellite');
    expect(r.intent).toBe(INTENT.HIDE_LAYER);
    expect(r.payload.layerId).toBe('nasa');
  });
});

// ---------------------------------------------------------------------------
// parseCommand — markers
// ---------------------------------------------------------------------------

describe('parseCommand — add marker', () => {
  test('add marker', async () => {
    const r = await parseCommand('add marker');
    expect(r.intent).toBe(INTENT.ADD_MARKER);
    expect(r.payload.useCurrentLocation).toBe(false);
  });

  test('add marker at my location', async () => {
    const r = await parseCommand('add marker at my location');
    expect(r.intent).toBe(INTENT.ADD_MARKER);
    expect(r.payload.useCurrentLocation).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseCommand — switch map engine
// ---------------------------------------------------------------------------

describe('parseCommand — switch map', () => {
  test('switch to openlayers', async () => {
    const r = await parseCommand('switch to openlayers');
    expect(r.intent).toBe(INTENT.SWITCH_MAP);
    expect(r.payload.engine).toBe('openlayers');
  });

  test('switch to leaflet', async () => {
    const r = await parseCommand('switch to leaflet');
    expect(r.intent).toBe(INTENT.SWITCH_MAP);
    expect(r.payload.engine).toBe('leaflet');
  });
});

// ---------------------------------------------------------------------------
// parseCommand — reset
// ---------------------------------------------------------------------------

describe('parseCommand — reset view', () => {
  test('reset view', async () => {
    const r = await parseCommand('reset view');
    expect(r.intent).toBe(INTENT.RESET_VIEW);
  });

  test('home', async () => {
    const r = await parseCommand('home');
    expect(r.intent).toBe(INTENT.RESET_VIEW);
  });
});

// ---------------------------------------------------------------------------
// parseCommand — edge cases
// ---------------------------------------------------------------------------

describe('parseCommand — edge cases', () => {
  test('empty string → unknown', async () => {
    const r = await parseCommand('');
    expect(r.intent).toBe(INTENT.UNKNOWN);
  });

  test('null → unknown', async () => {
    const r = await parseCommand(null);
    expect(r.intent).toBe(INTENT.UNKNOWN);
  });

  test('raw text is preserved in result', async () => {
    const r = await parseCommand('Zoom In Please');
    expect(r.raw).toBe('Zoom In Please');
  });
});
