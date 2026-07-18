/**
 * LeafletAdapter.js
 * Leaflet-specific map implementation.
 *
 * Handles all direct interactions with the Leaflet library (L.*).
 * Used by MapController as a strategy when engine === 'leaflet'.
 *
 * @module map/LeafletAdapter
 */

import { LAYER_DEFS, DEFAULT_CENTER, DEFAULT_ZOOM } from './layers.js';

/** Map CRS identifiers to Leaflet CRS objects. */
const LEAFLET_CRS_MAP = {
  'EPSG:3857': 'EPSG3857',
  'EPSG:4326': 'EPSG4326',
  'EPSG:900913': 'EPSG900913',
};

export class LeafletAdapter {
  /**
   * @param {object} options
   * @param {string}   [options.containerId='map']  - DOM id for the map div
   * @param {function} [options.onLayerError] - Callback for WMS/tile load failures
   */
  constructor(options = {}) {
    this.containerId = options.containerId || 'map';
    this.onLayerError = options.onLayerError || null;

    this._map = null;
    this._layers = {};       // id → Leaflet layer object
    this._markers = [];
    this._failedLayers = new Set();
  }

  /** The underlying Leaflet map instance. */
  get map() { return this._map; }

  /** Initialise and render the Leaflet map. */
  init() {
    const L = window.L;
    this._map = L.map(this.containerId, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      minZoom: 2,
      maxBounds: [
        [-90, -180],
        [90, 180]
      ],
      maxBoundsViscosity: 1.0,
    });
  }

  /** Destroy the map instance. */
  destroy() {
    if (this._map) {
      this._map.remove();
      this._map = null;
      this._layers = {};
      this._markers = [];
      this._failedLayers.clear();
    }
  }

  /** Zoom in by one level. */
  zoomIn() {
    this._map.zoomIn();
  }

  /** Zoom out by one level. */
  zoomOut() {
    this._map.zoomOut();
  }

  /** Pan by a quarter viewport in the requested direction. */
  pan(direction) {
    const size = this._map.getSize();
    const offsets = {
      left: [-size.x * 0.25, 0],
      right: [size.x * 0.25, 0],
      up: [0, -size.y * 0.25],
      down: [0, size.y * 0.25],
    };
    this._map.panBy(offsets[direction] || [0, 0], { animate: true });
  }

  /**
   * Fly to a location.
   * @param {[number, number]} latLng - [latitude, longitude]
   * @param {number} [zoom=12]
   */
  goTo(latLng, zoom = 12) {
    this._map.flyTo(latLng, zoom, { animate: true, duration: 1.5 });
  }

  /** Reset map to default world view. */
  resetView() {
    this._map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }

  /**
   * Show (or add) a layer by its definition.
   * @param {string} layerId
   */
  showLayer(layerId) {
    const def = LAYER_DEFS[layerId];
    if (!def) return;

    if (this._layers[layerId]) {
      if (!this._map.hasLayer(this._layers[layerId])) {
        this._map.addLayer(this._layers[layerId]);
      }
      return;
    }

    const layer = this._createLayer(def);
    layer.addTo(this._map);
    this._layers[layerId] = layer;
  }

  /**
   * Hide / remove a layer by its id.
   * @param {string} layerId
   */
  hideLayer(layerId) {
    if (!this._layers[layerId]) return;
    if (this._map.hasLayer(this._layers[layerId])) {
      this._map.removeLayer(this._layers[layerId]);
    }
    this._failedLayers.delete(layerId);
  }

  /**
   * Add a marker at a given position.
   * @param {[number, number]} latLng
   * @param {string} [popupText]
   */
  addMarker(latLng, popupText = '') {
    const marker = window.L.marker(latLng).addTo(this._map);
    if (popupText) marker.bindPopup(popupText).openPopup();
    this._markers.push(marker);
  }

  /**
   * Get the current map center.
   * @returns {{ lat: number, lng: number }}
   */
  getCenter() {
    return this._map.getCenter();
  }

  /**
   * Get the current zoom level.
   * @returns {number}
   */
  getZoom() {
    return this._map.getZoom();
  }

  /**
   * Register a callback for map move events.
   * @param {function} callback
   */
  onMove(callback) {
    this._map.on('moveend', callback);
    this._map.on('zoomend', callback);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _createLayer(def) {
    const L = window.L;
    if (def.type === 'wms') {
      const layer = L.tileLayer.wms(def.url, {
        layers: def.layers,
        format: def.format || 'image/png',
        transparent: def.transparent !== false,
        attribution: def.attribution,
        version: def.version || '1.1.1',
        crs: def.crs ? window.L.CRS[LEAFLET_CRS_MAP[def.crs] || def.crs] : undefined,
      });

      // Tile-error handler for WMS failures (network, DNS, CORS).
      // Only report once per layer per session to avoid spam.
      layer.on('tileerror', (e) => {
        if (!this._failedLayers.has(def.id)) {
          this._failedLayers.add(def.id);
          console.warn(
            `[LeafletAdapter] WMS layer "${def.id}" failed to load tiles from ${def.url}.`,
            'Possible causes: endpoint unreachable, DNS failure, CORS, or incorrect layer name.',
            e.error || e,
          );
          if (this.onLayerError) {
            this.onLayerError({
              layerId: def.id,
              label: def.label,
              error: e.error || new Error('WMS tile load failed'),
            });
          }
        }
      });

      return layer;
    }

    return L.tileLayer(def.url, {
      attribution: def.attribution,
      maxZoom: def.maxZoom || 18,
    });
  }
}
