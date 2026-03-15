import type { WebSocket } from 'ws';
import {
  createRoom,
  getRoom,
  addMember,
  removeMember,
  getMemberByWs,
  getPeerMembers,
  getParentMembers,
} from './rooms.js';
import { sendPushNotification, getPublicVapidKey } from './push.js';
import type { PushSubscription } from 'web-push';

interface SignalingMessage {
  type: string;
  [key: string]: unknown;
}

function send(ws: WebSocket, data: SignalingMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Rate limiting for join attempts
const JOIN_MAX_ATTEMPTS = 5;
const JOIN_WINDOW_MS = 60_000; // 1 minute

interface RateLimitEntry {
  attempts: number;
  windowStart: number;
}

const joinAttempts = new WeakMap<WebSocket, RateLimitEntry>();

function checkJoinRateLimit(ws: WebSocket): boolean {
  const now = Date.now();
  let entry = joinAttempts.get(ws);

  if (!entry || now - entry.windowStart > JOIN_WINDOW_MS) {
    entry = { attempts: 0, windowStart: now };
    joinAttempts.set(ws, entry);
  }

  entry.attempts++;
  return entry.attempts <= JOIN_MAX_ATTEMPTS;
}

export function handleConnection(ws: WebSocket): void {
  ws.on('message', (raw) => {
    let msg: SignalingMessage;
    try {
      msg = JSON.parse(raw.toString()) as SignalingMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'create-room':
        handleCreateRoom(ws, msg);
        break;
      case 'join-room':
        handleJoinRoom(ws, msg);
        break;
      case 'subscribe-push':
        handleSubscribePush(ws, msg);
        break;
      case 'noise-detected':
        handleNoiseDetected(ws);
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        handleWebRTCSignaling(ws, msg);
        break;
      case 'get-vapid-key':
        send(ws, { type: 'vapid-key', key: getPublicVapidKey() });
        break;
      default:
        send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });
}

function handleCreateRoom(ws: WebSocket, msg: SignalingMessage): void {
  const room = createRoom();
  const member = addMember(room, 'baby', ws, msg.localIp as string | undefined);

  send(ws, {
    type: 'room-created',
    code: room.code,
    memberId: member.id,
  });

  console.log(`[Signaling] Room ${room.code} created by baby ${member.id}`);
}

function handleJoinRoom(ws: WebSocket, msg: SignalingMessage): void {
  if (!checkJoinRateLimit(ws)) {
    send(ws, { type: 'error', message: 'Zu viele Versuche. Bitte warte eine Minute.' });
    return;
  }

  const code = msg.code as string;
  if (!code) {
    send(ws, { type: 'error', message: 'Missing room code' });
    return;
  }

  const room = getRoom(code);
  if (!room) {
    send(ws, { type: 'error', message: 'Room not found' });
    return;
  }

  const role = (msg.role as 'baby' | 'parent') || 'parent';
  const member = addMember(room, role, ws, msg.localIp as string | undefined);

  send(ws, {
    type: 'room-joined',
    code: room.code,
    memberId: member.id,
    role: member.role,
  });

  // Notify existing members
  const peers = getPeerMembers(room, member.id);
  for (const peer of peers) {
    send(peer.ws, {
      type: 'peer-joined',
      peerId: member.id,
      peerRole: member.role,
      peerLocalIp: member.localIp,
    });
  }

  // Notify the joiner about existing peers
  for (const peer of peers) {
    send(ws, {
      type: 'peer-joined',
      peerId: peer.id,
      peerRole: peer.role,
      peerLocalIp: peer.localIp,
    });
  }

  console.log(`[Signaling] ${role} ${member.id} joined room ${code}`);
}

function handleSubscribePush(ws: WebSocket, msg: SignalingMessage): void {
  const found = getMemberByWs(ws);
  if (!found) {
    send(ws, { type: 'error', message: 'Not in a room' });
    return;
  }

  const subscription = msg.subscription as PushSubscription;
  if (!subscription) {
    send(ws, { type: 'error', message: 'Missing push subscription' });
    return;
  }

  found.member.pushSubscription = subscription;
  send(ws, { type: 'push-subscribed' });
  console.log(`[Push] Subscription registered for member ${found.member.id}`);
}

async function handleNoiseDetected(ws: WebSocket): Promise<void> {
  const found = getMemberByWs(ws);
  if (!found) return;

  const { room } = found;
  const parents = getParentMembers(room);

  const now = new Date();
  const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  // Send push notifications to all parent devices
  for (const parent of parents) {
    // WebSocket notification (for when the app is open)
    send(parent.ws, {
      type: 'noise-alert',
      timestamp: now.toISOString(),
    });

    // Push notification (for when the app is in background)
    if (parent.pushSubscription) {
      const success = await sendPushNotification(parent.pushSubscription, {
        title: 'BabyPhone',
        body: `Baby ist wach! (${timeStr})`,
        tag: 'noise-alert',
        url: '/?page=parent',
      });

      if (!success) {
        // Subscription invalid, remove it
        parent.pushSubscription = undefined;
      }
    }
  }

  console.log(`[Noise] Alert sent from room ${room.code} to ${parents.length} parent(s)`);
}

function handleWebRTCSignaling(ws: WebSocket, msg: SignalingMessage): void {
  const found = getMemberByWs(ws);
  if (!found) return;

  const { room, member } = found;
  const targetId = msg.targetId as string;

  if (targetId) {
    // Send to specific peer
    const target = room.members.get(targetId);
    if (target) {
      send(target.ws, {
        ...msg,
        senderId: member.id,
      });
    }
  } else {
    // Broadcast to all peers
    const peers = getPeerMembers(room, member.id);
    for (const peer of peers) {
      send(peer.ws, {
        ...msg,
        senderId: member.id,
      });
    }
  }
}

function handleDisconnect(ws: WebSocket): void {
  const found = getMemberByWs(ws);
  if (!found) return;

  const { room, member } = found;

  // Notify peers about disconnect
  const peers = getPeerMembers(room, member.id);
  for (const peer of peers) {
    send(peer.ws, {
      type: 'peer-disconnected',
      peerId: member.id,
    });
  }

  console.log(`[Signaling] Member ${member.id} disconnected from room ${room.code}`);
  removeMember(room, member.id);
}
