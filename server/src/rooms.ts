import { v4 as uuidv4 } from 'uuid';
import type { WebSocket } from 'ws';
import type { PushSubscription } from 'web-push';

export interface RoomMember {
  id: string;
  role: 'baby' | 'parent';
  ws: WebSocket;
  pushSubscription?: PushSubscription;
  localIp?: string;
}

export interface Room {
  code: string;
  createdAt: number;
  members: Map<string, RoomMember>;
}

const rooms = new Map<string, Room>();

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateCode(): string {
  let code: string;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(code));
  return code;
}

export function createRoom(): Room {
  const code = generateCode();
  const room: Room = {
    code,
    createdAt: Date.now(),
    members: new Map(),
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function addMember(
  room: Room,
  role: 'baby' | 'parent',
  ws: WebSocket,
  localIp?: string,
): RoomMember {
  const member: RoomMember = {
    id: uuidv4(),
    role,
    ws,
    localIp,
  };
  room.members.set(member.id, member);
  return member;
}

export function removeMember(room: Room, memberId: string): void {
  room.members.delete(memberId);
  // Clean up empty rooms
  if (room.members.size === 0) {
    rooms.delete(room.code);
  }
}

export function getMemberByWs(ws: WebSocket): { room: Room; member: RoomMember } | undefined {
  for (const room of rooms.values()) {
    for (const member of room.members.values()) {
      if (member.ws === ws) {
        return { room, member };
      }
    }
  }
  return undefined;
}

export function getPeerMembers(room: Room, memberId: string): RoomMember[] {
  const peers: RoomMember[] = [];
  for (const [id, member] of room.members) {
    if (id !== memberId) {
      peers.push(member);
    }
  }
  return peers;
}

export function getParentMembers(room: Room): RoomMember[] {
  const parents: RoomMember[] = [];
  for (const member of room.members.values()) {
    if (member.role === 'parent') {
      parents.push(member);
    }
  }
  return parents;
}

// Periodic cleanup of expired rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    // Only clean up rooms that have no members and are old
    if (room.members.size === 0 && now - room.createdAt > CODE_TTL_MS) {
      rooms.delete(code);
    }
  }
}, 60_000);
