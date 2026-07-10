/**
 * Optional Firebase sync layer — mirrors key writes to Firestore in the background.
 * SQLite remains the source of truth for on-premises deployments.
 *
 * Enable by setting FIREBASE_SERVICE_ACCOUNT (JSON string) in .env.
 * If the env var is absent or firebase-admin is not installed, all functions are no-ops.
 *
 * Architecture steps covered:
 *   Step 2  — Sends Accident Location → Firebase
 *   Step 3  — Shares Location → Firebase
 *   Step 8  — Location Sync → Firebase
 *   Step 14 — Return GPS Sync → Firebase
 *   Step 18 — Store Ride Completed [END] → Firebase
 */

let firestore = null;

try {
  const admin = require('firebase-admin');
  const raw   = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && !admin.apps.length) {
    admin.initializeApp({
      credential  : admin.credential.cert(JSON.parse(raw)),
      databaseURL : process.env.FIREBASE_DATABASE_URL,
    });
    firestore = admin.firestore();
    console.log('[firebase] sync enabled — Firestore connected');
  }
} catch {
  // firebase-admin not installed or FIREBASE_SERVICE_ACCOUNT not set — sync disabled
}

// Steps 2 & 3 — called when a new emergency request is dispatched
async function syncRequestToFirebase(requestData) {
  if (!firestore) return;
  try {
    await firestore.collection('emergency_requests').doc(requestData.id).set(requestData, { merge: true });
  } catch (e) {
    console.error('[firebase] syncRequest failed:', e.message);
  }
}

// Steps 8 & 14 — called on each GPS location update (enroute to patient and to hospital)
async function syncLocationToFirebase(ambulanceId, lat, lng, requestId) {
  if (!firestore) return;
  try {
    await firestore.collection('ambulance_locations').doc(ambulanceId).set({
      lat,
      lng,
      requestId,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (e) {
    console.error('[firebase] syncLocation failed:', e.message);
  }
}

// Step 18 — called when the ride is marked completed
async function syncRideCompletedToFirebase(requestId, completedAt) {
  if (!firestore) return;
  try {
    await firestore.collection('emergency_requests').doc(requestId).update({
      status     : 'completed',
      completedAt: completedAt || new Date().toISOString(),
    });
  } catch (e) {
    console.error('[firebase] syncRideCompleted failed:', e.message);
  }
}

module.exports = { syncRequestToFirebase, syncLocationToFirebase, syncRideCompletedToFirebase };
