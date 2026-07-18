/**
 * layers.js
 * Public WMS / tile layer definitions and related constants.
 *
 * @module map/layers
 */

/** Public WMS / tile layer definitions. */
export const LAYER_DEFS = {
  osm: {
    id: 'osm',
    label: 'OpenStreetMap',
    type: 'tile',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  dark: {
    id: 'dark',
    label: 'Dark Operations',
    type: 'tile',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
  },
  nasa: {
    id: 'nasa',
    label: 'NASA GIBS Satellite',
    type: 'wms',
    url: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
    // BlueMarble_NextGeneration is a static (time-independent) composite product.
    // Daily/near-real-time products like MODIS_Terra_CorrectedReflectance_TrueColor
    // require a TIME= WMS parameter; without it the server returns blank tiles.
    layers: 'BlueMarble_NextGeneration',
    format: 'image/jpeg',
    transparent: false,
    // WMS 1.1.1 with SRS is required by NASA GIBS; 1.3.0 uses CRS and may return blank tiles.
    version: '1.1.1',
    attribution: 'Imagery provided by services from the Global Imagery Browse Services (GIBS), operated by the NASA/GSFC/Earth Science Data and Information System (ESDIS) with funding provided by NASA/HQ.',
    crs: 'EPSG:3857',
  },
  bhuvan: {
    id: 'bhuvan',
    label: 'Bhuvan (NRSC India)',
    type: 'wms',
    // ⚠ Bhuvan WMS has CORS restrictions for cross-origin browser requests.
    // Tiles will fail in most browsers when loaded from a different origin.
    // This layer is retained in LAYER_DEFS for server-side / proxied use but is
    // intentionally omitted from the quick-start demo sidebar.
    url: 'https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms',
    layers: 'india_vmap0',
    format: 'image/png',
    transparent: true,
    version: '1.1.1',
    attribution: '© NRSC/ISRO Bhuvan',
  },
  copernicus: {
    id: 'copernicus',
    label: 'Copernicus Land Cover',
    type: 'wms',
    // The original vito.be endpoint is no longer publicly reachable.
    // Replaced with the EEA-hosted CORINE Land Cover 2018 WMS.
    // ⚠ This ArcGIS-hosted endpoint may send CORS headers that block browser requests.
    url: 'https://image.discomap.eea.europa.eu/arcgis/services/Corine/CLC2018_WM/MapServer/WmsServer',
    layers: '12',
    format: 'image/png',
    transparent: true,
    version: '1.1.1',
    attribution: '© EEA / Copernicus Land Monitoring Service',
  },
  terrain: {
    id: 'terrain',
    label: 'OpenTopoMap (Terrain)',
    type: 'tile',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      'Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: © <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
  },
};

/** Default map center: Ahmedabad, India [lat, lng]. */
export const DEFAULT_CENTER = [23.0225, 72.5714];

/** Default zoom level for world overview. */
export const DEFAULT_ZOOM = 3;
