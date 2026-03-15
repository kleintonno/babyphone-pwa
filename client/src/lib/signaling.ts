import { setState } from './state.js';

type MessageHandler = (msg: Record<string, unknown>) => void;
type ReconnectHandler = () => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let messageHandlers: Set<MessageHandler> = new Set();
let reconnectHandlers: Set<ReconnectHandler> = new Set();
let autoReconnect = true;

function getServerUrl(): string {
  // In production, connect to same host
  // In development, connect to local server
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

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[WS] Connected');
    setState({ connected: true, error: null });

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Notify reconnect handlers (they can re-create/re-join rooms)
    for (const handler of reconnectHandlers) {
      handler();
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as Record<string, unknown>;
      for (const handler of messageHandlers) {
        handler(msg);
      }
    } catch {
      console.error('[WS] Failed to parse message');
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected');
    setState({ connected: false });
    ws = null;
    if (autoReconnect) {
      scheduleReconnect();
    }
  };

  ws.onerror = (err) => {
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

/**
 * Register a handler that is called after every successful (re)connection.
 * Returns a cleanup function.
 */
export function onReconnect(handler: ReconnectHandler): () => void {
  reconnectHandlers.add(handler);
  return () => reconnectHandlers.delete(handler);
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
