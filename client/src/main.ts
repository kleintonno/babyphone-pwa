import { getState, setState, subscribe, loadPersistedState } from './lib/state.js';
import { renderHome } from './pages/home.js';
import { renderPair } from './pages/pair.js';
import { renderBaby } from './pages/baby.js';
import { renderParent } from './pages/parent.js';
import { initPush } from './lib/push.js';
import './styles.css';

const app = document.getElementById('app')!;

// Simple router
function render(): void {
  const state = getState();

  switch (state.page) {
    case 'home':
      renderHome(app);
      break;
    case 'pair':
      renderPair(app);
      break;
    case 'baby':
      renderBaby(app);
      break;
    case 'parent':
      renderParent(app);
      break;
  }
}

// Subscribe to state changes for navigation
let currentPage = getState().page;
subscribe((state) => {
  if (state.page !== currentPage) {
    currentPage = state.page;
    render();
  }
});

// Initialize
async function init(): Promise<void> {
  // Load persisted state
  const persisted = loadPersistedState();
  const restored: Partial<typeof persisted> = {};
  if (persisted.noiseThreshold !== undefined) restored.noiseThreshold = persisted.noiseThreshold;
  if (persisted.noiseHoldMs !== undefined) restored.noiseHoldMs = persisted.noiseHoldMs;
  if (Object.keys(restored).length) setState(restored);

  // Register service worker
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('[SW] Registered:', registration.scope);
    } catch (err) {
      console.error('[SW] Registration failed:', err);
    }
  }

  // Initialize push support
  await initPush();

  // Check URL params for direct navigation
  const params = new URLSearchParams(location.search);
  const page = params.get('page');
  if (page === 'parent' || page === 'baby') {
    setState({ page, role: page });
  }

  // Initial render
  render();
}

init();
