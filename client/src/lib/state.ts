export type Page = 'home' | 'baby' | 'parent' | 'pair';
export type Role = 'baby' | 'parent';

export interface AppState {
  page: Page;
  role: Role | null;
  roomCode: string | null;
  memberId: string | null;
  connected: boolean;
  paired: boolean;
  monitoring: boolean;
  noiseLevel: number;
  noiseThreshold: number;
  noiseHoldMs: number;
  noiseDetected: boolean;
  pushEnabled: boolean;
  streamActive: boolean;
  peerConnected: boolean;
  peerId: string | null;
  peerLocalIp: string | null;
  wakeLockActive: boolean;
  error: string | null;
}

type Listener = (state: AppState) => void;

const STORAGE_KEY = 'babyphone-state';

const defaultState: AppState = {
  page: 'home',
  role: null,
  roomCode: null,
  memberId: null,
  connected: false,
  paired: false,
  monitoring: false,
  noiseLevel: 0,
  noiseThreshold: 0.05,
  noiseHoldMs: 500,
  noiseDetected: false,
  pushEnabled: false,
  streamActive: false,
  peerConnected: false,
  peerId: null,
  peerLocalIp: null,
  wakeLockActive: false,
  error: null,
};

let state: AppState = { ...defaultState };
const listeners: Set<Listener> = new Set();

export function getState(): AppState {
  return state;
}

export function setState(partial: Partial<AppState>): void {
  state = { ...state, ...partial };
  persistState();
  notifyListeners();
}

export function resetState(): void {
  const threshold = state.noiseThreshold; // preserve threshold preference
  state = { ...defaultState, noiseThreshold: threshold };
  persistState();
  notifyListeners();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener(state);
  }
}

function persistState(): void {
  const persisted = {
    role: state.role,
    roomCode: state.roomCode,
    noiseThreshold: state.noiseThreshold,
    noiseHoldMs: state.noiseHoldMs,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

export function loadPersistedState(): Partial<AppState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as Partial<AppState>;
    }
  } catch {
    // ignore
  }
  return {};
}
