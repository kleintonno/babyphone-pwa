import QRCode from 'qrcode';
import { getState, setState } from '../lib/state.js';
import { connect, disconnect, createRoom, joinRoom, onMessage, getLocalIp, send, isConnected } from '../lib/signaling.js';
import { subscribePush } from '../lib/push.js';
import { initWebRTC } from '../lib/webrtc.js';
import {
  createBabyOffer,
  handleScannedOffer,
  handleScannedAnswer,
  startQRScanner,
  setNoiseAlertHandler,
  closeLanConnection,
} from '../lib/lan-pairing.js';

let cleanupSignaling: (() => void) | null = null;
let cleanupWebRTC: (() => void) | null = null;
let cleanupScanner: (() => void) | null = null;
let serverTimeout: ReturnType<typeof setTimeout> | null = null;
let connectionCheckInterval: ReturnType<typeof setInterval> | null = null;
let isLanMode = false;

const SERVER_TIMEOUT_MS = 5000;

function log(...args: unknown[]): void {
  console.log('[Pair]', ...args);
}

export function renderPair(container: HTMLElement): void {
  const state = getState();
  const isBaby = state.role === 'baby';

  log('renderPair, role:', state.role);

  container.innerHTML = `
    <div class="page pair-page">
      <button class="back-btn" id="btn-back">
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      <div class="pair-content">
        <h2 id="pair-title">${isBaby ? 'Baby-Geraet einrichten' : 'Mit Baby verbinden'}</h2>
        <p class="pair-instructions" id="pair-instructions">Verbinde zum Server...</p>

        <div class="pair-main" id="pair-main">
          <div class="connecting-indicator">
            <div class="spinner"></div>
            <span>Verbinde zum Server...</span>
          </div>
        </div>

        <div class="pair-status" id="pair-status"></div>

        <div class="pair-footer" id="pair-footer">
          <button class="btn secondary" id="btn-lan-fallback">LAN-Modus (ohne Server)</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-back')!.addEventListener('click', () => {
    cleanup();
    setState({ page: 'home', role: null, roomCode: null });
  });

  document.getElementById('btn-lan-fallback')!.addEventListener('click', () => {
    log('LAN mode button clicked');
    if (connectionCheckInterval) clearInterval(connectionCheckInterval);
    connectionCheckInterval = null;
    if (serverTimeout) clearTimeout(serverTimeout);
    serverTimeout = null;
    isLanMode = true;
    if (isBaby) {
      showLanBabyUI();
    } else {
      showLanParentUI();
    }
  });

  // Try server first, fallback to LAN
  tryServerMode(isBaby);
}

// ============ SERVER MODE ============

function tryServerMode(isBaby: boolean): void {
  log('tryServerMode, isBaby:', isBaby);

  // Clean up any previous connection cleanly
  disconnect();

  // Set up message handler BEFORE connecting so we don't miss any messages
  setupSignaling(isBaby);

  // Now connect
  connect();

  // Timeout: if server doesn't connect in time, show error
  serverTimeout = setTimeout(() => {
    if (!getState().connected) {
      log('Server timeout — not connected after', SERVER_TIMEOUT_MS, 'ms');
      const instructions = document.getElementById('pair-instructions');
      const main = document.getElementById('pair-main');
      if (instructions) instructions.textContent = 'Server nicht erreichbar.';
      if (main) {
        main.innerHTML = `
          <div class="connecting-indicator">
            <span class="status-error">Server nicht erreichbar. Nutze den LAN-Modus oder versuche es erneut.</span>
          </div>
          <button class="btn primary" id="btn-retry-server" style="margin-top:16px;">Nochmal versuchen</button>
        `;
        document.getElementById('btn-retry-server')?.addEventListener('click', () => {
          const mainEl = document.getElementById('pair-main');
          const instrEl = document.getElementById('pair-instructions');
          if (mainEl) mainEl.innerHTML = '<div class="connecting-indicator"><div class="spinner"></div><span>Verbinde zum Server...</span></div>';
          if (instrEl) instrEl.textContent = 'Verbinde zum Server...';
          tryServerMode(isBaby);
        });
      }
    }
  }, SERVER_TIMEOUT_MS);

  // Wait for connection, then create/join room
  connectionCheckInterval = setInterval(async () => {
    if (isConnected()) {
      log('WebSocket connected, clearing interval');
      if (connectionCheckInterval) clearInterval(connectionCheckInterval);
      connectionCheckInterval = null;
      if (serverTimeout) clearTimeout(serverTimeout);
      serverTimeout = null;

      if (isBaby) {
        log('Baby: creating room...');
        const localIp = await getLocalIp();
        log('Baby: localIp:', localIp);
        createRoom(localIp);
      } else {
        log('Parent: showing parent UI');
        showServerParentUI();
      }
    }
  }, 200);
}

function setupSignaling(isBaby: boolean): void {
  if (cleanupSignaling) cleanupSignaling();

  cleanupSignaling = onMessage(async (msg) => {
    log('Message received:', msg.type, msg);
    const statusEl = document.getElementById('pair-status');

    switch (msg.type) {
      case 'room-created': {
        const code = msg.code as string;
        const memberId = msg.memberId as string;
        log('Room created:', code, 'memberId:', memberId);
        setState({ roomCode: code, memberId });
        await showServerBabyUI(code);
        break;
      }

      case 'room-joined': {
        const memberId = msg.memberId as string;
        const code = msg.code as string;
        log('Room joined:', code, 'memberId:', memberId);
        setState({ memberId, roomCode: code, paired: true });

        if (statusEl) {
          statusEl.innerHTML = '<span class="status-success">Verbunden! Warte auf Peer...</span>';
        }

        // Subscribe to push notifications (non-blocking)
        if (!isBaby) {
          subscribePush().then((subscription) => {
            if (subscription) {
              log('Push subscribed, sending to server');
              send({ type: 'subscribe-push', subscription: subscription.toJSON() });
            }
          }).catch((err) => {
            log('Push subscription failed:', err);
          });
        }
        break;
      }

      case 'peer-joined': {
        log('Peer joined:', msg.peerId, 'role:', msg.peerRole);
        setState({
          paired: true,
          peerLocalIp: msg.peerLocalIp as string | null,
        });

        if (statusEl) {
          statusEl.innerHTML = `<span class="status-success">${
            msg.peerRole === 'parent' ? 'Eltern-Geraet' : 'Baby-Geraet'
          } verbunden!</span>`;
        }

        if (!cleanupWebRTC) {
          cleanupWebRTC = initWebRTC();
        }

        log('Navigating to', isBaby ? 'baby' : 'parent', 'page in 1.5s...');
        setTimeout(() => {
          const state = getState();
          setState({ page: state.role === 'baby' ? 'baby' : 'parent' });
        }, 1500);
        break;
      }

      case 'error': {
        log('Server error:', msg.message);
        if (statusEl) {
          statusEl.innerHTML = `<span class="status-error">Fehler: ${msg.message as string}</span>`;
        }
        break;
      }

      case 'push-subscribed': {
        log('Push subscription confirmed by server');
        setState({ pushEnabled: true });
        break;
      }
    }
  });
}

async function showServerBabyUI(code: string): Promise<void> {
  const main = document.getElementById('pair-main');
  const instructions = document.getElementById('pair-instructions');
  if (!main || !instructions) return;

  instructions.textContent = 'Scanne diesen QR-Code mit dem Eltern-Geraet oder gib den Code ein.';

  // Generate QR code from room code
  try {
    const qrDataUrl = await QRCode.toDataURL(code, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
      color: {
        dark: '#e8e8e8',
        light: '#1a1a2e',
      },
    });

    main.innerHTML = `
      <div class="qr-display">
        <img src="${qrDataUrl}" alt="Pairing QR Code" class="qr-image" />
      </div>
      <p class="code-hint">Code: <strong>${code}</strong></p>
      <p class="code-hint" style="font-size: 12px; opacity: 0.6;">Warte auf Eltern-Geraet...</p>
    `;
  } catch {
    // Fallback: show code as digits if QR generation fails
    main.innerHTML = `
      <div class="pair-code-display">
        <div class="code-digits">
          ${code.split('').map((d) => `<span class="digit">${d}</span>`).join('')}
        </div>
      </div>
      <p class="code-hint" style="font-size: 12px; opacity: 0.6;">Warte auf Eltern-Geraet...</p>
    `;
  }
}

function showServerParentUI(): void {
  const main = document.getElementById('pair-main');
  const instructions = document.getElementById('pair-instructions');
  if (!main || !instructions) return;

  log('showServerParentUI');
  instructions.textContent = 'Scanne den QR-Code vom Baby-Geraet oder gib den Code manuell ein.';

  main.innerHTML = `
    <div class="qr-scanner">
      <div class="scanner-viewport">
        <video id="scanner-video" playsinline></video>
        <canvas id="scanner-canvas" style="display:none;"></canvas>
        <div class="scanner-overlay">
          <div class="scanner-frame"></div>
        </div>
      </div>
      <p class="scanner-hint">Richte die Kamera auf den QR-Code des Baby-Geraets</p>
    </div>
    <div class="manual-code-toggle">
      <button class="btn secondary" id="btn-manual-code">Code manuell eingeben</button>
    </div>
  `;

  const video = document.getElementById('scanner-video') as HTMLVideoElement;
  const canvas = document.getElementById('scanner-canvas') as HTMLCanvasElement;

  startQRScanner(video, canvas, async (data) => {
    log('QR scanned:', data);
    if (cleanupScanner) {
      cleanupScanner();
      cleanupScanner = null;
    }

    // The scanned data is the 8-char alphanumeric room code
    const code = data.trim().toLowerCase();
    if (/^[a-z0-9]{8}$/.test(code)) {
      await doJoin(code);
    } else {
      log('Invalid QR code data:', data);
      const statusEl = document.getElementById('pair-status');
      if (statusEl) {
        statusEl.innerHTML = '<span class="status-error">Ungueltiger QR-Code. Bitte nochmal versuchen.</span>';
      }
      // Restart scanner
      showServerParentUI();
    }
  }).then((stopScanner) => {
    cleanupScanner = stopScanner;
  }).catch((err) => {
    log('Camera not available, falling back to manual input:', err);
    // Camera not available — fall back to manual input
    showManualCodeInput();
  });

  document.getElementById('btn-manual-code')!.addEventListener('click', () => {
    log('Manual code input clicked');
    if (cleanupScanner) {
      cleanupScanner();
      cleanupScanner = null;
    }
    showManualCodeInput();
  });
}

function showManualCodeInput(): void {
  const main = document.getElementById('pair-main');
  const instructions = document.getElementById('pair-instructions');
  if (!main || !instructions) return;

  log('showManualCodeInput');
  instructions.textContent = 'Gib den 8-stelligen Code vom Baby-Geraet ein.';

  main.innerHTML = `
    <div class="pair-code-input">
      <input
        type="text"
        id="code-input"
        maxlength="8"
        pattern="[a-z0-9]*"
        inputmode="text"
        placeholder="abcd1234"
        autocomplete="off"
      />
      <button class="btn primary" id="btn-join" disabled>Verbinden</button>
    </div>
  `;

  setupCodeInput();
}

function setupCodeInput(): void {
  const input = document.getElementById('code-input') as HTMLInputElement;
  const joinBtn = document.getElementById('btn-join') as HTMLButtonElement;

  input.addEventListener('input', () => {
    input.value = input.value.toLowerCase().replace(/[^a-z0-9]/g, '');
    joinBtn.disabled = input.value.length !== 8;
    log('Code input:', input.value, 'length:', input.value.length, 'btn disabled:', joinBtn.disabled);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.length === 8) {
      log('Enter pressed with code:', input.value);
      doJoin(input.value);
    }
  });

  joinBtn.addEventListener('click', () => {
    log('Join button clicked, code:', input.value, 'length:', input.value.length);
    if (input.value.length === 8) {
      doJoin(input.value);
    }
  });

  setTimeout(() => input.focus(), 100);
}

async function doJoin(code: string): Promise<void> {
  log('doJoin called with code:', code, 'isConnected:', isConnected());
  const statusEl = document.getElementById('pair-status');

  // Ensure WebSocket is connected before trying to join
  if (!isConnected()) {
    log('Not connected, trying to reconnect...');
    if (statusEl) {
      statusEl.innerHTML = '<span class="status-error">Nicht mit Server verbunden. Verbinde...</span>';
    }
    connect();

    // Wait up to 5s for reconnection
    let connected = false;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (isConnected()) {
        connected = true;
        break;
      }
    }

    if (!connected) {
      log('Failed to reconnect');
      if (statusEl) {
        statusEl.innerHTML = '<span class="status-error">Verbindung fehlgeschlagen. Bitte nochmal versuchen.</span>';
      }
      return;
    }
    log('Reconnected successfully');
  }

  if (statusEl) {
    statusEl.innerHTML = '<span class="status-connecting"><div class="spinner"></div> Verbinde...</span>';
  }

  const localIp = await getLocalIp();
  log('Sending join-room, code:', code, 'role: parent, localIp:', localIp);
  joinRoom(code, 'parent', localIp);
}

// ============ LAN MODE ============

async function showLanBabyUI(): Promise<void> {
  const main = document.getElementById('pair-main');
  const instructions = document.getElementById('pair-instructions');
  const title = document.getElementById('pair-title');
  if (!main || !instructions || !title) return;

  title.textContent = 'LAN-Modus: Baby';
  instructions.textContent = 'QR-Code wird generiert...';

  // Hide the LAN button since we're already in LAN mode
  const footer = document.getElementById('pair-footer');
  if (footer) footer.style.display = 'none';

  main.innerHTML = `
    <div class="connecting-indicator">
      <div class="spinner"></div>
      <span>Erstelle Verbindung...</span>
    </div>
  `;

  try {
    const { qrDataUrl } = await createBabyOffer();

    instructions.textContent = 'Scanne diesen QR-Code mit dem Eltern-Geraet.';

    main.innerHTML = `
      <div class="qr-display">
        <img src="${qrDataUrl}" alt="QR Code" class="qr-image" />
      </div>
      <p class="code-hint">Schritt 1 von 2: Warte auf Eltern-Geraet...</p>
      <button class="btn secondary" id="btn-scan-answer" style="display:none;">Antwort-QR scannen</button>
    `;

    const scanBtn = document.getElementById('btn-scan-answer')!;

    setTimeout(() => {
      const hint = main.querySelector('.code-hint');
      if (hint) hint.textContent = 'Schritt 2: Scanne den Antwort-QR vom Eltern-Geraet.';
      scanBtn.style.display = '';
    }, 3000);

    scanBtn.addEventListener('click', () => {
      showLanScannerUI('answer');
    });
  } catch (err) {
    instructions.textContent = 'Fehler beim Erstellen des QR-Codes.';
    console.error('[LAN] Failed to create offer:', err);
  }
}

async function showLanParentUI(): Promise<void> {
  const title = document.getElementById('pair-title');
  const instructions = document.getElementById('pair-instructions');
  if (title) title.textContent = 'LAN-Modus: Eltern';
  if (instructions) instructions.textContent = 'Scanne den QR-Code vom Baby-Geraet.';

  // Hide the LAN button since we're already in LAN mode
  const footer = document.getElementById('pair-footer');
  if (footer) footer.style.display = 'none';

  showLanScannerUI('offer');
}

function showLanScannerUI(expectedType: 'offer' | 'answer'): void {
  const main = document.getElementById('pair-main');
  if (!main) return;

  main.innerHTML = `
    <div class="qr-scanner">
      <div class="scanner-viewport">
        <video id="scanner-video" playsinline></video>
        <canvas id="scanner-canvas" style="display:none;"></canvas>
        <div class="scanner-overlay">
          <div class="scanner-frame"></div>
        </div>
      </div>
      <p class="scanner-hint">${
        expectedType === 'offer'
          ? 'Richte die Kamera auf den QR-Code des Baby-Geraets'
          : 'Richte die Kamera auf den Antwort-QR des Eltern-Geraets'
      }</p>
    </div>
  `;

  const video = document.getElementById('scanner-video') as HTMLVideoElement;
  const canvas = document.getElementById('scanner-canvas') as HTMLCanvasElement;

  startQRScanner(video, canvas, async (data) => {
    if (cleanupScanner) {
      cleanupScanner();
      cleanupScanner = null;
    }

    try {
      if (expectedType === 'offer') {
        const answerQrDataUrl = await handleScannedOffer(data);
        showLanAnswerQR(answerQrDataUrl);
      } else {
        await handleScannedAnswer(data);
        showLanConnected();
      }
    } catch (err) {
      const statusEl = document.getElementById('pair-status');
      if (statusEl) {
        statusEl.innerHTML = '<span class="status-error">QR-Code ungueltig. Bitte nochmal versuchen.</span>';
      }
      console.error('[LAN] QR handling failed:', err);
    }
  }).then((stopScanner) => {
    cleanupScanner = stopScanner;
  });
}

function showLanAnswerQR(qrDataUrl: string): void {
  const main = document.getElementById('pair-main');
  const instructions = document.getElementById('pair-instructions');
  if (!main || !instructions) return;

  instructions.textContent = 'Zeige diesen QR-Code dem Baby-Geraet zum Scannen.';

  main.innerHTML = `
    <div class="qr-display">
      <img src="${qrDataUrl}" alt="Antwort QR Code" class="qr-image" />
    </div>
    <p class="code-hint">Das Baby-Geraet muss diesen Code scannen.</p>
  `;

  setNoiseAlertHandler(() => {
    // Will be handled by parent page
  });

  const checkInterval = setInterval(() => {
    const state = getState();
    if (state.peerConnected) {
      clearInterval(checkInterval);
      showLanConnected();
    }
  }, 500);
}

function showLanConnected(): void {
  const main = document.getElementById('pair-main');
  const instructions = document.getElementById('pair-instructions');
  const statusEl = document.getElementById('pair-status');
  if (!main || !instructions) return;

  instructions.textContent = 'Verbindung hergestellt!';
  main.innerHTML = `
    <div class="connecting-indicator">
      <span class="status-success" style="font-size: 20px;">Direkt verbunden (LAN)</span>
    </div>
  `;
  if (statusEl) {
    statusEl.innerHTML = '<span class="status-success">Kein Server noetig — Peer-to-Peer aktiv</span>';
  }

  setState({ paired: true });

  setTimeout(() => {
    const state = getState();
    setState({ page: state.role === 'baby' ? 'baby' : 'parent' });
  }, 1500);
}

// ============ CLEANUP ============

function cleanup(): void {
  log('cleanup');
  if (cleanupSignaling) {
    cleanupSignaling();
    cleanupSignaling = null;
  }
  if (cleanupWebRTC) {
    cleanupWebRTC();
    cleanupWebRTC = null;
  }
  if (cleanupScanner) {
    cleanupScanner();
    cleanupScanner = null;
  }
  if (serverTimeout) {
    clearTimeout(serverTimeout);
    serverTimeout = null;
  }
  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval);
    connectionCheckInterval = null;
  }
  if (isLanMode) {
    closeLanConnection();
    isLanMode = false;
  }
  disconnect();
}
