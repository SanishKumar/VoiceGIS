/**
 * WebSpeechEngine.js
 * Voice recognition using the browser's Web Speech API.
 *
 * Provides full-sentence, online/offline recognition (primary engine).
 * Works in Chrome, Edge, and other Chromium-based browsers.
 *
 * @module engines/WebSpeechEngine
 */

export class WebSpeechEngine {
  /**
   * @param {object} options
   * @param {function} [options.onResult]  - Called with (text: string, isFinal: boolean)
   * @param {function} [options.onError] - Called with (error: Error)
   * @param {function} [options.onStart] - Called when recognition starts
   * @param {function} [options.onEnd]   - Called when recognition ends
   */
  constructor(options = {}) {
    this.onResult = options.onResult || (() => {});
    this.onError = options.onError || ((e) => console.error('[WebSpeechEngine]', e));
    this.onStart = options.onStart || (() => {});
    this.onEnd = options.onEnd || (() => {});

    this._recognition = null;
    this._isListening = false;
    this._restartOnEnd = false;
    this._initialized = false;
  }

  /**
   * Initialise the Web Speech API.  Must be called before start().
   * @returns {Promise<void>}
   */
  async init() {
    this._initialized = false;
    this._initRecognition();
    this._initialized = true;
  }

  /** Returns true if init() completed successfully. */
  get isInitialized() {
    return this._initialized;
  }

  /** Start listening. */
  start() {
    if (!this._initialized) {
      this.onError(new Error('WebSpeechEngine not initialised. Call init() first.'));
      return;
    }
    if (this._isListening) return;
    this._isListening = true;
    this._restartOnEnd = true;
    this.onStart();
    this._startRecognition();
  }

  /** Stop listening. */
  stop() {
    this._isListening = false;
    this._restartOnEnd = false;
    this._stopRecognition();
    this.onEnd();
  }

  /** Toggle between start and stop. */
  toggle() {
    if (this._isListening) {
      this.stop();
    } else {
      this.start();
    }
  }

  get isListening() {
    return this._isListening;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _initRecognition() {
    const SpeechRecognition =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

    if (!SpeechRecognition) {
      throw new Error(
        'Web Speech API is not supported in this browser. ' +
          'Try Chrome or Edge, or switch to the Whisper or TF.js engine.'
      );
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        this.onResult(finalTranscript.trim(), true);
      } else if (interimTranscript) {
        this.onResult(interimTranscript.trim(), false);
      }
    };

    rec.onerror = (event) => {
      // 'no-speech' is non-fatal; others may need attention
      if (event.error !== 'no-speech') {
        this.onError(new Error(`Speech recognition error: ${event.error}`));
      }
    };

    rec.onend = () => {
      if (this._restartOnEnd && this._isListening) {
        // Auto-restart for continuous listening
        try {
          rec.start();
        } catch (_) {
          // Already started
        }
      }
    };

    this._recognition = rec;
  }

  _startRecognition() {
    if (!this._recognition) {
      this._initRecognition();
    }
    try {
      this._recognition.start();
    } catch (e) {
      // InvalidStateError means it's already running
      if (!e.message.includes('already started')) {
        this.onError(e);
      }
    }
  }

  _stopRecognition() {
    if (this._recognition) {
      try {
        this._recognition.stop();
      } catch (_) { /* ignore */ }
    }
  }
}
