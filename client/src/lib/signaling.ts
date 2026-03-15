import { setState } from './state.js';

type MessageHandler = (msg: Record<string, unknown>) => void;

let ws: WebSocket | null = null;
let wsId = 0; // monotonic ID to detect stale close events
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let messageHandlers: Set<MessageHandler> = new Set();
let autoReconnect = true;

function getServerUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = import.meta.env.DEV ? 'localhost:3000' : location.host;
  return `${protocol}//${host}/ws`;
}

export function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  autoReconnect = true;
  const url = getServerUrl();
  console.log('[WS] Connecting to', url);

  const currentId = ++wsId;
  const socket = new WebSocket(url);
  ws = socket;

  socket.onopen = () => {
    // Ignore if this socket was superseded
    if (wsId !== currentId) return;

    console.log('[WS] Connected');
    setState({ connected: true, error: null });

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  socket.onmessage = (event) => {
    if (wsId !== currentId) return;

    try {
      const msg = JSON.parse(event.data as string) as Record<string, unknown>;
      for (const handler of messageHandlers) {
        handler(msg);
      }
    } catch {
      console.error('[WS] Failed to parse message');
    }
  };

  socket.onclose = () => {
    // Ignore close events from old/superseded sockets
    if (wsId !== currentId) return;

    console.log('[WS] Disconnected');
    setState({ connected: false });
    ws = null;
    if (autoReconnect) {
      scheduleReconnect();
    }
  };

  socket.onerror = (err) => {
    if (wsId !== currentId) return;
    console.error('[WS] Error:', err);
    setState({ error: 'Verbindung zum Server fehlgeschlagen' });
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.log('[WS] Attempting reconnect...');
    connect();
  }, 3000);
}

export function disconnect(): void {
  autoReconnect = false;
  wsId++; // invalidate any pending socket events
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  setState({ connected: false });
}

export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function send(data: Record<string, unknown>): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[WS] Cannot send, not connected');
    return;
  }
  ws.send(JSON.stringify(data));
}

export function onMessage(handler: MessageHandler): () => void {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

export function createRoom(localIp?: string): void {
  send({ type: 'create-room', localIp });
}

export function joinRoom(code: string, role: 'baby' | 'parent', localIp?: string): void {
  send({ type: 'join-room', code, role, localIp });
}

// Try to detect local IP via WebRTC (best effort, may not work everywhere)
export async function getLocalIp(): Promise<string | undefined> {
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pc.close();
        resolve(undefined);
      }, 2000);

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const match = event.candidate.candidate.match(
          /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/,
        );
        if (match && !match[1].startsWith('0.')) {
          clearTimeout(timeout);
          pc.close();
          resolve(match[1]);
        }
      };
    });
  } catch {
    return undefined;
  }
}
