import { AudioCapture } from '../src/audio/AudioCapture.js';

describe('AudioCapture resampling', () => {
  test('downsamples browser-rate PCM to Whisper 16 kHz PCM', () => {
    const capture = new AudioCapture({ sampleRate: 16000 });
    const input = new Float32Array(480);
    input.fill(0.25);

    const output = capture._resample(input, 48000, 16000);

    expect(output).toHaveLength(160);
    expect(output.every((sample) => Math.abs(sample - 0.25) < 0.0001)).toBe(true);
  });

  test('returns a copy when the sample rate already matches', () => {
    const capture = new AudioCapture({ sampleRate: 16000 });
    const input = new Float32Array([0, 0.5, -0.5]);
    const output = capture._resample(input, 16000, 16000);

    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });
});
