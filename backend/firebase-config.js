// Public Firebase web config for project nic-japan-2027 (Spark/free plan).
// These values are NOT secrets — every Firebase web app ships them. Access is
// enforced by Firestore security rules (members only, invite code to join).
export const firebaseConfig = {
  apiKey: 'AIzaSyDvoUmxV3dKbfVI3qpI3bdEouYwUpqnI6U',
  authDomain: 'nic-japan-2027.firebaseapp.com',
  projectId: 'nic-japan-2027',
  storageBucket: 'nic-japan-2027.firebasestorage.app',
  messagingSenderId: '470575748423',
  appId: '1:470575748423:web:342282d0c04245e50ae862',
};
// Optional: Web Push certificate (VAPID public key) from Firebase console →
// Project settings → Cloud Messaging → Web Push certificates. Leave '' to use
// the Firebase SDK's built-in default key.
export const vapidKey = '';
// Self-hosted copy of the gstatic SDK (same version, see vendor/firebase/13.2.0/README.md) so an
// offline cold launch works; sw.js precaches it.
export const SDK = new URL('../vendor/firebase/13.2.0', import.meta.url).href;
