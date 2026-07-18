/**
 * OpenLayersAdapter.js
 * OpenLayers-specific map implementation.
 *
 * Handles all direct interactions with the OpenLayers library (ol.*).
 * Used by MapController as a strategy when engine === 'openlayers'.
 *
 * @module map/OpenLayersAdapter
 */

import { LAYER_DEFS, DEFAULT_CENTER, DEFAULT_ZOOM } from './layers.js';

export class OpenLayersAdapter {
  /**
   * @param {object} options
   * @param {string}   [options.containerId='map']  - DOM id for the map div
   * @param {function} [options.onLayerError] - Callback for WMS/tile load failures
   */
  constructor(options = {}) {
    this.containerId = options.containerId || 'map';
    this.onLayerError = options.onLayerError || null;

    this._map = null;
    this._layers = {};       // id → OL layer object
    this._markers = [];
    this._failedLayers = new Set();
  }

  /** The underlying OpenLayers map instance. */
  get map() { return this._map; }

  /** Initialise and render the OpenLayers map. */
  init() {
    const ol = window.ol;
    this._map = new ol.Map({
      target: this.containerId,
      view: new ol.View({
        center: ol.proj.fromLonLat([DEFAULT_CENTER[1], DEFAULT_CENTER[0]]),
        zoom: DEFAULT_ZOOM,
        minZoom: 2,
        extent: ol.proj.get('EPSG:3857').getExtent(),
      }),
      controls: ol.control.defaults.defaults(),
      layers: [],
    });
  }

  /** Destroy the map instance. */
  destroy() {
    if (this._map) {
      this._map.setTarget(null);
      this._map = null;
      this._layers = {};
      this._markers = [];
      this._failedLayers.clear();
    }
  }

  /** Zoom in by one level. */
  zoomIn() {
    const view = this._map.getView();
    view.animate({ zoom: view.getZoom() + 1, duration: 300 });
  }

  /** Zoom out by one level. */
  zoomOut() {
    const view = this._map.getView();
    view.animate({ zoom: view.getZoom() - 1, duration: 300 });
  }

  /** Pan by a quarter viewport in the requested direction. */
  pan(direction) {
    const view = this._map.getView();
    const center = view.getCenter();
    const resolution = view.getResolution() || 1;
    const size = this._map.getSize() || [0, 0];
    const offsets = {
      left: [-size[0] * resolution * 0.25, 0],
      right: [size[0] * resolution * 0.25, 0],
      up: [0, size[1] * resolution * 0.25],
      down: [0, -size[1] * resolution * 0.25],
    };
    const offset = offsets[direction] || [0, 0];
    view.animate({
      center: [center[0] + offset[0], center[1] + offset[1]],
      duration: 320,
    });
  }

  /**
   * Fly to a location.
   * @param {[number, number]} latLng - [latitude, longitude]
   * @param {number} [zoom=12]
   */
  goTo(latLng, zoom = 12) {
    const ol = window.ol;
    const view = this._map.getView();
    const coord = ol.proj.fromLonLat([latLng[1], latLng[0]]);
    view.animate({ center: coord, zoom, duration: 1500 });
  }

  /** Reset map to default world view. */
  resetView() {
    const ol = window.ol;
    const view = this._map.getView();
    view.animate({
      center: ol.proj.fromLonLat([DEFAULT_CENTER[1], DEFAULT_CENTER[0]]),
      zoom: DEFAULT_ZOOM,
      duration: 800,
    });
  }

  /**
   * Show (or add) a layer by its definition.
   * @param {string} layerId
   */
  showLayer(layerId) {
    const def = LAYER_DEFS[layerId];
    if (!def) return;

    if (this._layers[layerId]) {
      this._layers[layerId].setVisible(true);
      return;
    }

    const layer = this._createLayer(def);
    this._map.addLayer(layer);
    this._layers[layerId] = layer;
  }

  /**
   * Hide / remove a layer by its id.
   * @param {string} layerId
   */
  hideLayer(layerId) {
    if (!this._layers[layerId]) return;
    this._layers[layerId].setVisible(false);
    this._failedLayers.delete(layerId);
  }

  /**
   * Add a marker at a given position.
   * @param {[number, number]} latLng
   * @param {string} [popupText] - Not used in OL (kept for interface parity)
   */
  // eslint-disable-next-line no-unused-vars
  addMarker(latLng, popupText = '') {
    const ol = window.ol;
    const feature = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat([latLng[1], latLng[0]])),
    });
    feature.setStyle(
      new ol.style.Style({
        image: new ol.style.Icon({
          src: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png',
          anchor: [0.5, 1],
        }),
      })
    );
    const source = new ol.source.Vector({ features: [feature] });
    const layer = new ol.layer.Vector({ source });
    this._map.addLayer(layer);
    this._markers.push(layer);
  }

  /**
   * Get the current map center.
   * @returns {{ lat: number, lng: number }}
   */
  getCenter() {
    const ol = window.ol;
    const coord = ol.proj.toLonLat(this._map.getView().getCenter());
    return { lat: coord[1], lng: coord[0] };
  }

  /**
   * Get the current zoom level.
   * @returns {number|undefined}
   */
  getZoom() {
    return this._map.getView().getZoom();
  }

  /**
   * Register a callback for map move events.
   * @param {function} callback
   */
  onMove(callback) {
    this._map.getView().on('change', callback);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _createLayer(def) {
    const ol = window.ol;
    const reportTileError = (event) => {
      if (this._failedLayers.has(def.id)) return;
      this._failedLayers.add(def.id);
      console.warn(
        `[OpenLayersAdapter] Layer "${def.id}" failed to load tiles from ${def.url}.`,
        'Possible causes: endpoint unreachable, DNS failure, CORS, or incorrect layer configuration.',
        event,
      );
      this.onLayerError?.({
        layerId: def.id,
        label: def.label,
        error: new Error('Map tile load failed'),
      });
    };

    if (def.type === 'wms') {
      const source = new ol.source.TileWMS({
        url: def.url,
        params: {
          LAYERS: def.layers,
          TILED: true,
          FORMAT: def.format || 'image/png',
          VERSION: def.version || '1.1.1',
        },
        attributions: def.attribution,
        serverType: 'mapserver',
      });

      // Only report once per layer per session to avoid notification spam.
      source.on('tileloaderror', reportTileError);

      return new ol.layer.Tile({
        source,
        properties: { id: def.id },
      });
    }

    // XYZ tile — handle {s} subdomain placeholder
    const tileUrl = def.url.replace('{s}', 'a');
    const source = new ol.source.XYZ({
      url: tileUrl,
      maxZoom: def.maxZoom || 18,
      attributions: def.attribution,
    });
    source.on('tileloaderror', reportTileError);
    return new ol.layer.Tile({
      source,
      properties: { id: def.id },
    });
  }
}
