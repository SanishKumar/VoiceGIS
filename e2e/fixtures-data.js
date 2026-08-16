/**
 * Deterministic stand-ins for the demo's network dependencies.
 *
 * The demo reads a live USGS feed, which is exactly right for a demo and
 * exactly wrong for a test: counts would drift between runs and the suite
 * would need the network. The route guard in `test.js` answers every external
 * request from here instead, so assertions can name exact numbers.
 */

/** A 1x1 transparent PNG, enough to satisfy the tile layer. */
export const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function quake(id, mag, place, coordinates, extra = {}) {
  return {
    type: 'Feature',
    id,
    properties: {
      mag,
      place,
      time: Date.UTC(2026, 7, 10, 12, 0, 0),
      alert: null,
      tsunami: 0,
      sig: Math.round(mag * 100),
      felt: null,
      magType: 'mww',
      type: 'earthquake',
      ...extra,
    },
    geometry: { type: 'Point', coordinates },
  };
}

/**
 * Six events with hand-picked values so every count in the suite is exact:
 *
 *   magnitude > 5        → 3   (q-japan-big, q-la, q-chile)
 *   magnitude >= 6       → 2   (q-japan-big, q-chile)
 *   place contains japan → 2   (q-japan-big, q-japan-small)
 *   alert is green       → 1   (q-la)
 */
export const QUAKE_FIXTURE = {
  type: 'FeatureCollection',
  metadata: { generated: Date.UTC(2026, 7, 15, 18, 0, 0), title: 'test fixture' },
  features: [
    quake('q-japan-big', 6.4, '30 km E of Sendai, Japan', [141.2, 38.26, 35.5], { alert: 'red' }),
    quake('q-japan-small', 4.1, '80 km SE of Tokyo, Japan', [140.4, 35.1, 42.0]),
    quake('q-la', 5.5, '12 km N of Los Angeles, CA', [-118.24, 34.15, 12.4], { alert: 'green' }),
    quake('q-ba', 2.2, 'near Buenos Aires, Argentina', [-58.38, -34.6, 18.0]),
    quake('q-chile', 7.1, '60 km W of Concepcion, Chile', [-73.6, -36.8, 24.7]),
    quake('q-alaska', 3.0, '90 km NW of Anchorage, Alaska', [-150.9, 61.6, 55.2]),
  ],
};

export const TOTAL_QUAKES = QUAKE_FIXTURE.features.length;
export const ABOVE_M5 = 3;
export const AT_LEAST_M6 = 2;
export const IN_JAPAN = 2;
