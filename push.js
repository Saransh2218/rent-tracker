// Shared helpers for browser notifications, used by the family
// dashboard and the tenant page.
import {
  getMessaging, getToken, deleteToken, isSupported, onMessage
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging.js";
import { VAPID_KEY } from "./firebase-config.js";

// Quick check that does not need to wait. Browsers without these
// features (for example iPhone Safari outside the home screen app)
// cannot receive reminders.
export function pushPossible() {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

export async function pushSupported() {
  try {
    return pushPossible() && (await isSupported());
  } catch (err) {
    return false;
  }
}

// Registers the service worker and returns this browser's notification code.
export async function getPushToken(app) {
  const registration = await navigator.serviceWorker.register("firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;
  return getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
}

export async function dropPushToken(app) {
  try {
    await deleteToken(getMessaging(app));
  } catch (err) {
    console.error(err);
  }
}

// Shows a message while the page is open (the browser shows it
// by itself when the page is closed).
export function onForegroundMessage(app, callback) {
  onMessage(getMessaging(app), (payload) => callback(payload.notification || {}));
}

// A short fixed id for a notification code, used as the database document id.
export async function deviceId(token) {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
