// Runs once a day from GitHub Actions. Sends tenant reminders and the
// family summary as browser notifications.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { buildPlan } from "./plan.js";

const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT;
const siteUrl = (process.env.SITE_URL || "").replace(/\/?$/, "/");
const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";

if (!rawKey) fail("The FIREBASE_SERVICE_ACCOUNT secret is missing in GitHub.");
if (!siteUrl || siteUrl === "/") fail("SITE_URL is missing.");

let credentials;
try {
  credentials = JSON.parse(rawKey);
} catch (err) {
  fail("The FIREBASE_SERVICE_ACCOUNT secret is not valid JSON. Paste the whole key file again.");
}

initializeApp({ credential: cert(credentials) });
const db = getFirestore();
const messaging = getMessaging();

function fail(message) {
  console.error("ERROR: " + message);
  process.exit(1);
}

async function readAll(name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

const [rooms, payments, devices, familyDevices] = await Promise.all([
  readAll("rooms"), readAll("payments"), readAll("devices"), readAll("familyDevices")
]);

const plan = buildPlan({ rooms, payments, devices, familyDevices, now: new Date(), siteUrl });
console.log(`Date in India: ${plan.today}`);
console.log(`Rooms: ${rooms.length}. Tenant phones: ${devices.length}. Family phones: ${familyDevices.length}.`);
console.log(`To send: ${plan.tenantSends.length} tenant reminders, ${plan.familySends.length} family summaries.`);
console.log(`Summary text: ${plan.summary.title} | ${plan.summary.body}`);

const iconUrl = siteUrl + "icon-192.png";
let sent = 0;
let failed = 0;
let removed = 0;

for (const item of [...plan.tenantSends, ...plan.familySends]) {
  const label = item.roomNo ? `room ${item.roomNo} (${item.kind})` : "family summary";
  if (dryRun) {
    console.log(`DRY RUN, would send to ${label}: ${item.message.title} | ${item.message.body}`);
    continue;
  }
  try {
    await messaging.send({
      token: item.token,
      notification: { title: item.message.title, body: item.message.body },
      webpush: {
        fcmOptions: { link: item.message.link },
        notification: { icon: iconUrl }
      }
    });
    sent += 1;
    console.log(`Sent to ${label}`);
  } catch (err) {
    const code = err && err.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      await db.collection(item.collection).doc(item.deviceId).delete();
      removed += 1;
      console.log(`Removed an old phone for ${label}`);
    } else {
      failed += 1;
      console.error(`Could not send to ${label}: ${code || err}`);
    }
  }
}

console.log(`Done. Sent ${sent}, failed ${failed}, old phones removed ${removed}.`);
const wanted = plan.tenantSends.length + plan.familySends.length;
if (!dryRun && wanted > 0 && sent === 0 && removed === 0) fail("Nothing could be sent.");
