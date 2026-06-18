/**
 * Command parsing pipeline.
 *
 * Re-exports the parser, intent constants, and helper utilities:
 *   import { parseCommand, INTENT, resolveCity, resolveLayer } from 'voicegis/parser';
 *
 * @module parser
 */

export {
  parseCommand,
  resolveCity,
  resolveLayer,
  defaultGeocoder,
  INTENT,
  CITY_COORDS,
  LAYER_ALIASES,
} from './CommandParser.js';

export { parseCommandChain, splitCommandString } from './CommandChain.js';

export {
  fuzzyMatch,
  levenshtein,
  fuzzyResolveLayer,
  fuzzyResolveCity,
} from './fuzzyMatch.js';

export { Geocoder } from './geocoder.js';
