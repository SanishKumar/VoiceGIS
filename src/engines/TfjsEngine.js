/**
 * TfjsEngine.js
 * Voice recognition using TensorFlow.js Speech Commands model.
 *
 * Provides lightweight, offline keyword spotting for a fixed set of
 * short keywords (up, down, left, right, go, stop, yes, no) that
 * are mapped to map actions.
 *
 * @module engines/TfjsEngine
 */

/**
 * Maps TF.js speech-command keywords to plain English phrases
 * so the command parser can handle them uniformly.
 */
const TFJS_KEYWORD_MAP = {
  up: 'zoom in',
  down: 'zoom out',
  left: 'pan left',
  right: 'pan right',
  go: 'go to',
  stop: 'stop',
  yes: 'confirm',
  no: 'cancel',
};

export class TfjsEngine {
  /**
   * @param {object} options
   * @param {function} [options.onResult]  - Called with (text: string, isFinal: boolean)
   * @param {function} [options.onError] - Called with (error: Error)
   * @param {function} [options.onStart] - Called when recognition starts
   * @param {function} [options.onEnd]   - Called when recognition ends
   * @param {number}   [options.tfjsThreshold]  - Confidence threshold (0–1). Default 0.85.
   * @param {number}   [options.tfjsCooldownMs] - Min ms between same-word results. Default 1500.
   */
  constructor(options = {}) {
    this.onResult = options.onResult || (() => {});
    this.onError = options.onError || ((e) => console.error('[TfjsEngine]', e));
    this.onStart = options.onStart || (() => {});
    this.onEnd = options.onEnd || (() => {});

    // Raised default threshold from 0.75 → 0.85 to reduce spurious detections.
    this.tfjsThreshold = options.tfjsThreshold ?? 0.85;
    // Minimum gap between repeated recognitions of the same word (debounce).
    this.tfjsCooldownMs = options.tfjsCooldownMs ?? 1500;

    this._tfjsModel = null;
    this._isListening = false;
    this._initialized = false;
    // Debounce state: track the last fired word and its timestamp.
    this._lastTfjsWord = null;
    this._lastTfjsTime = 0;
  }

  /**
   * Initialise the TF.js speech commands model.
   * Downloads the model from CDN on first call (~18 MB).
   * @returns {Promise<void>}
   */
  async init() {
    this._initialized = false;

    // speechCommands is loaded as a global from CDN
    const speechCommands = typeof window !== 'undefined' ? window.speechCommands : null;
    if (!speechCommands) {
      throw new Error(
        'TensorFlow.js speech-commands library not loaded. ' +
          'Make sure the CDN script is included before initialising.'
      );
    }

    const recognizer = speechCommands.create('BROWSER_FFT');
    await recognizer.ensureModelLoaded();
    this._tfjsModel = recognizer;
    this._initialized = true;
  }

  /** Returns true if init() completed successfully. */
  get isInitialized() {
    return this._initialized;
  }

  /** Start listening. */
  start() {
    if (!this._initialized) {
      this.onError(new Error('TfjsEngine not initialised. Call init() first.'));
      return;
    }
    if (this._isListening) return;
    this._isListening = true;
    this.onStart();
    this._startListening();
  }

  /** Stop listening. */
  stop() {
    this._isListening = false;
    this._stopListening();
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

  _startListening() {
    if (!this._tfjsModel) {
      this.onError(new Error('TF.js model not initialised. Call init() first.'));
      return;
    }

    const listenPromise = this._tfjsModel.listen(
      (result) => {
        const scores = result.scores;
        const words = this._tfjsModel.wordLabels();
        let maxScore = 0;
        let bestWord = '';

        for (let i = 0; i < scores.length; i++) {
          if (scores[i] > maxScore) {
            maxScore = scores[i];
            bestWord = words[i];
          }
        }

        // Reject noise / unknown / below-threshold detections.
        if (
          maxScore < this.tfjsThreshold ||
          !bestWord ||
          bestWord === '_background_noise_' ||
          bestWord === '_unknown_'
        ) {
          return;
        }

        const mapped = TFJS_KEYWORD_MAP[bestWord] || bestWord;
        const now = Date.now();

        // Debounce: suppress the same word if it was fired within the cooldown window.
        // This prevents a single spoken word from triggering many rapid-fire actions.
        if (mapped === this._lastTfjsWord && now - this._lastTfjsTime < this.tfjsCooldownMs) {
          return;
        }

        this._lastTfjsWord = mapped;
        this._lastTfjsTime = now;
        this.onResult(mapped, true);
      },
      {
        includeSpectrogram: false,
        // Pass the raised threshold to the model so it also skips low-confidence
        // frames before even invoking our callback.
        probabilityThreshold: this.tfjsThreshold,
        invokeCallbackOnNoiseAndUnknown: false,
        // Reduce overlap to lower callback frequency and cut CPU noise.
        overlapFactor: 0.3,
      }
    );

    Promise.resolve(listenPromise).catch((error) => {
      this._isListening = false;
      this.onError(new Error(`TF.js microphone start failed: ${error.message}`));
      this.onEnd();
    });
  }

  _stopListening() {
    if (this._tfjsModel && this._tfjsModel.isListening()) {
      this._tfjsModel.stopListening();
    }
  }
}
