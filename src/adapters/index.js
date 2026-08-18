/**
 * Real execution adapters for VoiceGIS Core.
 *
 * @module adapters
 */

export {
  AdapterEvaluationError,
  UNITS,
  bboxIntersects,
  bboxOf,
  centroidOf,
  convertUnit,
  decomposeGeometry,
  destinationPoint,
  distanceToMeters,
  distanceToSegmentMeters,
  evaluatePredicate,
  geodesicCircle,
  geometryDistanceMeters,
  haversineMeters,
  padBbox,
  positionsOf,
} from './predicate.js';

export { EXPORT_MIME_TYPES, serializeFeatures } from './serialize.js';

export {
  andCql2,
  encodeIdentifier,
  encodeLiteral,
  geometryToWkt,
  intersectsCql2,
  predicateToCql2,
} from './cql2.js';

export {
  GEOJSON_ADAPTER_CAPABILITIES,
  GeoJSONAdapter,
  createGeoJSONAdapter,
} from './geojson.js';

export { CONFORMANCE, catalogFromOgcService } from './ogcCatalog.js';

export {
  OGC_ADAPTER_CAPABILITIES,
  OgcApiFeaturesAdapter,
  createOgcApiFeaturesAdapter,
} from './ogcApiFeatures.js';

export { composeAdapters } from './compose.js';
