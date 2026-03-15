import QRCode from 'qrcode';
import { getState, setState } from '../lib/state.js';
import { connect, disconnect, createRoom, joinRoom, onMessage, onReconnect, getLocalIp, send, isConnected } from '../lib/signaling.js';
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
let cleanupReconnect: (() => void) | null = null;
let cleanupWebRTC: (() => void) | null = null;
let cleanupScanner: (() => void) | null = null;
let serverTimeout: ReturnType<typeof setTimeout> | null = null;
let connectionCheckInterval: ReturnType<typeof setInterval> | null = null;
let isLanMode = false;

const SERVER_TIMEOUT_MS = 5000;

export function renderPair(container: HTMLElement): void {
  const state = getState();
  const isBaby = state.role === 'baby';

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
      </div>
    </div>
  `;

  document.getElementById('btn-back')!.addEventListener('click', () => {
    cleanup();
    setState({ page: 'home', role: null, roomCode: null });
  });

  // Try server first, fallback to LAN
  tryServerMode(isBaby);
}

// ============ SERVER MODE ============

function tryServerMode(isBaby: boolean): void {
  // Clean up any stale connection first
  disconnect();

  connect();

  // Timeout: if server doesn't connect in time, offer LAN mode
  serverTimeout = setTimeout(() => {
    if (!getState().connected) {
      showModePicker(isBaby);
    }
  }, SERVER_TIMEOUT_MS);

  setupSignaling(isBaby);

  // Register reconnect handler so rooms are re-created after a WS reconnect
  if (cleanupReconnect) cleanupReconnect();
  cleanupReconnect = onReconnect(async () => {
    // Only re-create/re-join if we're still on the pair page and not in LAN mode
    const state = getState();
    if (state.page !== 'pair' || isLanMode) return;

    console.log('[Pair] WebSocket reconnected, re-creating room...');
    if (isBaby) {
      const localIp = await getLocalIp();
      createRoom(localIp);
    }
    // For parent, they need to re-enter/re-scan the code, so we don't auto-rejoin
  });

  // Wait for connection
  connectionCheckInterval = setInterval(async () => {
    const state = getState();
    if (state.connected) {
      if (connectionCheckInterval) clearInterval(connectionCheckInterval);
      connectionCheckInterval = null;
      if (serverTimeout) clearTimeout(serverTimeout);
      serverTimeout = null;

      if (isBaby) {
        const localIp = await getLocalIp();
        createRoom(localIp);
      } else {
        showServerParentUI();
      }
    }
  }, 200);
}

function showModePicker(isBaby: boolean): void {
  if (connectionCheckInterval) clearInterval(connectionCheckInterval);
  connectionCheckInterval = null;

  const main = document.getElementById('pair-main');
  const instructions = document.getElementById('pair-instructions');
  if (!main || !instructions) return;

  instructions.textContent = 'Server nicht erreichbar. Wie moechtest du verbinden?';

  main.innerHTML = `
    <div class="mode-picker">
      <button class="role-btn" id="btn-retry-server">
        <div class="role-icon">
          <svg viewBox="0 0 24 24" width="32" height="32">
            <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <span class="role-title">Nochmal versuchen</span>
        <span class="role-desc">Server-Verbindung erneut pruefen</span>
      </button>
      <button class="role-btn" id="btn-lan-mode">
        <div class="role-icon">
          <svg viewBox="0 0 24 24" width="32" height="32">
            <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M7 7h3v3H7zM14 7h3v3h-3zM7 14h3v3H7zM14 14h3v3h-3z" fill="currentColor"/>
          </svg>
        </div>
        <span class="role-title">LAN-Modus</span>
        <span class="role-desc">Direkt per QR-Code verbinden (kein Server noetig)</span>
      </button>
    </div>
  `;

  document.getElementById('btn-retry-server')!.addEventListener('click', () => {
    main.innerHTML = `
      <div class="connecting-indicator">
        <div class="spinner"></div>
        <span>Verbinde zum Server...</span>
      </div>
    `;
    instructions.textContent = 'Verbinde zum Server...';
    tryServerMode(isBaby);
  });

  document.getElementById('btn-lan-mode')!.addEventListener('click', () => {
    isLanMode = true;
    if (isBaby) {
      showLanBabyUI();
    } else {
      showLanParentUI();
    }
  });
}

function setupSignaling(isBaby: boolean): void {
  if (cleanupSignaling) cleanupSignaling();

  cleanupSignaling = onMessage(async (msg) => {
    const statusEl = document.getElementById('pair-status');

    switch (msg.type) {
      case 'room-created': {
        const code = msg.code as string;
        const memberId = msg.memberId as string;
        setState({ roomCode: code, memberId });
        await showServerBabyUI(code);
        break;
      }

      case 'room-joined': {
        const memberId = msg.memberId as string;
        const code = msg.code as string;
        setState({ memberId, roomCode: code, paired: true });

        if (statusEl) {
          statusEl.innerHTML = '<span class="status-success">Verbunden!</span>';
        }

        if (!isBaby) {
          const subscription = await subscribePush();
          if (subscription) {
            send({ type: 'subscribe-push', subscription: subscription.toJSON() });
          }
        }
        break;
      }

      case 'peer-joined': {
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

        setTimeout(() => {
          const state = getState();
          setState({ page: state.role === 'baby' ? 'baby' : 'parent' });
        }, 1500);
        break;
      }

      case 'error': {
        if (statusEl) {
          statusEl.innerHTML = `<span class="status-error">${msg.message as string}</span>`;
        }
        break;
      }

      case 'push-subscribed': {
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

  instructions.textContent = 'Scanne diesen QR-Code mit dem Eltern-Geraet.';

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
      <p class="code-hint">Code: ${code}</p>
    `;
  } catch {
    // Fallback: show code as digits if QR generation fails
    main.innerHTML = `
      <div class="pair-code-display">
        <div class="code-digits">
          ${code.split('').map((d) => `<span class="digit">${d}</span>`).join('')}
        </div>
      </div>
    `;
  }
}

function showServerParentUI(): void {
  const main = document.getElementById('pair-main');
  const instructions = document.getElementById('pair-instructions');
  if (!main || !instructions) return;

  instructions.textContent = 'Scanne den QR-Code vom Baby-Geraet.';

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
    if (cleanupScanner) {
      cleanupScanner();
      cleanupScanner = null;
    }

    // The scanned data is the 8-char alphanumeric room code
    const code = data.trim().toLowerCase();
    if (/^[a-z0-9]{8}$/.test(code)) {
      await doJoin(code);
    } else {
      const statusEl = document.getElementById('pair-status');
      if (statusEl) {
        statusEl.innerHTML = '<span class="status-error">Ungueltiger QR-Code. Bitte nochmal versuchen.</span>';
      }
      // Restart scanner
      showServerParentUI();
    }
  }).then((stopScanner) => {
    cleanupScanner = stopScanner;
  }).catch(() => {
    // Camera not available — fall back to manual input
    showManualCodeInput();
  });

  document.getElementById('btn-manual-code')!.addEventListener('click', () => {
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
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.length === 8) {
      doJoin(input.value);
    }
  });

  joinBtn.addEventListener('click', () => {
    if (input.value.length === 8) {
      doJoin(input.value);
    }
  });

  setTimeout(() => input.focus(), 100);
}

async function doJoin(code: string): Promise<void> {
  const statusEl = document.getElementById('pair-status');

  // Ensure WebSocket is connected before trying to join
  if (!isConnected()) {
    if (statusEl) {
      statusEl.innerHTML = '<span class="status-error">Nicht mit Server verbunden. Bitte warten...</span>';
    }
    // Try to reconnect and retry
    connect();
    const retryTimeout = setTimeout(() => {
      if (statusEl) {
        statusEl.innerHTML = '<span class="status-error">Verbindung fehlgeschlagen. Bitte nochmal versuchen.</span>';
      }
    }, 5000);

    const checkConnected = setInterval(async () => {
      if (isConnected()) {
        clearInterval(checkConnected);
        clearTimeout(retryTimeout);
        const localIp = await getLocalIp();
        joinRoom(code, 'parent', localIp);
        if (statusEl) {
          statusEl.innerHTML = '<span class="status-connecting"><div class="spinner"></div> Verbinde...</span>';
        }
      }
    }, 200);
    return;
  }

  if (statusEl) {
    statusEl.innerHTML = '<span class="status-connecting"><div class="spinner"></div> Verbinde...</span>';
  }
  const localIp = await getLocalIp();
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

    // After parent scans our QR, they show an answer QR.
    // Baby needs to scan that answer QR to complete the handshake.
    // Show the "scan answer" button for baby to proceed
    const scanBtn = document.getElementById('btn-scan-answer')!;

    // Show scan button after a moment (parent needs time to scan + generate answer)
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
        // Parent scanned baby's offer → generate answer QR
        const answerQrDataUrl = await handleScannedOffer(data);
        showLanAnswerQR(answerQrDataUrl);
      } else {
        // Baby scanned parent's answer → connection complete
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

  // Set up noise alert handler for LAN mode
  setNoiseAlertHandler(() => {
    // Will be handled by parent page
  });

  // Wait for DataChannel to open (connection complete)
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
  if (cleanupSignaling) {
    cleanupSignaling();
    cleanupSignaling = null;
  }
  if (cleanupReconnect) {
    cleanupReconnect();
    cleanupReconnect = null;
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
  // Stop auto-reconnect when leaving pairing page
  disconnect();
}
