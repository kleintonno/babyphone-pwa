import webpush from 'web-push';
import type { PushSubscription } from 'web-push';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_PATH = join(__dirname, '..', 'vapid-keys.json');

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let vapidKeys: VapidKeys;

export function initializePush(contactEmail: string): VapidKeys {
  if (existsSync(KEYS_PATH)) {
    const raw = readFileSync(KEYS_PATH, 'utf-8');
    vapidKeys = JSON.parse(raw) as VapidKeys;
  } else {
    const generated = webpush.generateVAPIDKeys();
    vapidKeys = {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
    };
    writeFileSync(KEYS_PATH, JSON.stringify(vapidKeys, null, 2));
    console.log('[Push] Generated new VAPID keys');
  }

  webpush.setVapidDetails(
    `mailto:${contactEmail}`,
    vapidKeys.publicKey,
    vapidKeys.privateKey,
  );

  console.log('[Push] VAPID public key:', vapidKeys.publicKey);
  return vapidKeys;
}

export function getPublicVapidKey(): string {
  return vapidKeys.publicKey;
}

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: {
    title: string;
    body: string;
    url?: string;
    tag?: string;
  },
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload),
    );
    console.log('[Push] Notification sent successfully');
    return true;
  } catch (err: unknown) {
    const error = err as { statusCode?: number };
    console.error('[Push] Failed to send notification:', error);
    // 410 = subscription expired/invalid
    if (error.statusCode === 410) {
      return false;
    }
    return false;
  }
}
