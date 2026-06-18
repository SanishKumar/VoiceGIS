/**
 * VoiceGIS Orchestrator
 *
 * The main entry point for the npm library.
 * Wires together the map, speech engine, and command parser into a simple API.
 *
 * @module VoiceGIS
 */

import { SpeechEngine, ENGINE_TYPE } from './engines/index.js';
import { parseCommand, defaultGeocoder, INTENT } from './parser/index.js';
import { MapController, MAP_ENGINE } from './map/index.js';
import { CommandHistory } from './history/index.js';

export class VoiceGIS {
  /**
   * Initialize a new VoiceGIS instance.
   *
   * @param {object} options
   * @param {string} [options.mapEngine='leaflet'] - 'leaflet' or 'openlayers'
   * @param {string} [options.mapContainerId]      - DOM ID for the map
   * @param {string} [options.speechEngine='webspeech'] - 'webspeech', 'tfjs', or 'whisper'
   * @param {boolean} [options.autoExecute=true]   - Whether to automatically execute parsed commands on the map
   * @param {boolean} [options.enableGeocoding=true] - Whether to use Nominatim for unknown places
   * @param {function} [options.onCommandParsed]   - Callback when a command is parsed: (result, rawText) => void
   * @param {function} [options.onStateChange]     - Callback when engine state changes
   * @param {function} [options.onEngineSwitched]  - Callback when the auto strategy switches engines
   */
  constructor(options = {}) {
    this.options = {
      mapEngine: MAP_ENGINE.LEAFLET,
      speechEngine: ENGINE_TYPE.WEB_SPEECH,
      autoExecute: true,
      enableGeocoding: true,
      enableHistory: true,
      ...options,
    };

    /** @type {MapController|null} */
    this.map = null;
    
    /** @type {SpeechEngine|null} */
    this.speech = null;

    /** @type {Array<{ intent: string, pattern: RegExp, action: function }>} Custom commands */
    this.customCommands = [];
    
    /** @type {CommandHistory|null} */
    this.history = this.options.enableHistory ? new CommandHistory() : null;
    
    // Auto-initialize map if a container was provided
    if (this.options.mapContainerId) {
      this.initMap(this.options.mapEngine, this.options.mapContainerId);
    }
  }

  /**
   * Initialize the map controller.
   * @param {string} engine 
   * @param {string} containerId 
   */
  initMap(engine, containerId) {
    if (this.map) {
      this.map.destroy();
    }
    this.map = new MapController({
      engine,
      containerId,
    });
    this.map.init();
  }

  /**
   * Initialize the speech engine.
   * Handles the 'auto' routing strategy.
   * @returns {Promise<void>}
   */
  async initSpeech() {
    let targetEngine = this.options.speechEngine;

    if (targetEngine === 'auto') {
      const hasWebSpeech = typeof window !== 'undefined' && 
        (window.SpeechRecognition || window.webkitSpeechRecognition);
      
      if (hasWebSpeech && navigator.onLine) {
        targetEngine = ENGINE_TYPE.WEB_SPEECH;
      } else {
        targetEngine = ENGINE_TYPE.WHISPER;
      }
    }

    await this._instantiateEngine(targetEngine);
  }

  async _instantiateEngine(engineType) {
    if (this.speech) {
      this.speech.stop();
    }

    if (this.options.onEngineSwitched) {
      this.options.onEngineSwitched(engineType);
    }

    this.speech = new SpeechEngine({
      engine: engineType,
      onResult: (text, isFinal) => this._handleSpeechResult(text, isFinal),
      onError: async (err) => {
        console.error(`[VoiceGIS] Engine ${engineType} error:`, err);
        
        // Fallback logic for Auto mode
        if (this.options.speechEngine === 'auto') {
          if (engineType === ENGINE_TYPE.WEB_SPEECH) {
            console.warn('WebSpeech failed, falling back to Whisper');
            await this._instantiateEngine(ENGINE_TYPE.WHISPER);
            this.start();
          } else if (engineType === ENGINE_TYPE.WHISPER) {
            console.warn('Whisper failed, falling back to Command Mode (TF.js)');
            await this._instantiateEngine(ENGINE_TYPE.TFJS);
            this.start();
          } else {
            if (this.options.onStateChange) this.options.onStateChange('error');
          }
        } else {
          if (this.options.onStateChange) this.options.onStateChange('error');
        }
      },
      onStart: () => {
        if (this.options.onStateChange) this.options.onStateChange('listening');
      },
      onEnd: () => {
        if (this.options.onStateChange) this.options.onStateChange('idle');
      },
    });

    await this.speech.init();
  }

  /**
   * Start listening for voice commands.
   */
  start() {
    if (!this.speech) {
      throw new Error('Speech engine not initialized. Call initSpeech() first.');
    }
    
    // Check auto fallback condition dynamically
    if (this.options.speechEngine === 'auto' && 
        this.speech.engine === ENGINE_TYPE.WEB_SPEECH && 
        !navigator.onLine) {
      console.warn('Went offline, switching Auto engine to Whisper');
      this._instantiateEngine(ENGINE_TYPE.WHISPER).then(() => this.speech.start());
      return;
    }

    this.speech.start();
  }

  /**
   * Stop listening for voice commands.
   */
  stop() {
    if (this.speech) {
      this.speech.stop();
    }
  }

  /**
   * Register a custom voice command.
   *
   * @param {string} intentName - Unique identifier for the intent
   * @param {RegExp} pattern - Regular expression to match the spoken text
   * @param {function} action - Callback executed when the command is triggered
   */
  registerCommand(intentName, pattern, action) {
    this.customCommands.push({ intent: intentName, pattern, action });
  }

  /**
   * Internal handler for speech results.
   */
  async _handleSpeechResult(text, isFinal) {
    if (!isFinal || !text) return;

    const lowerText = text.toLowerCase().trim();

    // 1. Check custom commands first
    for (const cmd of this.customCommands) {
      const match = lowerText.match(cmd.pattern);
      if (match) {
        const result = { intent: cmd.intent, payload: { match }, raw: text, confidence: 1 };
        
        if (this.options.onCommandParsed) {
          this.options.onCommandParsed(result, text);
        }

        if (this.options.autoExecute && this.map) {
          cmd.action(this.map, match);
        }
        return;
      }
    }

    // 2. Fall back to built-in parser
    const result = await parseCommand(text, {
      enableGeocoding: this.options.enableGeocoding,
      geocoder: defaultGeocoder
    });

    if (this.options.onCommandParsed) {
      this.options.onCommandParsed(result, text);
    }

    if (this.options.autoExecute && this.map) {
      this._executeBuiltIn(result);
    }
  }

  /**
   * Execute built-in map actions.
   */
  _executeBuiltIn(result) {
    // Determine if command modifies the map view
    const isStatefulCommand = [
      INTENT.ZOOM_IN, INTENT.ZOOM_OUT, INTENT.GO_TO, 
      INTENT.ADD_MARKER, INTENT.RESET_VIEW
    ].includes(result.intent);

    if (isStatefulCommand && this.history) {
      this.history.snapshot(this.map);
    }

    switch (result.intent) {
      case INTENT.ZOOM_IN:
        this.map.zoomIn();
        break;
      case INTENT.ZOOM_OUT:
        this.map.zoomOut();
        break;
      case INTENT.GO_TO:
        this.map.goTo(result.payload.coords, 12, result.payload.place);
        break;
      case INTENT.SHOW_LAYER:
        this.map.showLayer(result.payload.layerId);
        break;
      case INTENT.HIDE_LAYER:
        this.map.hideLayer(result.payload.layerId);
        break;
      case INTENT.ADD_MARKER:
        if (result.payload.useCurrentLocation) {
          this.map.addMarkerAtCurrentLocation();
        } else {
          const c = this.map.getCenter();
          this.map.addMarker([c.lat, c.lng], '📍 Marker');
        }
        break;
      case INTENT.RESET_VIEW:
        this.map.resetView();
        break;
      case INTENT.SWITCH_MAP:
        console.warn('Map engine switching is not supported via auto-execute in the Orchestrator.');
        break;
      case INTENT.UNDO:
        if (this.history) {
          const success = this.history.undo(this.map);
          if (!success) console.warn('Nothing to undo.');
        }
        break;
      case INTENT.REDO:
        if (this.history) {
          const success = this.history.redo(this.map);
          if (!success) console.warn('Nothing to redo.');
        }
        break;
    }
  }
}
