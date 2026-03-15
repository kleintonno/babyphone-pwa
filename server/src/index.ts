import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { initializePush, getPublicVapidKey } from './push.js';
import { handleConnection } from './signaling.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'admin@bayphone.local';

// Initialize push notifications
initializePush(CONTACT_EMAIL);

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// VAPID public key endpoint (for initial setup before WebSocket)
app.get('/api/vapid-key', (_req, res) => {
  res.json({ key: getPublicVapidKey() });
});

// Serve static client files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('../client/dist'));
  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile('index.html', { root: '../client/dist' });
  });
}

const server = createServer(app);

// WebSocket server on the same HTTP server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log(`[WS] Client connected (${wss.clients.size} total)`);
  handleConnection(ws);
});

server.listen(PORT, () => {
  console.log(`[Server] BayPhone server running on port ${PORT}`);
  console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`[Server] VAPID key endpoint: http://localhost:${PORT}/api/vapid-key`);
});
