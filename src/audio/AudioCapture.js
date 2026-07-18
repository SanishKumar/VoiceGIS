/**
 * AudioCapture.js
 * Encapsulates Web Audio API microphone capture with silence detection.
 *
 * Captures raw PCM audio from the microphone, resamples to 16kHz mono
 * (required by Whisper), and provides silence detection for auto-segmentation.
 *
 * @module audio/AudioCapture
 */

/**
 * @typedef {object} AudioCaptureOptions
 * @property {number}   [sampleRate=16000]         - Target sample rate for output
 * @property {number}   [silenceThresholdDb=-45]    - Volume below this (in dB) is considered silence
 * @property {number}   [silenceDurationMs=1500]    - How long silence must last to trigger onSilence
 * @property {number}   [maxBufferDurationMs=30000] - Maximum buffer duration before auto-flush
 * @property {function} [onSilence]                 - Called when silence is detected after speech
 * @property {function} [onAudioData]               - Called with Float32Array chunks during capture
 * @property {function} [onVolumeChange]            - Called with current volume level (0-1)
 */

export class AudioCapture {
  /**
   * @param {AudioCaptureOptions} options
   */
  constructor(options = {}) {
    this.targetSampleRate = options.sampleRate || 16000;
    this.silenceThresholdDb = options.silenceThresholdDb ?? -40;
    this.silenceDurationMs = options.silenceDurationMs ?? 2000;
    this.maxBufferDurationMs = options.maxBufferDurationMs ?? 30000;
    this.onSilence = options.onSilence || (() => {});
    this.onAudioData = options.onAudioData || (() => {});
    this.onVolumeChange = options.onVolumeChange || (() => {});

    /** @type {AudioContext|null} */
    this._audioContext = null;
    /** @type {MediaStream|null} */
    this._stream = null;
    /** @type {MediaStreamAudioSourceNode|null} */
    this._source = null;
    /** @type {AnalyserNode|null} */
    this._analyser = null;
    /** @type {ScriptProcessorNode|AudioWorkletNode|null} */
    this._processor = null;

    /** @type {Float32Array[]} Accumulated audio chunks */
    this._bufferChunks = [];
    this._bufferSampleCount = 0;

    this._isCapturing = false;
    this._hasSpeechStarted = false;
    this._silenceStartTime = 0;
    this._volumeAnimFrame = null;
  }

  /**
   * Request microphone permission and start capturing audio.
   * @returns {Promise<void>}
   */
  async start() {
    if (this._isCapturing) return;

    try {
      // Request microphone
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: { ideal: this.targetSampleRate },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Browsers may ignore the requested context sample rate. Captured chunks
      // are resampled below so Whisper always receives true 16 kHz PCM.
      this._audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.targetSampleRate,
      });
    } catch (error) {
      if (this._stream) {
        this._stream.getTracks().forEach((track) => track.stop());
        this._stream = null;
      }
      throw error;
    }

    // Source node from microphone
    this._source = this._audioContext.createMediaStreamSource(this._stream);

    // Analyser node for volume metering and waveform visualization
    this._analyser = this._audioContext.createAnalyser();
    this._analyser.fftSize = 2048;
    this._analyser.smoothingTimeConstant = 0.8;
    this._source.connect(this._analyser);

    // Use ScriptProcessorNode for audio data capture
    // (AudioWorklet would be better but requires serving a separate file)
    const bufferSize = 4096;
    this._processor = this._audioContext.createScriptProcessor(bufferSize, 1, 1);

    this._processor.onaudioprocess = (event) => {
      if (!this._isCapturing) return;

      const inputData = event.inputBuffer.getChannelData(0);
      const inputRate = event.inputBuffer.sampleRate || this._audioContext.sampleRate;
      const chunk = this._resample(inputData, inputRate, this.targetSampleRate);

      // Accumulate buffer
      this._bufferChunks.push(chunk);
      this._bufferSampleCount += chunk.length;

      // Notify listener
      this.onAudioData(chunk);

      // Check silence detection
      this._checkSilence(chunk);

      // Auto-flush if buffer is too long
      const bufferDurationMs = (this._bufferSampleCount / this.targetSampleRate) * 1000;
      if (bufferDurationMs >= this.maxBufferDurationMs) {
        this._triggerSilence();
      }
    };

    this._analyser.connect(this._processor);
    this._processor.connect(this._audioContext.destination);

    this._isCapturing = true;
    this._hasSpeechStarted = false;
    this._silenceStartTime = 0;
    this._bufferChunks = [];
    this._bufferSampleCount = 0;

    // Start volume monitoring
    this._monitorVolume();
  }

  /**
   * Stop capturing and release microphone.
   */
  stop() {
    this._isCapturing = false;

    if (this._volumeAnimFrame) {
      cancelAnimationFrame(this._volumeAnimFrame);
      this._volumeAnimFrame = null;
    }

    if (this._processor) {
      this._processor.disconnect();
      this._processor = null;
    }

    if (this._source) {
      this._source.disconnect();
      this._source = null;
    }

    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }

    if (this._audioContext && this._audioContext.state !== 'closed') {
      this._audioContext.close().catch(() => {});
      this._audioContext = null;
    }

    this._analyser = null;
  }

  /**
   * Get the AnalyserNode for external waveform visualization.
   * @returns {AnalyserNode|null}
   */
  getAnalyserNode() {
    return this._analyser;
  }

  /**
   * Get the accumulated audio buffer as a single Float32Array (16kHz mono).
   * @returns {Float32Array}
   */
  getAudioBuffer() {
    if (this._bufferChunks.length === 0) return new Float32Array(0);

    const result = new Float32Array(this._bufferSampleCount);
    let offset = 0;
    for (const chunk of this._bufferChunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  /**
   * Clear the accumulated audio buffer.
   */
  clearBuffer() {
    this._bufferChunks = [];
    this._bufferSampleCount = 0;
    this._hasSpeechStarted = false;
    this._silenceStartTime = 0;
  }

  /**
   * Whether the capture is currently active.
   * @returns {boolean}
   */
  get isCapturing() {
    return this._isCapturing;
  }

  /**
   * Get the current audio context sample rate.
   * @returns {number}
   */
  get actualSampleRate() {
    return this._audioContext ? this._audioContext.sampleRate : this.targetSampleRate;
  }

  // ---------------------------------------------------------------------------
  // Internal: silence detection
  // ---------------------------------------------------------------------------

  /**
   * Check a chunk for silence. If speech was detected and then silence
   * lasts longer than silenceDurationMs, trigger onSilence.
   * @param {Float32Array} chunk
   */
  _checkSilence(chunk) {
    const rms = this._calculateRMS(chunk);
    const db = 20 * Math.log10(Math.max(rms, 1e-10));

    if (db > this.silenceThresholdDb) {
      // Speech detected
      this._hasSpeechStarted = true;
      this._silenceStartTime = 0;
    } else if (this._hasSpeechStarted) {
      // Silence after speech
      if (this._silenceStartTime === 0) {
        this._silenceStartTime = Date.now();
      } else if (Date.now() - this._silenceStartTime >= this.silenceDurationMs) {
        this._triggerSilence();
      }
    }
  }

  _triggerSilence() {
    if (this._bufferSampleCount > 0) {
      this.onSilence();
    }
  }

  /**
   * Calculate RMS (root mean square) of an audio buffer.
   * @param {Float32Array} buffer
   * @returns {number}
   */
  _calculateRMS(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }

  /**
   * Resample a PCM chunk using linear interpolation.
   * @param {Float32Array} input
   * @param {number} inputRate
   * @param {number} outputRate
   * @returns {Float32Array}
   */
  _resample(input, inputRate, outputRate) {
    if (inputRate === outputRate || input.length === 0) {
      return new Float32Array(input);
    }

    const outputLength = Math.max(1, Math.round(input.length * outputRate / inputRate));
    const output = new Float32Array(outputLength);
    const ratio = inputRate / outputRate;

    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = i * ratio;
      const lower = Math.floor(sourceIndex);
      const upper = Math.min(lower + 1, input.length - 1);
      const weight = sourceIndex - lower;
      output[i] = input[lower] * (1 - weight) + input[upper] * weight;
    }

    return output;
  }

  // ---------------------------------------------------------------------------
  // Internal: volume monitoring
  // ---------------------------------------------------------------------------

  _monitorVolume() {
    if (!this._isCapturing || !this._analyser) return;

    const dataArray = new Uint8Array(this._analyser.frequencyBinCount);
    this._analyser.getByteFrequencyData(dataArray);

    // Calculate average volume (0-255 → 0-1)
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const avg = sum / dataArray.length / 255;
    this.onVolumeChange(avg);

    this._volumeAnimFrame = requestAnimationFrame(() => this._monitorVolume());
  }
}
