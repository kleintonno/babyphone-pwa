import { getState, setState } from './state.js';
import { send } from './signaling.js';

let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let workletNode: AudioWorkletNode | null = null;

// Exponential Moving Average for smoothing
let ema = 0;
const EMA_ALPHA = 0.3;

// Noise detection state
let noiseStartTime: number | null = null;
const NOISE_HOLD_MS = 2000; // Must be above threshold for 2 seconds
let cooldownUntil = 0;
const COOLDOWN_MS = 30_000; // 30s cooldown between alerts

export async function startMonitoring(): Promise<void> {
  if (audioContext) return;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    audioContext = new AudioContext();

    // Load AudioWorklet processor
    await audioContext.audioWorklet.addModule('/workers/audio-processor.js');

    const source = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'audio-level-processor');

    workletNode.port.onmessage = (event: MessageEvent) => {
      const { rms } = event.data as { rms: number };
      processAudioLevel(rms);
    };

    source.connect(workletNode);
    // Don't connect to destination - we don't want to play the audio on the baby device
    // workletNode.connect(audioContext.destination);

    setState({ monitoring: true, error: null });
    console.log('[Audio] Monitoring started');
  } catch (err) {
    console.error('[Audio] Failed to start monitoring:', err);
    setState({
      error: 'Mikrofon-Zugriff verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.',
    });
  }
}

export function stopMonitoring(): void {
  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  ema = 0;
  noiseStartTime = null;
  setState({ monitoring: false, noiseLevel: 0, noiseDetected: false });
  console.log('[Audio] Monitoring stopped');
}

function processAudioLevel(rms: number): void {
  // Smooth with EMA
  ema = EMA_ALPHA * rms + (1 - EMA_ALPHA) * ema;

  const state = getState();
  const threshold = state.noiseThreshold;
  const now = Date.now();

  setState({ noiseLevel: ema });

  if (ema > threshold) {
    if (noiseStartTime === null) {
      noiseStartTime = now;
    } else if (now - noiseStartTime >= NOISE_HOLD_MS) {
      // Noise sustained above threshold for required duration
      if (now > cooldownUntil) {
        triggerNoiseAlert();
        cooldownUntil = now + COOLDOWN_MS;
        noiseStartTime = null;
      }
    }
  } else {
    noiseStartTime = null;
    if (state.noiseDetected && now > cooldownUntil) {
      setState({ noiseDetected: false });
    }
  }
}

function triggerNoiseAlert(): void {
  console.log('[Audio] Noise detected! Sending alert...');
  setState({ noiseDetected: true });
  send({ type: 'noise-detected' });
}

export function getMediaStream(): MediaStream | null {
  return mediaStream;
}

export function setThreshold(value: number): void {
  setState({ noiseThreshold: value });
}
