/**
 * whisperEngine.test.js — unit tests for WhisperEngine
 *
 * WhisperEngine depends on @huggingface/transformers (dynamic import)
 * and browser audio APIs. These are fully mocked for Node/Jest.
 */

import { jest } from '@jest/globals';

// Force the dynamic npm import to fail in tests, so WhisperEngine falls back 
// to our injected window.transformers mock. This prevents tests from making 
// real network requests to Hugging Face.
jest.unstable_mockModule('@huggingface/transformers', () => {
  throw new Error('Simulate missing npm module');
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Mock pipeline function that returns a transcription result. */
function makePipelineMock(result = { text: 'zoom in' }) {
  const pipelineFn = jest.fn().mockResolvedValue(result);
  return pipelineFn;
}

/** Mock the Transformers.js module. */
function installTransformersMock(pipelineResult) {
  const mockPipeline = makePipelineMock(pipelineResult);
  const mockModule = {
    pipeline: jest.fn().mockResolvedValue(mockPipeline),
  };
  globalThis.window = globalThis.window || {};
  globalThis.window.transformers = mockModule;
  return { mockModule, mockPipeline };
}

/** Mock navigator.mediaDevices.getUserMedia */
function installMediaMock() {
  const mockTrack = { stop: jest.fn() };
  const mockStream = { getTracks: jest.fn().mockReturnValue([mockTrack]) };

  globalThis.navigator = globalThis.navigator || {};
  globalThis.navigator.mediaDevices = {
    getUserMedia: jest.fn().mockResolvedValue(mockStream),
  };

  // Mock AudioContext
  const mockAnalyser = {
    fftSize: 2048,
    frequencyBinCount: 1024,
    smoothingTimeConstant: 0.8,
    getByteFrequencyData: jest.fn(),
    getFloatTimeDomainData: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  };

  const mockSource = {
    connect: jest.fn(),
    disconnect: jest.fn(),
  };

  const mockProcessor = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    onaudioprocess: null,
  };

  const mockAudioContext = {
    sampleRate: 16000,
    state: 'running',
    createMediaStreamSource: jest.fn().mockReturnValue(mockSource),
    createAnalyser: jest.fn().mockReturnValue(mockAnalyser),
    createScriptProcessor: jest.fn().mockReturnValue(mockProcessor),
    close: jest.fn().mockResolvedValue(undefined),
    destination: {},
  };

  globalThis.window.AudioContext = jest.fn().mockReturnValue(mockAudioContext);
  globalThis.window.webkitAudioContext = undefined;

  // Mock requestAnimationFrame/cancelAnimationFrame
  globalThis.requestAnimationFrame = jest.fn().mockReturnValue(1);
  globalThis.cancelAnimationFrame = jest.fn();

  return { mockStream, mockTrack, mockAudioContext, mockAnalyser, mockProcessor };
}

// We need to import WhisperEngine after mocks are set up, but ESM static imports
// happen before test code runs. The WhisperEngine dynamically loads transformers,
// so the mock just needs to be on window.transformers before init() is called.

let WhisperEngine, WHISPER_STATE, ENGINE_TYPE;

beforeAll(async () => {
  // Install base mocks before importing
  globalThis.window = globalThis.window || {};
  globalThis.navigator = globalThis.navigator || {};
  globalThis.navigator.gpu = undefined; // No WebGPU in tests

  const engineModule = await import('../src/engines/WhisperEngine.js');
  WhisperEngine = engineModule.WhisperEngine;
  WHISPER_STATE = engineModule.WHISPER_STATE;

  const indexModule = await import('../src/engines/index.js');
  ENGINE_TYPE = indexModule.ENGINE_TYPE;
});

// ---------------------------------------------------------------------------
// WHISPER_STATE constant
// ---------------------------------------------------------------------------

describe('WHISPER_STATE', () => {
  test('has all expected state values', () => {
    expect(WHISPER_STATE.IDLE).toBe('idle');
    expect(WHISPER_STATE.LOADING_MODEL).toBe('loading_model');
    expect(WHISPER_STATE.READY).toBe('ready');
    expect(WHISPER_STATE.LISTENING).toBe('listening');
    expect(WHISPER_STATE.PROCESSING).toBe('processing');
    expect(WHISPER_STATE.ERROR).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Constructor defaults
// ---------------------------------------------------------------------------

describe('WhisperEngine — constructor', () => {
  test('defaults model to whisper-tiny.en', () => {
    const e = new WhisperEngine({});
    expect(e.modelId).toMatch(/whisper-tiny/);
  });

  test('isListening starts false', () => {
    const e = new WhisperEngine({});
    expect(e.isListening).toBe(false);
  });

  test('isInitialized starts false', () => {
    const e = new WhisperEngine({});
    expect(e.isInitialized).toBe(false);
  });

  test('modelLoaded starts false', () => {
    const e = new WhisperEngine({});
    expect(e.modelLoaded).toBe(false);
  });

  test('modelProgress starts at 0', () => {
    const e = new WhisperEngine({});
    expect(e.modelProgress).toBe(0);
  });

  test('state starts as IDLE', () => {
    const e = new WhisperEngine({});
    expect(e.state).toBe(WHISPER_STATE.IDLE);
  });

  test('accepts custom modelId', () => {
    const e = new WhisperEngine({ modelId: 'onnx-community/whisper-base.en' });
    expect(e.modelId).toBe('onnx-community/whisper-base.en');
  });

  test('accepts custom silenceThresholdMs', () => {
    const e = new WhisperEngine({ silenceThresholdMs: 2000 });
    expect(e.silenceThresholdMs).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// init()
// ---------------------------------------------------------------------------

describe('WhisperEngine — init()', () => {
  test('loads model and sets state to READY', async () => {
    const { mockModule } = installTransformersMock({ text: 'test' });
    const onStateChange = jest.fn();
    const e = new WhisperEngine({ onStateChange });

    await e.init();

    expect(e.isInitialized).toBe(true);
    expect(e.modelLoaded).toBe(true);
    expect(e.modelProgress).toBe(1);
    expect(e.state).toBe(WHISPER_STATE.READY);
    expect(mockModule.pipeline).toHaveBeenCalledTimes(1);
    // State should have transitioned LOADING_MODEL → READY
    expect(onStateChange).toHaveBeenCalledWith(WHISPER_STATE.LOADING_MODEL);
    expect(onStateChange).toHaveBeenCalledWith(WHISPER_STATE.READY);
  });

  test('throws if transformers.js is not available', async () => {
    delete globalThis.window.transformers;
    const e = new WhisperEngine({});
    await expect(e.init()).rejects.toThrow(/Failed to load Whisper/i);
    expect(e.state).toBe(WHISPER_STATE.ERROR);
  });

  test('calls onModelProgress during loading', async () => {
    const mockModule = {
      pipeline: jest.fn().mockImplementation(async (task, model, opts) => {
        // Simulate progress callbacks
        if (opts.progress_callback) {
          opts.progress_callback({ status: 'initiate', file: 'model.onnx' });
          opts.progress_callback({ status: 'progress', progress: 50, file: 'model.onnx' });
          opts.progress_callback({ status: 'done' });
        }
        return jest.fn().mockResolvedValue({ text: 'test' });
      }),
    };
    globalThis.window.transformers = mockModule;

    const onModelProgress = jest.fn();
    const e = new WhisperEngine({ onModelProgress });
    await e.init();

    expect(onModelProgress).toHaveBeenCalledWith(
      expect.objectContaining({ progress: 0, status: expect.stringContaining('Loading') })
    );
    expect(onModelProgress).toHaveBeenCalledWith(
      expect.objectContaining({ progress: 0.5, status: expect.stringContaining('50') })
    );
    expect(onModelProgress).toHaveBeenCalledWith(
      expect.objectContaining({ progress: 1, status: 'Model loaded' })
    );
  });
});

// ---------------------------------------------------------------------------
// start / stop / toggle
// ---------------------------------------------------------------------------

describe('WhisperEngine — start/stop', () => {
  beforeEach(() => {
    installTransformersMock({ text: 'test' });
    installMediaMock();
  });

  test('calling start() before init() fires onError', () => {
    const onError = jest.fn();
    const e = new WhisperEngine({ onError });
    e.start();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toMatch(/not initialised/i);
  });

  test('start() sets isListening and calls onStart', async () => {
    const onStart = jest.fn();
    const e = new WhisperEngine({ onStart });
    await e.init();
    e.start();
    expect(e.isListening).toBe(true);
    expect(onStart).toHaveBeenCalled();
  });

  test('stop() clears isListening and calls onEnd', async () => {
    const onEnd = jest.fn();
    const e = new WhisperEngine({ onEnd });
    await e.init();
    e.start();
    e.stop();
    expect(e.isListening).toBe(false);
    expect(onEnd).toHaveBeenCalled();
  });

  test('toggle() starts then stops', async () => {
    const e = new WhisperEngine({});
    await e.init();
    e.toggle();
    expect(e.isListening).toBe(true);
    e.toggle();
    expect(e.isListening).toBe(false);
  });

  test('state transitions: READY → LISTENING → READY', async () => {
    const onStateChange = jest.fn();
    const e = new WhisperEngine({ onStateChange });
    await e.init();
    onStateChange.mockClear();

    e.start();
    expect(e.state).toBe(WHISPER_STATE.LISTENING);

    e.stop();
    expect(e.state).toBe(WHISPER_STATE.READY);
  });
});

// ---------------------------------------------------------------------------
// ENGINE_TYPE integration
// ---------------------------------------------------------------------------

describe('ENGINE_TYPE — whisper', () => {
  test('ENGINE_TYPE.WHISPER is defined', () => {
    expect(ENGINE_TYPE.WHISPER).toBe('whisper');
  });
});
