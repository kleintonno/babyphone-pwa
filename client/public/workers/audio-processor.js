// AudioWorklet Processor - runs in a separate thread for real-time audio processing
// This file must be vanilla JS (no TypeScript, no modules)

class AudioLevelProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._frameCount = 0;
    this._reportInterval = 4; // Report every 4 frames (~11ms at 44100Hz)
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    let sum = 0;

    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }

    const rms = Math.sqrt(sum / samples.length);

    this._frameCount++;
    if (this._frameCount >= this._reportInterval) {
      this.port.postMessage({ rms });
      this._frameCount = 0;
    }

    return true;
  }
}

registerProcessor('audio-level-processor', AudioLevelProcessor);
