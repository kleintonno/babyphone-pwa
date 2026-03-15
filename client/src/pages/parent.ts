import { getState, setState, subscribe } from '../lib/state.js';
import { onMessage } from '../lib/signaling.js';
import { initWebRTC } from '../lib/webrtc.js';
import { setNoiseAlertHandler, getLanPeerConnection } from '../lib/lan-pairing.js';

let unsubscribeState: (() => void) | null = null;
let unsubscribeMsg: (() => void) | null = null;
let unsubscribeWebRTC: (() => void) | null = null;
let alertHistory: { timestamp: string; time: string }[] = [];

export function renderParent(container: HTMLElement): void {
  const state = getState();

  container.innerHTML = `
    <div class="page parent-page">
      <div class="status-bar">
        <div class="status-indicator ${state.paired ? 'connected' : 'disconnected'}">
          <span class="dot"></span>
          <span>${state.paired ? 'Verbunden' : 'Nicht verbunden'}</span>
        </div>
        <span class="room-code">Code: ${state.roomCode || '---'}</span>
      </div>

      <div class="parent-display">
        <div class="parent-status" id="parent-status">
          <div class="parent-icon listening">
            <svg viewBox="0 0 80 80" width="80" height="80">
              <circle cx="40" cy="32" r="20" fill="none" stroke="currentColor" stroke-width="2.5"/>
              <circle cx="33" cy="28" r="2" fill="currentColor"/>
              <circle cx="47" cy="28" r="2" fill="currentColor"/>
              <path d="M35 36 Q40 40 45 36" fill="none" stroke="currentColor" stroke-width="2"/>
              <path d="M20 52 Q40 72 60 52" fill="none" stroke="currentColor" stroke-width="2.5"/>
            </svg>
          </div>
          <h2 class="parent-label" id="parent-label">Alles ruhig</h2>
          <p class="parent-sublabel" id="parent-sublabel">Baby wird ueberwacht</p>
        </div>

        <div class="push-status" id="push-status">
          <span class="push-icon">${state.pushEnabled ? '&#x1f514;' : '&#x1f515;'}</span>
          <span>${state.pushEnabled
            ? 'Push-Benachrichtigungen aktiv'
            : 'Push-Benachrichtigungen nicht aktiviert'
          }</span>
        </div>

        <div class="stream-status" id="stream-status">
          <span>${state.streamActive ? 'Audio-Stream aktiv' : 'Kein Audio-Stream'}</span>
        </div>

        <div class="alert-history" id="alert-history">
          <h3>Verlauf</h3>
          <div class="alert-list" id="alert-list">
            <p class="empty-state">Noch keine Benachrichtigungen</p>
          </div>
        </div>
      </div>

      <div class="controls">
        <button class="btn secondary" id="btn-disconnect">Trennen</button>
      </div>
    </div>
  `;

  setupEventListeners();
  setupStateSubscription();
  setupMessageHandler();

  // Init WebRTC for receiving audio
  // Init WebRTC for receiving audio (server mode)
  // In LAN mode, the connection is already established via DataChannel
  if (!getLanPeerConnection() && !unsubscribeWebRTC) {
    unsubscribeWebRTC = initWebRTC();
  }

  // LAN mode: listen for noise alerts via DataChannel
  setNoiseAlertHandler(() => {
    handleNoiseAlert(new Date().toISOString());
  });
}

function setupEventListeners(): void {
  document.getElementById('btn-disconnect')!.addEventListener('click', () => {
    cleanup();
    setState({ page: 'home', role: null, roomCode: null, paired: false });
  });
}

function setupStateSubscription(): void {
  unsubscribeState = subscribe((state) => {
    updateConnectionStatus(state.paired);
    updateStreamStatus(state.streamActive);
    updatePushStatus(state.pushEnabled);
  });
}

function setupMessageHandler(): void {
  unsubscribeMsg = onMessage((msg) => {
    switch (msg.type) {
      case 'noise-alert':
        handleNoiseAlert(msg.timestamp as string);
        break;
      case 'peer-joined':
        setState({ paired: true });
        break;
      case 'peer-disconnected':
        setState({ paired: false, peerConnected: false, streamActive: false });
        updateParentStatus(false);
        break;
    }
  });
}

function handleNoiseAlert(timestamp: string): void {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  alertHistory.unshift({ timestamp, time });

  // Keep only last 20 alerts
  if (alertHistory.length > 20) {
    alertHistory = alertHistory.slice(0, 20);
  }

  updateParentStatus(true);
  updateAlertHistory();

  // Vibrate if supported
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }

  // Reset status after 30 seconds
  setTimeout(() => {
    updateParentStatus(false);
  }, 30_000);
}

function updateParentStatus(alert: boolean): void {
  const icon = document.querySelector('.parent-icon');
  const label = document.getElementById('parent-label');
  const sublabel = document.getElementById('parent-sublabel');
  const statusContainer = document.getElementById('parent-status');

  if (!icon || !label || !sublabel || !statusContainer) return;

  if (alert) {
    statusContainer.classList.add('alert');
    label.textContent = 'Baby ist wach!';
    sublabel.textContent = 'Geraeusch erkannt';
  } else {
    statusContainer.classList.remove('alert');
    label.textContent = 'Alles ruhig';
    sublabel.textContent = 'Baby wird ueberwacht';
  }
}

function updateAlertHistory(): void {
  const list = document.getElementById('alert-list');
  if (!list) return;

  if (alertHistory.length === 0) {
    list.innerHTML = '<p class="empty-state">Noch keine Benachrichtigungen</p>';
    return;
  }

  list.innerHTML = alertHistory
    .map(
      (alert) => `
      <div class="alert-item">
        <span class="alert-time">${alert.time}</span>
        <span class="alert-text">Geraeusch erkannt</span>
      </div>
    `,
    )
    .join('');
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

function updateStreamStatus(active: boolean): void {
  const el = document.getElementById('stream-status');
  if (el) {
    const span = el.querySelector('span');
    if (span) {
      span.textContent = active ? 'Audio-Stream aktiv' : 'Kein Audio-Stream';
    }
  }
}

function updatePushStatus(enabled: boolean): void {
  const el = document.getElementById('push-status');
  if (el) {
    el.innerHTML = `
      <span class="push-icon">${enabled ? '&#x1f514;' : '&#x1f515;'}</span>
      <span>${enabled
        ? 'Push-Benachrichtigungen aktiv'
        : 'Push-Benachrichtigungen nicht aktiviert'
      }</span>
    `;
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
  alertHistory = [];
}
