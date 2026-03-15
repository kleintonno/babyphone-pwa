import { getState, setState } from './state.js';
import { send, onMessage } from './signaling.js';
import { getMediaStream } from './audio-monitor.js';

let peerConnection: RTCPeerConnection | null = null;
let remoteAudio: HTMLAudioElement | null = null;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // TURN server will be added from env/config
];

// Add TURN server if configured
const TURN_URL = import.meta.env.VITE_TURN_URL;
const TURN_USER = import.meta.env.VITE_TURN_USER;
const TURN_PASS = import.meta.env.VITE_TURN_PASS;

if (TURN_URL) {
  ICE_SERVERS.push({
    urls: TURN_URL as string,
    username: TURN_USER as string,
    credential: TURN_PASS as string,
  });
}

interface RTCSignalingMessage {
  type: string;
  senderId: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

export function initWebRTC(): () => void {
  const unsubscribe = onMessage((msg) => {
    switch (msg.type) {
      case 'offer':
        handleOffer(msg as unknown as RTCSignalingMessage);
        break;
      case 'answer':
        handleAnswer(msg as unknown as RTCSignalingMessage);
        break;
      case 'ice-candidate':
        handleIceCandidate(msg as unknown as RTCSignalingMessage);
        break;
    }
  });

  return unsubscribe;
}

function createPeerConnection(peerId: string): RTCPeerConnection {
  if (peerConnection) {
    peerConnection.close();
  }

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      send({
        type: 'ice-candidate',
        targetId: peerId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', pc.connectionState);
    switch (pc.connectionState) {
      case 'connected':
        setState({ peerConnected: true, streamActive: true });
        break;
      case 'disconnected':
      case 'failed':
      case 'closed':
        setState({ peerConnected: false, streamActive: false });
        break;
    }
  };

  pc.ontrack = (event) => {
    console.log('[WebRTC] Received remote track');
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.autoplay = true;
      remoteAudio.id = 'remote-audio';
      document.body.appendChild(remoteAudio);
    }
    remoteAudio.srcObject = event.streams[0];
  };

  peerConnection = pc;
  return pc;
}

export async function startStream(targetPeerId: string): Promise<void> {
  const stream = getMediaStream();

  if (!stream) {
    console.error('[WebRTC] No media stream available');
    return;
  }

  const pc = createPeerConnection(targetPeerId);

  // Add audio tracks
  for (const track of stream.getAudioTracks()) {
    pc.addTrack(track, stream);
  }

  // Create and send offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  send({
    type: 'offer',
    targetId: targetPeerId,
    sdp: offer.sdp,
  });

  setState({ peerId: targetPeerId });
  console.log('[WebRTC] Offer sent to', targetPeerId);
}

async function handleOffer(msg: RTCSignalingMessage): Promise<void> {
  console.log('[WebRTC] Received offer from', msg.senderId);

  const pc = createPeerConnection(msg.senderId);

  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }),
  );

  // If we're the baby, add our audio stream
  const state = getState();
  if (state.role === 'baby') {
    const stream = getMediaStream();
    if (stream) {
      for (const track of stream.getAudioTracks()) {
        pc.addTrack(track, stream);
      }
    }
  }

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  send({
    type: 'answer',
    targetId: msg.senderId,
    sdp: answer.sdp,
  });

  setState({ peerId: msg.senderId });
  console.log('[WebRTC] Answer sent to', msg.senderId);
}

async function handleAnswer(msg: RTCSignalingMessage): Promise<void> {
  console.log('[WebRTC] Received answer from', msg.senderId);
  if (peerConnection) {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }),
    );
  }
}

async function handleIceCandidate(msg: RTCSignalingMessage): Promise<void> {
  if (peerConnection && msg.candidate) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } catch (err) {
      console.error('[WebRTC] Failed to add ICE candidate:', err);
    }
  }
}

export function stopStream(): void {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (remoteAudio) {
    remoteAudio.srcObject = null;
    remoteAudio.remove();
    remoteAudio = null;
  }
  setState({ streamActive: false, peerConnected: false, peerId: null });
}
