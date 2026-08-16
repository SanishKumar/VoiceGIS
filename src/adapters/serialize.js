/**
 * Feature serialization for adapter exports.
 *
 * @module adapters/serialize
 */

import { AdapterEvaluationError, decomposeGeometry } from './predicate.js';

export const EXPORT_MIME_TYPES = Object.freeze({
  geojson: 'application/geo+json',
  json: 'application/json',
  csv: 'text/csv',
  kml: 'application/vnd.google-earth.kml+xml',
});

/**
 * Collect the union of property keys across features, preserving first-seen
 * order so exports stay stable and readable.
 * @param {object[]} features
 */
function columnsOf(features) {
  const columns = [];
  const seen = new Set();
  for (const feature of features) {
    for (const key of Object.keys(feature.properties || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

/**
 * @param {*} value
 * @returns {string}
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Prefix formula-leading characters so spreadsheet apps treat them as text.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toCsv(features) {
  const columns = columnsOf(features);
  const header = ['longitude', 'latitude', ...columns];
  const rows = [header.map(csvCell).join(',')];

  for (const feature of features) {
    const { points } = decomposeGeometry(feature.geometry);
    const [lon, lat] = points[0] || [];
    rows.push([
      csvCell(lon),
      csvCell(lat),
      ...columns.map((column) => csvCell(feature.properties?.[column])),
    ].join(','));
  }
  return `${rows.join('\n')}\n`;
}

function coordinateList(positions) {
  return positions.map(([lon, lat, alt]) => `${lon},${lat},${alt ?? 0}`).join(' ');
}

function kmlGeometry(geometry) {
  const { points, lines, polygons } = decomposeGeometry(geometry);
  const parts = [
    ...points.map((point) => `<Point><coordinates>${coordinateList([point])}</coordinates></Point>`),
    ...lines.map((line) => `<LineString><coordinates>${coordinateList(line)}</coordinates></LineString>`),
    ...polygons.map((polygon) => {
      const [outer, ...holes] = polygon;
      const inner = holes
        .map((hole) => `<innerBoundaryIs><LinearRing><coordinates>${coordinateList(hole)}</coordinates></LinearRing></innerBoundaryIs>`)
        .join('');
      return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinateList(outer)}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon>`;
    }),
  ];

  if (parts.length === 0) return '';
  return parts.length === 1 ? parts[0] : `<MultiGeometry>${parts.join('')}</MultiGeometry>`;
}

function toKml(features, { name = 'VoiceGIS export' } = {}) {
  const placemarks = features.map((feature) => {
    const properties = feature.properties || {};
    const label = properties.name || properties.title || properties.place || feature.id || '';
    const data = Object.entries(properties)
      .map(([key, value]) => `<Data name="${xmlEscape(key)}"><value>${xmlEscape(
        typeof value === 'object' && value !== null ? JSON.stringify(value) : value
      )}</value></Data>`)
      .join('');
    return [
      '<Placemark>',
      `<name>${xmlEscape(label)}</name>`,
      data ? `<ExtendedData>${data}</ExtendedData>` : '',
      kmlGeometry(feature.geometry),
      '</Placemark>',
    ].join('');
  }).join('');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    `<Document><name>${xmlEscape(name)}</name>${placemarks}</Document>`,
    '</kml>',
    '',
  ].join('\n');
}

/**
 * Serialize features to a requested export format.
 *
 * @param {object[]} features
 * @param {string} format
 * @param {{ name?: string }} [options]
 * @returns {{ format:string, mimeType:string, extension:string, content:string }}
 */
export function serializeFeatures(features, format, options = {}) {
  const normalized = String(format || '').toLowerCase();

  switch (normalized) {
    case 'geojson':
    case 'json':
      return {
        format: normalized,
        mimeType: EXPORT_MIME_TYPES[normalized],
        extension: normalized,
        content: JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
      };
    case 'csv':
      return {
        format: normalized,
        mimeType: EXPORT_MIME_TYPES.csv,
        extension: 'csv',
        content: toCsv(features),
      };
    case 'kml':
      return {
        format: normalized,
        mimeType: EXPORT_MIME_TYPES.kml,
        extension: 'kml',
        content: toKml(features, options),
      };
    default:
      throw new AdapterEvaluationError(`Export format "${format}" is not supported.`, {
        format,
        supported: Object.keys(EXPORT_MIME_TYPES),
      });
  }
}
