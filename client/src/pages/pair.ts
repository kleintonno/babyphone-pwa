import { getState, setState } from '../lib/state.js';
import { connect, createRoom, joinRoom, onMessage, getLocalIp, send } from '../lib/signaling.js';
import { subscribePush } from '../lib/push.js';
import { initWebRTC } from '../lib/webrtc.js';

let cleanupSignaling: (() => void) | null = null;
let cleanupWebRTC: (() => void) | null = null;

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
        <h2>${isBaby ? 'Baby-Geraet einrichten' : 'Mit Baby verbinden'}</h2>

        ${isBaby ? `
          <p class="pair-instructions">Verbinde zum Server und erhalte einen Pairing-Code.</p>
          <div class="pair-code-display" id="code-display">
            <div class="connecting-indicator">
              <div class="spinner"></div>
              <span>Verbinde...</span>
            </div>
          </div>
        ` : `
          <p class="pair-instructions">Gib den 6-stelligen Code vom Baby-Geraet ein.</p>
          <div class="pair-code-input">
            <input
              type="text"
              id="code-input"
              maxlength="6"
              pattern="[0-9]*"
              inputmode="numeric"
              placeholder="000000"
              autocomplete="off"
            />
            <button class="btn primary" id="btn-join" disabled>Verbinden</button>
          </div>
        `}

        <div class="pair-status" id="pair-status"></div>
      </div>
    </div>
  `;

  // Back button
  document.getElementById('btn-back')!.addEventListener('click', () => {
    cleanup();
    setState({ page: 'home', role: null, roomCode: null });
  });

  // Connect and set up signaling
  connect();
  setupSignaling(isBaby);

  if (!isBaby) {
    setupCodeInput();
  }
}

function setupSignaling(isBaby: boolean): void {
  cleanupSignaling = onMessage(async (msg) => {
    const statusEl = document.getElementById('pair-status');

    switch (msg.type) {
      case 'room-created': {
        const code = msg.code as string;
        const memberId = msg.memberId as string;
        setState({ roomCode: code, memberId });

        const display = document.getElementById('code-display');
        if (display) {
          display.innerHTML = `
            <div class="code-digits">
              ${code.split('').map((d) => `<span class="digit">${d}</span>`).join('')}
            </div>
            <p class="code-hint">Gib diesen Code auf dem Eltern-Geraet ein</p>
          `;
        }
        break;
      }

      case 'room-joined': {
        const memberId = msg.memberId as string;
        const code = msg.code as string;
        setState({ memberId, roomCode: code, paired: true });

        if (statusEl) {
          statusEl.innerHTML = '<span class="status-success">Verbunden!</span>';
        }

        // Parent: subscribe to push notifications
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

        // Initialize WebRTC
        if (!cleanupWebRTC) {
          cleanupWebRTC = initWebRTC();
        }

        // Navigate to role-specific page after short delay
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

  // Wait for connection, then create/join room
  const checkConnection = setInterval(async () => {
    const state = getState();
    if (state.connected) {
      clearInterval(checkConnection);
      if (isBaby) {
        const localIp = await getLocalIp();
        createRoom(localIp);
      }
    }
  }, 200);
}

function setupCodeInput(): void {
  const input = document.getElementById('code-input') as HTMLInputElement;
  const joinBtn = document.getElementById('btn-join') as HTMLButtonElement;

  input.addEventListener('input', () => {
    // Only allow digits
    input.value = input.value.replace(/\D/g, '');
    joinBtn.disabled = input.value.length !== 6;
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.length === 6) {
      doJoin(input.value);
    }
  });

  joinBtn.addEventListener('click', () => {
    if (input.value.length === 6) {
      doJoin(input.value);
    }
  });

  // Auto-focus
  setTimeout(() => input.focus(), 100);
}

async function doJoin(code: string): Promise<void> {
  const statusEl = document.getElementById('pair-status');
  if (statusEl) {
    statusEl.innerHTML = '<span class="status-connecting"><div class="spinner"></div> Verbinde...</span>';
  }

  const localIp = await getLocalIp();
  joinRoom(code, 'parent', localIp);
}

function cleanup(): void {
  if (cleanupSignaling) {
    cleanupSignaling();
    cleanupSignaling = null;
  }
  if (cleanupWebRTC) {
    cleanupWebRTC();
    cleanupWebRTC = null;
  }
}
