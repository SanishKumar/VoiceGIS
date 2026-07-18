/**
 * VoiceGIS — main library entry point.
 *
 * Re-exports all public modules so consumers can do:
 *   import { SpeechEngine, MapController, parseCommand, EvaluationTracker } from 'voicegis';
 *
 * @module voicegis
 */

// High-level Orchestrator
export { VoiceGIS } from './VoiceGIS.js';

// Headless, policy-aware GIS command compiler and executor
export {
  OPERATION,
  OPERATION_METADATA,
  PLAN_STATUS,
  RISK,
  PERMISSION,
  SpatialCatalog,
  CommandPolicy,
  SpatialCommandCompiler,
  splitSpatialCommand,
  CommandExecutor,
  createFunctionAdapter,
  VoiceGISCore,
  createVoiceGISCore,
} from './core/index.js';
export * from './core/types.js';

// Voice recognition engines
export {
  SpeechEngine,
  WebSpeechEngine,
  TfjsEngine,
  WhisperEngine,
  WHISPER_STATE,
  createEngine,
  ENGINE_TYPE,
} from './engines/index.js';

// Audio capture & visualization
export { AudioCapture, WaveformRenderer } from './audio/index.js';

// Command parsing
export { parseCommand, parseCommandChain, splitCommandString, resolveCity, resolveLayer, INTENT, CITY_COORDS, LAYER_ALIASES } from './parser/index.js';

// Map controller
export { MapController, MAP_ENGINE, LAYER_DEFS, DEFAULT_CENTER } from './map/index.js';
export { LeafletAdapter } from './map/LeafletAdapter.js';
export { OpenLayersAdapter } from './map/OpenLayersAdapter.js';

// Evaluation & metrics
export { EvaluationTracker } from './evaluation/index.js';

// History & undo
export { CommandHistory } from './history/index.js';
export * from './plugins/VoiceFeedback.js';
