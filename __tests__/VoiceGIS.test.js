/**
 * VoiceGIS.test.js — integration tests for the orchestrator.
 */

import { jest } from '@jest/globals';
import { VoiceGIS } from '../src/VoiceGIS.js';
import { ENGINE_TYPE } from '../src/engines/index.js';
import { MAP_ENGINE } from '../src/map/index.js';

// ---------------------------------------------------------------------------
// Helpers / Mocks
// ---------------------------------------------------------------------------

function setupGlobals(isOnline = true, hasWebSpeech = true) {
  globalThis.window = globalThis.window || {};
  
  if (hasWebSpeech) {
    globalThis.window.SpeechRecognition = jest.fn();
  } else {
    delete globalThis.window.SpeechRecognition;
    delete globalThis.window.webkitSpeechRecognition;
  }

  globalThis.navigator = globalThis.navigator || {};
  Object.defineProperty(globalThis.navigator, 'onLine', {
    value: isOnline,
    configurable: true,
  });
}

// We will spy on the real SpeechEngine prototype instead of using unstable_mockModule.
import { SpeechEngine } from '../src/engines/index.js';

describe('VoiceGIS Orchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupGlobals(true, true);
    
    // Mock the SpeechEngine methods so we don't actually load Whisper/TFJS models
    jest.spyOn(SpeechEngine.prototype, 'init').mockResolvedValue();
    jest.spyOn(SpeechEngine.prototype, 'start').mockImplementation(() => {});
    jest.spyOn(SpeechEngine.prototype, 'stop').mockImplementation(() => {});
    
    // Mock console.warn to keep test output clean
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('constructor sets default options', () => {
    const vgis = new VoiceGIS();
    expect(vgis.options.mapEngine).toBe(MAP_ENGINE.LEAFLET);
    expect(vgis.options.speechEngine).toBe('auto');
    expect(vgis.options.autoExecute).toBe(true);
  });

  test('speechEngine: auto picks WebSpeech when online & supported', async () => {
    setupGlobals(true, true); // Online, has WebSpeech
    const vgis = new VoiceGIS({ speechEngine: 'auto' });
    
    await vgis.initSpeech();
    expect(vgis.speech.engine).toBe(ENGINE_TYPE.WEB_SPEECH);
  });

  test('speechEngine: auto picks Whisper when offline', async () => {
    setupGlobals(false, true); // Offline
    const vgis = new VoiceGIS({ speechEngine: 'auto' });
    
    await vgis.initSpeech();
    expect(vgis.speech.engine).toBe(ENGINE_TYPE.WHISPER);
  });

  test('speechEngine: auto picks Whisper when WebSpeech not supported', async () => {
    setupGlobals(true, false); // Online, but no WebSpeech
    const vgis = new VoiceGIS({ speechEngine: 'auto' });
    
    await vgis.initSpeech();
    expect(vgis.speech.engine).toBe(ENGINE_TYPE.WHISPER);
  });

  test('Auto engine fallback: WebSpeech error triggers Whisper fallback', async () => {
    const vgis = new VoiceGIS({ speechEngine: 'auto' });
    await vgis.initSpeech();
    
    expect(vgis.speech.engine).toBe(ENGINE_TYPE.WEB_SPEECH);
    
    // Simulate runtime error in WebSpeech
    await vgis.speech._options.onError(new Error('Network disconnected'));
    
    // Should have instantiated a new engine as Whisper
    expect(vgis.speech.engine).toBe(ENGINE_TYPE.WHISPER);
  });

  test('Auto engine fallback: Whisper error triggers TF.js fallback', async () => {
    setupGlobals(false, true); // Start offline so it picks Whisper immediately
    const vgis = new VoiceGIS({ speechEngine: 'auto' });
    await vgis.initSpeech();
    
    expect(vgis.speech.engine).toBe(ENGINE_TYPE.WHISPER);
    
    // Simulate runtime error in Whisper
    await vgis.speech._options.onError(new Error('Model failed to load'));
    
    // Should have instantiated a new engine as TF.js
    expect(vgis.speech.engine).toBe(ENGINE_TYPE.TFJS);
  });
});
