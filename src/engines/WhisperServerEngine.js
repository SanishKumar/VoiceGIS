/**
 * VoiceGIS — WhisperServerEngine
 *
 * Implements the standard engine interface but sends audio to a self-hosted Whisper server
 * via HTTP POST instead of processing locally.
 *
 * @module engines/WhisperServerEngine
 */

import { AudioCapture } from '../audio/AudioCapture.js';

export const SERVER_STATE = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  PROCESSING: 'PROCESSING',
  ERROR: 'ERROR'
};

/**
 * @typedef {Object} WhisperServerOptions
 * @property {string} [apiUrl='http://localhost:8000/transcribe']
 * @property {number} [requestTimeoutMs=10000]
 * @property {function} [onResult]
 * @property {function} [onError]
 * @property {function} [onStart]
 * @property {function} [onEnd]
 * @property {function} [onStateChange]
 */

export class WhisperServerEngine {
  /**
   * @param {WhisperServerOptions} options
   */
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || 'http://localhost:8000/transcribe';
    this.requestTimeoutMs = options.requestTimeoutMs || 10000;
    this.onResult = options.onResult || (() => {});
    this.onError = options.onError || console.error;
    this.onStart = options.onStart || (() => {});
    this.onEnd = options.onEnd || (() => {});
    this.onStateChange = options.onStateChange || (() => {});

    this._state = SERVER_STATE.IDLE;
    this._isListening = false;
    this._audioCapture = null;
    this._initialized = false;
  }

  get isInitialized() {
    return this._initialized;
  }

  get isListening() {
    return this._isListening;
  }

  _setState(state) {
    this._state = state;
    this.onStateChange(state);
  }

  async init() {
    if (this._initialized) return;

    this._audioCapture = new AudioCapture({
      sampleRate: 16000,
      silenceThresholdDb: -40,
      silenceDurationMs: 1200,
      onSilence: () => {
        if (this._isListening) {
          this._processAudio();
        }
      }
    });

    this._initialized = true;
  }

  async start() {
    if (!this._initialized) await this.init();
    if (this._isListening) return;

    try {
      await this._audioCapture.start();
      this._isListening = true;
      this._setState(SERVER_STATE.LISTENING);
      this.onStart();
    } catch (err) {
      this.onError(new Error(`Failed to start server engine capture: ${err.message}`));
    }
  }

  stop() {
    if (!this._isListening) return;
    this._isListening = false;
    
    // Process whatever is left in the buffer
    this._processAudio();
    
    this._audioCapture.stop();
    this._setState(SERVER_STATE.IDLE);
    this.onEnd();
  }

  toggle() {
    if (this._isListening) {
      this.stop();
    } else {
      this.start();
    }
  }

  getAudioCapture() {
    return this._audioCapture;
  }

  /**
   * Converts Float32Array to WAV Blob and POSTs it to the server.
   */
  async _processAudio() {
    if (!this._audioCapture || this._state === SERVER_STATE.PROCESSING) return;

    const buffer = this._audioCapture.getAudioBuffer();
    this._audioCapture.clearBuffer();

    // Skip very short audio
    if (buffer.length < 16000 * 0.5) return;

    this._setState(SERVER_STATE.PROCESSING);
    this.onResult('Processing...', false);

    let timeoutId = null;
    try {
      const wavBlob = this._encodeWAV(buffer, 16000);
      
      const formData = new FormData();
      formData.append('audio_file', wavBlob, 'recording.wav');

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const text = data.text?.trim();

      if (text && text.length > 0) {
        this.onResult(text, true);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        this.onError(new Error('Whisper Server request timed out.'));
      } else {
        this.onError(new Error(`Whisper Server error: ${err.message}`));
      }
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (this._isListening) {
        this._setState(SERVER_STATE.LISTENING);
      } else {
        this._setState(SERVER_STATE.IDLE);
      }
    }
  }

  /**
   * Helper to convert Float32Array to WAV format Blob
   * @param {Float32Array} samples 
   * @param {number} sampleRate 
   * @returns {Blob}
   */
  _encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (view, offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([view], { type: 'audio/wav' });
  }
}
