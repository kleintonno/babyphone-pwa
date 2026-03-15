import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { setState } from './state.js';

// LAN-Mode: Direct WebRTC pairing via QR code without signaling server.
//
// Flow:
// 1. Baby creates RTCPeerConnection + DataChannel, generates SDP offer
// 2. SDP offer is compressed and encoded into a QR code
// 3. Parent scans QR → sets remote description (offer)
// 4. Parent generates SDP answer → displays as QR code
// 5. Baby scans answer QR → connection established
//
// Once the DataChannel is open, it replaces the WebSocket signaling
// for noise alerts and stream negotiation.

export type LanRole = 'baby' | 'parent';

let peerConnection: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;
let onNoiseAlert: (() => void) | null = null;

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [], // No STUN needed in LAN
};

// Compress SDP to fit in QR code
function compressSDP(sdp: string): string {
  // Strip unnecessary lines and whitespace to minimize size
  const lines = sdp.split('\r\n').filter((line) => {
    // Keep only essential SDP lines
    if (line.startsWith('a=candidate:')) {
      // Only keep host candidates (LAN)
      return line.includes('typ host');
    }
    // Remove some verbose lines
    if (line.startsWith('a=extmap:')) return false;
    if (line.startsWith('a=rtcp-fb:')) return false;
    if (line.startsWith('a=fmtp:')) return false;
    if (line.startsWith('a=ssrc:')) return false;
    return line.length > 0;
  });
  return lines.join('\n');
}

function decompressSDP(compressed: string): string {
  return compressed.replace(/\n/g, '\r\n') + '\r\n';
}

export async function createBabyOffer(): Promise<{
  qrDataUrl: string;
  pc: RTCPeerConnection;
}> {
  peerConnection = new RTCPeerConnection(ICE_CONFIG);

  // Create data channel for noise alerts
  dataChannel = peerConnection.createDataChannel('bayphone', {
    ordered: true,
  });

  setupDataChannel(dataChannel);

  // Wait for ICE gathering to complete
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  // Wait for ICE candidates to be gathered
  await waitForICEGathering(peerConnection);

  const localDesc = peerConnection.localDescription!;
  const compressed = compressSDP(localDesc.sdp);

  const qrPayload = JSON.stringify({
    t: 'o', // type: offer
    s: compressed,
  });

  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: 'L',
    margin: 2,
    width: 300,
    color: {
      dark: '#e8e8e8',
      light: '#1a1a2e',
    },
  });

  return { qrDataUrl, pc: peerConnection };
}

export async function handleScannedOffer(qrData: string): Promise<string> {
  const parsed = JSON.parse(qrData) as { t: string; s: string };
  if (parsed.t !== 'o') throw new Error('Expected offer QR code');

  peerConnection = new RTCPeerConnection(ICE_CONFIG);

  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel(dataChannel);
  };

  const sdp = decompressSDP(parsed.s);
  await peerConnection.setRemoteDescription(
    new RTCSessionDescription({ type: 'offer', sdp }),
  );

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  await waitForICEGathering(peerConnection);

  const localDesc = peerConnection.localDescription!;
  const compressed = compressSDP(localDesc.sdp);

  const answerPayload = JSON.stringify({
    t: 'a', // type: answer
    s: compressed,
  });

  const qrDataUrl = await QRCode.toDataURL(answerPayload, {
    errorCorrectionLevel: 'L',
    margin: 2,
    width: 300,
    color: {
      dark: '#e8e8e8',
      light: '#1a1a2e',
    },
  });

  return qrDataUrl;
}

export async function handleScannedAnswer(qrData: string): Promise<void> {
  const parsed = JSON.parse(qrData) as { t: string; s: string };
  if (parsed.t !== 'a') throw new Error('Expected answer QR code');

  if (!peerConnection) throw new Error('No peer connection');

  const sdp = decompressSDP(parsed.s);
  await peerConnection.setRemoteDescription(
    new RTCSessionDescription({ type: 'answer', sdp }),
  );
}

function setupDataChannel(dc: RTCDataChannel): void {
  dc.onopen = () => {
    console.log('[LAN] DataChannel open');
    setState({ paired: true, peerConnected: true, connected: true });
  };

  dc.onclose = () => {
    console.log('[LAN] DataChannel closed');
    setState({ paired: false, peerConnected: false });
  };

  dc.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as { type: string };
      if (msg.type === 'noise-alert' && onNoiseAlert) {
        onNoiseAlert();
      }
    } catch {
      // ignore
    }
  };
}

export function sendLanNoiseAlert(): void {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify({ type: 'noise-alert', timestamp: new Date().toISOString() }));
  }
}

export function setNoiseAlertHandler(handler: () => void): void {
  onNoiseAlert = handler;
}

export function addAudioTrackToLan(stream: MediaStream): void {
  if (!peerConnection) return;
  for (const track of stream.getAudioTracks()) {
    peerConnection.addTrack(track, stream);
  }
}

export function getLanPeerConnection(): RTCPeerConnection | null {
  return peerConnection;
}

function waitForICEGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const timeout = setTimeout(() => resolve(), 3000);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        resolve();
      }
    };
  });
}

// QR Scanner using camera
export async function startQRScanner(
  videoElement: HTMLVideoElement,
  canvasElement: HTMLCanvasElement,
  onScan: (data: string) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
  });

  videoElement.srcObject = stream;
  await videoElement.play();

  const ctx = canvasElement.getContext('2d')!;
  let running = true;

  function scan(): void {
    if (!running) return;

    if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;
      ctx.drawImage(videoElement, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvasElement.width, canvasElement.height);

      // Try native BarcodeDetector first, fallback to jsQR
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (code && code.data) {
        onScan(code.data);
        return; // Stop scanning after successful read
      }
    }

    requestAnimationFrame(scan);
  }

  requestAnimationFrame(scan);

  // Return cleanup function
  return () => {
    running = false;
    stream.getTracks().forEach((t) => t.stop());
    videoElement.srcObject = null;
  };
}

export function closeLanConnection(): void {
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  onNoiseAlert = null;
}
