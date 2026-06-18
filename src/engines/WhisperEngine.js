/**
 * WhisperEngine.js
 * On-device voice recognition using OpenAI Whisper via Transformers.js.
 *
 * Runs the Whisper model entirely in the browser using ONNX Runtime (WASM/WebGPU).
 * No server required — audio is processed locally on the user's device.
 *
 * Model: onnx-community/whisper-tiny.en (~40MB, cached in browser Cache API)
 * Pipeline: automatic-speech-recognition
 *
 * @module engines/WhisperEngine
 */

import { AudioCapture } from '../audio/AudioCapture.js';

/** Default Whisper model to use. */
const DEFAULT_MODEL = 'onnx-community/whisper-tiny.en';

/**
 * Possible engine states for UI feedback.
 */
export const WHISPER_STATE = {
  IDLE: 'idle',
  LOADING_MODEL: 'loading_model',
  READY: 'ready',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  ERROR: 'error',
};

export class WhisperEngine {
  /**
   * @param {object} [options]
   * @param {function} [options.onResult]          - Called with (text: string, isFinal: boolean)
   * @param {function} [options.onError]         - Called with (error: Error)
   * @param {function} [options.onStart]         - Called when listening starts
   * @param {function} [options.onEnd]           - Called when listening stops
   * @param {function} [options.onModelProgress] - Called with ({ progress: 0-1, status: string })
   * @param {function} [options.onStateChange]   - Called with WHISPER_STATE value
   * @param {function} [options.onVolumeChange]  - Called with volume level (0-1)
   * @param {string}   [options.modelId]         - HuggingFace model ID
   * @param {number}   [options.silenceThresholdMs=1500] - Silence duration to trigger transcription
   * @param {string}   [options.language='en']   - Language code
   */
  constructor(options = {}) {
    this.onResult = options.onResult || (() => {});
    this.onError = options.onError || ((e) => console.error('[WhisperEngine]', e));
    this.onStart = options.onStart || (() => {});
    this.onEnd = options.onEnd || (() => {});
    this.onModelProgress = options.onModelProgress || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.onVolumeChange = options.onVolumeChange || (() => {});

    this.modelId = options.modelId || DEFAULT_MODEL;
    this.silenceThresholdMs = options.silenceThresholdMs ?? 1500;
    this.language = options.language || 'en';

    /** @type {any} Transformers.js pipeline instance */
    this._pipeline = null;
    /** @type {AudioCapture|null} */
    this._audioCapture = null;

    this._isListening = false;
    this._initialized = false;
    this._isProcessing = false;
    this._modelLoaded = false;
    this._modelProgress = 0;
    this._state = WHISPER_STATE.IDLE;
  }

  /**
   * Initialize the Whisper engine.
   * Downloads the model on first call (~40MB), subsequent calls load from cache.
   * @returns {Promise<void>}
   */
  async init() {
    this._initialized = false;
    this._setState(WHISPER_STATE.LOADING_MODEL);

    try {
      // Dynamically import Transformers.js — may come from npm or CDN
      const transformers = await this._loadTransformers();

      // Create the ASR pipeline
      this._pipeline = await transformers.pipeline(
        'automatic-speech-recognition',
        this.modelId,
        {
          dtype: 'q8',  // Quantized for faster inference
          device: await this._detectDevice(),
          progress_callback: (progress) => {
            if (progress.status === 'progress') {
              this._modelProgress = progress.progress / 100;
              this.onModelProgress({
                progress: this._modelProgress,
                status: `Downloading: ${Math.round(progress.progress)}%`,
                file: progress.file,
              });
            } else if (progress.status === 'done') {
              this.onModelProgress({
                progress: 1,
                status: 'Model loaded',
              });
            } else if (progress.status === 'initiate') {
              this.onModelProgress({
                progress: 0,
                status: `Loading ${progress.file || 'model'}...`,
              });
            }
          },
        }
      );

      this._modelLoaded = true;
      this._modelProgress = 1;
      this._initialized = true;
      this._setState(WHISPER_STATE.READY);
    } catch (err) {
      this._setState(WHISPER_STATE.ERROR);
      throw new Error(
        `Failed to load Whisper model "${this.modelId}": ${err.message}. ` +
        'Make sure @huggingface/transformers is installed or available via CDN.'
      );
    }
  }

  /** Returns true if init() completed successfully. */
  get isInitialized() {
    return this._initialized;
  }

  /** Returns true if currently listening for voice input. */
  get isListening() {
    return this._isListening;
  }

  /** Returns true once model weights are in memory. */
  get modelLoaded() {
    return this._modelLoaded;
  }

  /** Model download progress (0-1). */
  get modelProgress() {
    return this._modelProgress;
  }

  /** Current engine state. */
  get state() {
    return this._state;
  }

  /**
   * Start listening — opens microphone, begins capturing audio.
   */
  start() {
    if (!this._initialized) {
      this.onError(new Error('WhisperEngine not initialised. Call init() first.'));
      return;
    }
    if (this._isListening) return;

    this._isListening = true;
    this._setState(WHISPER_STATE.LISTENING);
    this.onStart();

    // Create AudioCapture with silence detection
    this._audioCapture = new AudioCapture({
      sampleRate: 16000,
      silenceDurationMs: this.silenceThresholdMs,
      onSilence: () => this._processAudio(),
      onVolumeChange: (vol) => this.onVolumeChange(vol),
    });

    this._audioCapture.start().catch((err) => {
      this.onError(new Error(`Microphone access failed: ${err.message}`));
      this._isListening = false;
      this._setState(WHISPER_STATE.ERROR);
    });
  }

  /**
   * Stop listening — releases microphone.
   */
  stop() {
    this._isListening = false;

    // Process any remaining audio before stopping
    if (this._audioCapture && this._audioCapture.isCapturing) {
      const buffer = this._audioCapture.getAudioBuffer();
      if (buffer.length > 0 && !this._isProcessing) {
        this._processBuffer(buffer);
      }
    }

    if (this._audioCapture) {
      this._audioCapture.stop();
      this._audioCapture = null;
    }

    this._setState(WHISPER_STATE.READY);
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

  /**
   * Get the AudioCapture instance (for waveform visualization).
   * @returns {AudioCapture|null}
   */
  getAudioCapture() {
    return this._audioCapture;
  }

  /**
   * Preload the model without starting listening.
   * Useful for triggering the download during app initialization.
   * @returns {Promise<void>}
   */
  async preloadModel() {
    if (!this._initialized) {
      await this.init();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: audio processing
  // ---------------------------------------------------------------------------

  /**
   * Process the accumulated audio buffer through Whisper.
   */
  async _processAudio() {
    if (!this._audioCapture || this._isProcessing) return;

    const buffer = this._audioCapture.getAudioBuffer();
    this._audioCapture.clearBuffer();

    if (buffer.length === 0) return;

    await this._processBuffer(buffer);
  }

  /**
   * Run Whisper inference on a Float32Array audio buffer.
   * @param {Float32Array} buffer - 16kHz mono audio
   */
  async _processBuffer(buffer) {
    if (!this._pipeline || this._isProcessing) return;

    // Skip very short audio (< 0.3 seconds) — likely noise
    if (buffer.length < 16000 * 0.3) return;

    this._isProcessing = true;
    this._setState(WHISPER_STATE.PROCESSING);

    // Show interim result while processing
    this.onResult('Processing...', false);

    try {
      const isEnglishOnly = this.modelId.endsWith('.en');
      
      const generationOptions = {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      };

      if (!isEnglishOnly) {
        generationOptions.language = this.language;
        generationOptions.task = 'transcribe';
      }

      const result = await this._pipeline(buffer, generationOptions);

      const text = result.text?.trim();

      // Hallucination Filter: Ignore common Whisper outputs caused by silence
      const hallucinations = [
        'you', 'you.', 'thank you', 'thank you.', 'thanks.', 
        'test', 'test.', 'ok', 'ok.', 'okay', 'okay.', 'testing.',
        'bye.', 'bye', 'goodbye.'
      ];
      
      const isHallucination = 
        !text || 
        (text.length < 3 && !/[a-zA-Z]/.test(text)) || 
        hallucinations.includes(text.toLowerCase());

      if (text && text.length > 0 && !isHallucination) {
        this.onResult(text, true);
      }
    } catch (err) {
      this.onError(new Error(`Whisper inference error: ${err.message}`));
    } finally {
      this._isProcessing = false;
      if (this._isListening) {
        this._setState(WHISPER_STATE.LISTENING);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: module loading and device detection
  // ---------------------------------------------------------------------------

  /**
   * Dynamically load the Transformers.js library.
   * Tries npm import first, then falls back to CDN global.
   */
  async _loadTransformers() {
    // Try npm import
    try {
      return await import('@huggingface/transformers');
    } catch (_) {
      // Not installed via npm
    }

    // Try CDN global
    if (typeof window !== 'undefined' && window.transformers) {
      return window.transformers;
    }

    throw new Error(
      '@huggingface/transformers not found. Install via npm: ' +
      'npm install @huggingface/transformers, or include the CDN script.'
    );
  }

  /**
   * Detect the best available compute device.
   * WebGPU > WASM fallback.
   */
  async _detectDevice() {
    // Check for WebGPU support
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) return 'webgpu';
      } catch (_) { /* ignore */ }
    }

    // Fall back to WASM (always available)
    return 'wasm';
  }

  /**
   * Update internal state and notify listener.
   * @param {string} state - WHISPER_STATE value
   */
  _setState(state) {
    this._state = state;
    this.onStateChange(state);
  }
}
