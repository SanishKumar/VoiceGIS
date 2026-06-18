/**
 * MapController.js
 * Unified map controller supporting Leaflet and OpenLayers.
 *
 * Delegates all engine-specific work to LeafletAdapter or OpenLayersAdapter.
 *
 * Usage:
 *   const ctrl = new MapController({ engine: 'leaflet', containerId: 'map' });
 *   ctrl.init();
 *   ctrl.goTo([48.8566, 2.3522], 12, 'Paris');
 *   ctrl.zoomIn();
 *   ctrl.showLayer('nasa');
 *
 * @module map/MapController
 */

import { LeafletAdapter } from './LeafletAdapter.js';
import { OpenLayersAdapter } from './OpenLayersAdapter.js';
import { LAYER_DEFS } from './layers.js';

export const MAP_ENGINE = {
  LEAFLET: 'leaflet',
  OPENLAYERS: 'openlayers',
};

// Re-export layer defs and constants for backward compatibility
export { LAYER_DEFS, DEFAULT_CENTER } from './layers.js';

export class MapController {
  /**
   * @param {object}   options
   * @param {string}   [options.engine]        - MAP_ENGINE.LEAFLET or MAP_ENGINE.OPENLAYERS
   * @param {string}   [options.containerId]   - DOM id for the map div
   * @param {function} [options.onAction]      - Callback fired after each map action
   * @param {function} [options.onLayerError]  - Callback fired when a WMS/tile layer fails to load.
   *                                             Receives { layerId, label, error }.
   */
  constructor(options = {}) {
    this.engine = options.engine || MAP_ENGINE.LEAFLET;
    this.containerId = options.containerId || 'map';
    this.onAction = options.onAction || (() => {});
    this.onLayerError = options.onLayerError || null;

    /** @type {LeafletAdapter|OpenLayersAdapter|null} */
    this._adapter = null;

    // Backward compatibility: expose _map through the adapter
    this._map = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Initialise and render the map. */
  init() {
    const adapterOptions = {
      containerId: this.containerId,
      onLayerError: this.onLayerError,
    };

    if (this.engine === MAP_ENGINE.OPENLAYERS) {
      this._adapter = new OpenLayersAdapter(adapterOptions);
    } else {
      this._adapter = new LeafletAdapter(adapterOptions);
    }

    this._adapter.init();
    this._map = this._adapter.map;
    this.showLayer('osm');
  }

  /** Destroy the current map instance (used when switching engines). */
  destroy() {
    if (this._adapter) {
      this._adapter.destroy();
      this._adapter = null;
      this._map = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Zoom in by one level. */
  zoomIn() {
    this._mutate('zoomIn', () => this._adapter.zoomIn());
  }

  /** Zoom out by one level. */
  zoomOut() {
    this._mutate('zoomOut', () => this._adapter.zoomOut());
  }

  /**
   * Fly / pan to a location.
   * @param {[number, number]} latLng - [latitude, longitude]
   * @param {number} [zoom]
   * @param {string} [label]
   */
  goTo(latLng, zoom = 12, label = '') {
    this._mutate('goTo', () => this._adapter.goTo(latLng, zoom), { latLng, zoom, label });
  }

  /** Reset map to default world view. */
  resetView() {
    this._mutate('resetView', () => this._adapter.resetView());
  }

  /**
   * Show (or add) a layer by its id.
   * @param {string} layerId - One of the keys in LAYER_DEFS
   */
  showLayer(layerId) {
    const def = LAYER_DEFS[layerId];
    if (!def) {
      console.warn('[MapController] Unknown layer:', layerId);
      return;
    }
    this._mutate('showLayer', () => this._adapter.showLayer(layerId), {
      layerId,
      label: def.label,
    });
  }

  /**
   * Hide / remove a layer by its id.
   * @param {string} layerId
   */
  hideLayer(layerId) {
    const def = LAYER_DEFS[layerId];
    this._mutate('hideLayer', () => this._adapter.hideLayer(layerId), {
      layerId,
      label: def ? def.label : layerId,
    });
  }

  /**
   * Add a marker at a given position.
   * @param {[number, number]} coords - [lat, lng]
   * @param {string} [popupText]
   */
  addMarker(coords, popupText = '') {
    this._mutate('addMarker', () => this._adapter.addMarker(coords, popupText), { coords });
  }

  /**
   * Add a marker at the user's current geolocation.
   * @returns {Promise<[number, number]>} Resolves with [lat, lng]
   */
  addMarkerAtCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          /** @type {[number, number]} */
          const latLng = [pos.coords.latitude, pos.coords.longitude];
          this.goTo(latLng, 14, 'My Location');
          this.addMarker(latLng, '📍 You are here');
          resolve(latLng);
        },
        (err) => reject(new Error(`Geolocation error: ${err.message}`))
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Adapter pass-through helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the current map center.
   * @returns {{ lat: number, lng: number }}
   */
  getCenter() {
    if (!this._adapter) return { lat: 0, lng: 0 };
    return this._adapter.getCenter();
  }

  /**
   * Get the current zoom level.
   * @returns {number|undefined}
   */
  getZoom() {
    if (!this._adapter) return undefined;
    return this._adapter.getZoom();
  }

  /**
   * Register a callback for map move/zoom events.
   * @param {function} callback
   */
  onMove(callback) {
    if (this._adapter) this._adapter.onMove(callback);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Execute a map mutation and emit an onAction event. */
  _mutate(action, fn, extra = {}) {
    if (!this._adapter) {
      console.warn(`[MapController] Cannot execute "${action}": map not initialised.`);
      return;
    }
    const t0 = performance.now();
    fn();
    const latency = performance.now() - t0;
    this.onAction({ action, latency, ...extra });
  }
}
