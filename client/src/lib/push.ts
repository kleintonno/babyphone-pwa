import { setState } from './state.js';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3000' : '';

let registration: ServiceWorkerRegistration | null = null;

export async function initPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[Push] Push notifications not supported');
    setState({ error: 'Push-Benachrichtigungen werden in diesem Browser nicht unterstuetzt.' });
    return;
  }

  try {
    registration = await navigator.serviceWorker.ready;
    console.log('[Push] Service Worker ready');
  } catch (err) {
    console.error('[Push] Service Worker registration failed:', err);
  }
}

export async function subscribePush(): Promise<PushSubscription | null> {
  if (!registration) {
    await initPush();
  }
  if (!registration) return null;

  try {
    // Get VAPID key from server
    const res = await fetch(`${API_BASE}/api/vapid-key`);
    const { key } = (await res.json()) as { key: string };

    // Convert VAPID key to Uint8Array
    const vapidKey = urlBase64ToUint8Array(key);

    // Check existing subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Request permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState({ error: 'Push-Benachrichtigungen wurden abgelehnt.' });
        return null;
      }

      // Subscribe
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey as BufferSource,
      });
    }

    setState({ pushEnabled: true });
    console.log('[Push] Subscribed successfully');
    return subscription;
  } catch (err) {
    console.error('[Push] Subscription failed:', err);
    setState({ error: 'Push-Subscription fehlgeschlagen.' });
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
