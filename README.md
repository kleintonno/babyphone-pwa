# BayPhone

Digitales Babyphone als Progressive Web App. Ein Handy ueberwacht das Baby, das andere empfaengt Push-Benachrichtigungen bei Geraeuschen — im WLAN per Peer-to-Peer, unterwegs ueber den eigenen Server.

## Features

- **Geraeusch-Erkennung** — Echtzeit-Audio-Analyse via AudioWorklet (RMS + Glaettung, konfigurierbarer Schwellenwert)
- **Push-Benachrichtigungen** — Web Push API (VAPID), funktioniert auch bei gesperrtem Bildschirm
- **Audio-Streaming** — WebRTC P2P im LAN, TURN-Relay ueber VPS als Fallback
- **PWA** — Installierbar auf dem Homescreen, Offline-faehig
- **Wake Lock** — Baby-Geraet bleibt wach waehrend der Ueberwachung
- **Kein Account noetig** — Pairing ueber 6-stelligen Code

## Tech-Stack

| Komponente | Technologie |
|---|---|
| Frontend | Vanilla TypeScript + Vite |
| Audio-Analyse | Web Audio API + AudioWorklet |
| Streaming | WebRTC |
| Signaling | Node.js + ws (WebSocket) |
| Push | Web Push API (VAPID) |
| Deployment | Docker + Caddy (Auto-SSL) + coturn (TURN) |

## Projekt-Struktur

```
client/                 # Frontend PWA (Vite + TypeScript)
  src/
    pages/              # Baby-, Parent-, Pairing-Ansichten
    lib/                # Audio-Monitor, WebRTC, Signaling, Push, State
    workers/            # AudioWorklet Processor
  public/               # Service Worker, Manifest, Icons

server/                 # Signaling + Push Server (Node.js)
  src/
    index.ts            # Express + WebSocket Server
    signaling.ts        # Room-Management, WebRTC-Signaling, Noise-Events
    rooms.ts            # In-Memory Pairing-System
    push.ts             # VAPID + Web Push

docker-compose.yml      # Caddy + BayPhone + coturn
Dockerfile              # Multi-Stage Build
```

## Lokale Entwicklung

```bash
# Server starten
cd server
npm install
npm run dev

# Client starten (separates Terminal)
cd client
npm install
npm run dev
```

Client laeuft auf `http://localhost:5173`, Server auf `http://localhost:3000`.

## Deployment (VPS)

Voraussetzungen:
- Docker + Docker Compose
- Domain die per DNS auf den VPS zeigt
- Ports 80, 443, 3478 (UDP) und 49152-65535 (UDP) offen

```bash
# 1. Konfiguration
cp .env.example .env
```

`.env` anpassen:

```env
DOMAIN=bayphone.deinedomain.de
CONTACT_EMAIL=deine@email.de
TURN_SECRET=<openssl rand -hex 32>
```

```bash
# 2. Starten
docker compose up -d --build
```

Caddy holt automatisch ein Let's Encrypt-Zertifikat. Die App ist danach unter `https://DOMAIN` erreichbar.

## Benutzung

1. App auf beiden Handys oeffnen (am besten zum Homescreen hinzufuegen)
2. Auf dem Baby-Geraet **"Baby"** waehlen — ein 6-stelliger Code erscheint
3. Auf dem Eltern-Geraet **"Eltern"** waehlen — Code eingeben
4. Baby-Geraet: **"Ueberwachung starten"** — Empfindlichkeit nach Bedarf anpassen
5. Bei Geraeuschen ueber dem Schwellenwert (>2 Sekunden): Push-Notification + Live-Audio

## Hinweise

- **iOS**: Push-Notifications funktionieren ab iOS 16.4+, nur wenn die PWA zum Homescreen hinzugefuegt wurde
- **Baby-Geraet**: Am Ladekabel lassen — Wake Lock haelt den Bildschirm wach
- **Datenschutz**: Audio wird nie auf dem Server gespeichert. Der Stream laeuft direkt P2P (oder verschluesselt ueber TURN)
