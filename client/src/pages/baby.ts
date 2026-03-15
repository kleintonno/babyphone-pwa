import { getState, setState, subscribe } from '../lib/state.js';
import { startMonitoring, stopMonitoring, setThreshold } from '../lib/audio-monitor.js';
import { initWebRTC, startStream } from '../lib/webrtc.js';
import { onMessage } from '../lib/signaling.js';

let unsubscribeState: (() => void) | null = null;
let unsubscribeMsg: (() => void) | null = null;
let unsubscribeWebRTC: (() => void) | null = null;
let wakeLock: WakeLockSentinel | null = null;
let animationFrame: number | null = null;

export function renderBaby(container: HTMLElement): void {
  const state = getState();

  container.innerHTML = `
    <div class="page baby-page">
      <div class="status-bar">
        <div class="status-indicator ${state.paired ? 'connected' : 'disconnected'}">
          <span class="dot"></span>
          <span>${state.paired ? 'Verbunden' : 'Nicht verbunden'}</span>
        </div>
        <span class="room-code">Code: ${state.roomCode || '---'}</span>
      </div>

      <div class="monitor-display">
        <div class="level-meter">
          <div class="level-bar" id="level-bar"></div>
          <div class="threshold-line" id="threshold-line"></div>
        </div>

        <div class="noise-status" id="noise-status">
          <div class="noise-icon idle">
            <svg viewBox="0 0 64 64" width="64" height="64">
              <circle cx="32" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="2.5"/>
              <circle cx="26" cy="22" r="2" fill="currentColor"/>
              <circle cx="38" cy="22" r="2" fill="currentColor"/>
              <path d="M27 29 Q32 33 37 29" fill="none" stroke="currentColor" stroke-width="2"/>
              <path d="M16 40 Q32 56 48 40" fill="none" stroke="currentColor" stroke-width="2.5"/>
            </svg>
          </div>
          <p class="noise-label">Baby schlaeft</p>
        </div>
      </div>

      <div class="controls">
        <div class="threshold-control">
          <label for="threshold-slider">Empfindlichkeit</label>
          <input
            type="range"
            id="threshold-slider"
            min="0.02"
            max="0.5"
            step="0.01"
            value="${state.noiseThreshold}"
          />
          <div class="threshold-labels">
            <span>Hoch</span>
            <span>Niedrig</span>
          </div>
        </div>

        <button class="btn primary large" id="btn-monitor">
          ${state.monitoring ? 'Ueberwachung stoppen' : 'Ueberwachung starten'}
        </button>

        <button class="btn secondary" id="btn-disconnect">Trennen</button>
      </div>
    </div>
  `;

  setupEventListeners();
  setupStateSubscription();
  setupMessageHandler();
  requestWakeLock();

  // Set initial threshold line position
  updateThresholdLine(state.noiseThreshold);
}

function setupEventListeners(): void {
  const monitorBtn = document.getElementById('btn-monitor')!;
  const thresholdSlider = document.getElementById('threshold-slider') as HTMLInputElement;
  const disconnectBtn = document.getElementById('btn-disconnect')!;

  monitorBtn.addEventListener('click', async () => {
    const state = getState();
    if (state.monitoring) {
      stopMonitoring();
    } else {
      await startMonitoring();

      // Once monitoring started, set up WebRTC if peer is connected
      if (state.paired && !unsubscribeWebRTC) {
        unsubscribeWebRTC = initWebRTC();
      }
    }
    updateMonitorButton();
  });

  thresholdSlider.addEventListener('input', () => {
    const value = parseFloat(thresholdSlider.value);
    setThreshold(value);
    updateThresholdLine(value);
  });

  disconnectBtn.addEventListener('click', () => {
    cleanup();
    stopMonitoring();
    setState({ page: 'home', role: null, roomCode: null, paired: false });
  });
}

function setupStateSubscription(): void {
  unsubscribeState = subscribe((state) => {
    updateLevelMeter(state.noiseLevel, state.noiseThreshold);
    updateNoiseStatus(state.noiseDetected);
    updateConnectionStatus(state.paired);
  });

  // Start animation loop for smooth level meter updates
  startAnimationLoop();
}

function setupMessageHandler(): void {
  unsubscribeMsg = onMessage((msg) => {
    if (msg.type === 'peer-joined') {
      setState({ paired: true });
      // Auto-start stream when parent joins and we're monitoring
      const state = getState();
      if (state.monitoring && msg.peerId) {
        startStream(msg.peerId as string);
      }
    }
    if (msg.type === 'peer-disconnected') {
      setState({ paired: false, peerConnected: false });
    }
  });
}

function startAnimationLoop(): void {
  function update(): void {
    const state = getState();
    const levelBar = document.getElementById('level-bar');
    if (levelBar) {
      const percent = Math.min(state.noiseLevel / 0.5, 1) * 100;
      levelBar.style.height = `${percent}%`;

      // Color based on threshold
      if (state.noiseLevel > state.noiseThreshold) {
        levelBar.classList.add('above-threshold');
      } else {
        levelBar.classList.remove('above-threshold');
      }
    }
    animationFrame = requestAnimationFrame(update);
  }
  animationFrame = requestAnimationFrame(update);
}

function updateLevelMeter(_level: number, _threshold: number): void {
  // Handled by animation loop for smoothness
}

function updateThresholdLine(threshold: number): void {
  const line = document.getElementById('threshold-line');
  if (line) {
    const percent = Math.min(threshold / 0.5, 1) * 100;
    line.style.bottom = `${percent}%`;
  }
}

function updateNoiseStatus(detected: boolean): void {
  const statusEl = document.getElementById('noise-status');
  if (!statusEl) return;

  const icon = statusEl.querySelector('.noise-icon');
  const label = statusEl.querySelector('.noise-label');
  if (!icon || !label) return;

  if (detected) {
    icon.className = 'noise-icon alert';
    label.textContent = 'Baby ist wach!';
    statusEl.classList.add('alert');
  } else {
    icon.className = 'noise-icon idle';
    label.textContent = 'Baby schlaeft';
    statusEl.classList.remove('alert');
  }
}

function updateConnectionStatus(paired: boolean): void {
  const indicator = document.querySelector('.status-indicator');
  if (indicator) {
    indicator.className = `status-indicator ${paired ? 'connected' : 'disconnected'}`;
    const span = indicator.querySelector('span:last-child');
    if (span) {
      span.textContent = paired ? 'Verbunden' : 'Nicht verbunden';
    }
  }
}

function updateMonitorButton(): void {
  const btn = document.getElementById('btn-monitor');
  if (btn) {
    const state = getState();
    btn.textContent = state.monitoring ? 'Ueberwachung stoppen' : 'Ueberwachung starten';
  }
}

async function requestWakeLock(): Promise<void> {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      setState({ wakeLockActive: true });
      console.log('[WakeLock] Active');

      wakeLock.addEventListener('release', () => {
        setState({ wakeLockActive: false });
        console.log('[WakeLock] Released');
      });
    } catch (err) {
      console.warn('[WakeLock] Failed:', err);
    }
  }
}

function cleanup(): void {
  if (unsubscribeState) {
    unsubscribeState();
    unsubscribeState = null;
  }
  if (unsubscribeMsg) {
    unsubscribeMsg();
    unsubscribeMsg = null;
  }
  if (unsubscribeWebRTC) {
    unsubscribeWebRTC();
    unsubscribeWebRTC = null;
  }
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}
