// Japan 2027 · live backend (Firebase, Spark/free plan). Self-contained ES module.
// Lazy-loads the Firebase SDK from gstatic only when first used. API: see INTEGRATION.md.
import { firebaseConfig, vapidKey, SDK } from './firebase-config.js';

const STALE_MIN = 10;            // location older than this → "last seen N min ago"
const SHARE_TTL_MIN = 30;        // location doc expireAt, refreshed on every write
const WRITE_GAP_MS = 60e3;       // write at least this often while the app is open…
const MOVE_GAP_MS = 15e3;        // …or sooner if moved ≥ MOVE_M, but never more often than this
const MOVE_M = 50;
const BAD_ACC_M = 1000;          // ignore fixes worse than this when a better one is recent
const KEEPALIVE_MS = 4 * 60e3;   // re-send the last fix if the phone is still (iOS goes quiet)
const CODE_LEN = 26;             // invite codes: 26 chars, a–z and 2–7
const LS = { who: 'jp27.who', share: 'jp27.share' };

let fb, app, auth, db, user, who = null, whoVerified = false, revoked = false, ready = null, pushOn = null;
const listeners = new Set();
const emit = () => listeners.forEach(f => { try { f(state()); } catch (e) { console.error(e); } });
const err = (code, extra) => Object.assign(new Error(code), { code }, extra || {});

/** { signedIn, who, whoVerified (false = from offline cache), revoked, sharing, push (null = unknown) } */
export const state = () => ({ signedIn: !!user, who, whoVerified, revoked, sharing: !!(share.watchId != null), push: pushOn });
export const onState = (f) => (listeners.add(f), f(state()), () => listeners.delete(f));

async function sdk() {
  if (fb) return fb;
  const [a, au, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
  return (fb = { ...a, ...au, ...fs });
}

/** Sign in (anonymous, per device), restore who (works offline from cache), verify membership
 *  when online. Never throws for "offline"; check state().whoVerified. Safe to call many times. */
export function init() {
  if (ready) return ready;
  ready = (async () => {
    const f = await sdk();
    app = f.initializeApp(firebaseConfig);
    auth = f.getAuth(app);
    try { db = f.initializeFirestore(app, { localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }) }); }
    catch (e) { db = f.getFirestore(app); }
    who = localStorage.getItem(LS.who) || null;
    user = auth.currentUser || await new Promise(r => { const u = f.onAuthStateChanged(auth, x => { u(); r(x); }); });
    if (!user) user = (await f.signInAnonymously(auth)).user;
    await verify();
    return state();
  })().catch(e => { ready = null; throw e; });
  return ready;
}

/** Re-checks membership with the server. Offline → keeps the cached who (whoVerified=false). */
export async function verify() {
  const f = fb;
  try {
    const m = await f.getDocFromServer(f.doc(db, 'members', user.uid));
    if (!m.exists()) { setWho(null); revoked = false; }
    else {
      try { await f.getDocFromServer(f.doc(db, 'status', 'sender')); setWho(m.data().who); revoked = false; }
      catch (e) { if (e.code === 'permission-denied') { setWho(null); revoked = true; } else throw e; }  // code rotated
    }
    whoVerified = true;
  } catch (e) { whoVerified = false; }      // offline / flaky: trust the cache for now
  emit();
  return state();
}
function setWho(w) { who = w; if (w) localStorage.setItem(LS.who, w); else localStorage.removeItem(LS.who); }

// ---------- joining ----------
/** Normalises a pasted code/link: case, spaces, dashes, look-alikes (0→o, 1→l, 8→b).
 *  Returns { who|null, code } or throws 'bad-code' / 'code-cut-off'. */
export function parseCode(text, person) {
  const raw = String(text || '');
  const m = raw.match(/(?:join=)?\b(nic|elly)\s*[.\-:_ ]\s*([A-Za-z0-9 \-]{8,80})/i);
  const p = (m ? m[1] : person || '').toLowerCase() || null;
  let c = (m ? m[2] : raw).toLowerCase().replace(/[\s\-_.]/g, '').replace(/0/g, 'o').replace(/1/g, 'l').replace(/8/g, 'b');
  c = c.replace(/[^a-z2-7]/g, '');
  if (c.length > CODE_LEN) c = c.slice(0, CODE_LEN);
  if (c.length < CODE_LEN) throw err(c.length >= 8 ? 'code-cut-off' : 'bad-code');
  if (p && !['nic', 'elly'].includes(p)) throw err('bad-code');
  return { who: p, code: c };
}

/** Join this device as 'nic' or 'elly'. Idempotent: re-joining with the same code is a no-op;
 *  a different person/code (or a rotated code) replaces the old membership.
 *  Errors: 'bad-code', 'code-cut-off', 'need-person', 'offline'. */
export async function join(person, code, { deviceLabel } = {}) {
  await init();
  const f = fb, p = parseCode(code, person);
  const w = (person || p.who || '').toLowerCase();
  if (!['nic', 'elly'].includes(w)) throw err('need-person');
  const ref = f.doc(db, 'members', user.uid);
  let cur;
  try { cur = await f.getDocFromServer(ref); } catch (e) { throw err('offline', { cause: e }); }
  if (cur.exists()) {
    const d = cur.data();
    if (d.who === w && d.code === p.code) { await verify(); if (who === w) return w; }
    await f.deleteDoc(ref);                    // members are create-only; replace = delete + create
  }
  try {
    await f.setDoc(ref, { who: w, code: p.code, joinedAt: f.serverTimestamp(), device: (deviceLabel || deviceName()).slice(0, 80) });
  } catch (e) {
    if (e.code === 'permission-denied') throw err('bad-code');
    if (e.code === 'unavailable') throw err('offline', { cause: e });
    throw e;
  }
  setWho(w); revoked = false; whoVerified = true; emit();
  return w;
}

export function deviceName() {
  const ua = navigator.userAgent, standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Browser';
  return `${kind} · ${standalone ? 'Home Screen app' : 'browser'} · ${new Date().toISOString().slice(0, 10)}`;
}

/** Accepts a pasted setup link, "elly.<code>", or a bare code (then pass person). */
export async function joinFromText(text, person) { const p = parseCode(text, person); return join(person || p.who, p.code); }

/** Handles  …/Japan/#join=elly.<code>  once and strips it from the URL.
 *  Returns who, null if there's no join link, or throws ('code-cut-off', 'bad-code', 'offline'). */
export async function consumeJoinLink() {
  const h = location.hash;
  if (!/(?:^#|&)join=/i.test(h)) return null;
  history.replaceState(null, '', location.pathname + location.search);
  const raw = decodeURIComponent(h.slice(h.search(/join=/i)));
  return joinFromText(raw);
}

/** Remove this device: stops sharing + alerts and deletes its membership. */
export async function leave() {
  await init(); const f = fb;
  await stopSharing().catch(() => {});
  await disablePush().catch(() => {});        // even if this fails, the sender skips non-members
  await f.deleteDoc(f.doc(db, 'members', user.uid));
  setWho(null); emit();
}

// ---------- live location (only while the app is open on screen) ----------
const share = { watchId: null, last: null, lastAt: 0, keep: null, onError: null };

function distM(a, b) {
  const R = 6371e3, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export { distM as distanceMeters };

async function writeFix(fix) {
  const f = fb, now = Date.now();
  share.last = fix; share.lastAt = now;
  await f.setDoc(f.doc(db, 'locations', user.uid), {
    who, ...fix, updatedAt: f.serverTimestamp(), expireAt: f.Timestamp.fromMillis(now + SHARE_TTL_MIN * 60e3) });
}
function onFix(p, force) {
  const fix = { lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), acc: Math.round(p.coords.accuracy || 0) };
  const now = Date.now(), gap = now - share.lastAt;
  if (!force && share.last) {
    if (fix.acc > BAD_ACC_M && share.last.acc <= BAD_ACC_M && gap < 5 * 60e3) return;   // jumpy indoor fix
    const moved = distM(share.last, fix);
    if (gap < MOVE_GAP_MS || (gap < WRITE_GAP_MS && moved < MOVE_M)) return;
  }
  writeFix(fix).catch(e => share.onError?.(e));
}

/** Opt-in: share this device's position. Call from a tap. Pauses when hidden.
 *  onError(e): e.code 'location-denied' means sharing was turned off (show Settings hint). */
export async function startSharing({ onError } = {}) {
  await init();
  if (!who) throw err('not-joined');
  if (!('geolocation' in navigator)) throw err('no-geolocation');
  share.onError = onError || null;
  localStorage.setItem(LS.share, '1');
  resumeWatch(true);
  document.addEventListener('visibilitychange', onVis);
  emit();
}
function resumeWatch(force) {
  if (share.watchId != null) return;
  let first = force;
  share.watchId = navigator.geolocation.watchPosition(
    p => { onFix(p, first); first = false; },
    e => {
      if (e.code === 1) {             // PERMISSION_DENIED: really stop, don't pretend to share
        stopSharing().catch(() => {});
        share.onError?.(err('location-denied', { hint: 'Location is off for this app. iPhone: Settings → Privacy & Security → Location Services → Safari Websites (or the app) → While Using.' }));
      } else share.onError?.(e);
    },
    { enableHighAccuracy: true, maximumAge: 15e3, timeout: 30e3 });
  clearInterval(share.keep);
  share.keep = setInterval(() => { if (share.last && Date.now() - share.lastAt >= KEEPALIVE_MS) writeFix(share.last).catch(() => {}); }, 60e3);
  emit();
}
function pauseWatch() {
  if (share.watchId != null) navigator.geolocation.clearWatch(share.watchId);
  share.watchId = null; clearInterval(share.keep); share.keep = null;
}
function onVis() { if (document.hidden) { pauseWatch(); emit(); } else if (localStorage.getItem(LS.share) === '1') resumeWatch(true); }

/** Stop sharing on THIS device (deletes only this device's location doc). */
export async function stopSharing() {
  localStorage.removeItem(LS.share);
  pauseWatch(); document.removeEventListener('visibilitychange', onVis);
  emit();
  if (fb && user) await fb.deleteDoc(fb.doc(db, 'locations', user.uid));
}

/** Resume on load if this device had sharing on. */
export async function resumeIfOptedIn(opts) {
  if (localStorage.getItem(LS.share) === '1') { await init(); if (who) return startSharing(opts); }
}

/** Live view of both people. cb({ nic, elly }): each null (not sharing) or
 *  { lat, lng, acc, updatedAt: Date, ageMin, stale, devices } — freshest of that person's devices. */
export function watchPeople(cb) {
  let unsub = () => {}, alive = true, docs = [];
  const render = () => {
    const now = Date.now(), out = { nic: null, elly: null };
    for (const d of docs) {
      const exp = d.expireAt?.toMillis?.() ?? 0, upd = d.updatedAt?.toMillis?.() ?? now;
      if (!['nic', 'elly'].includes(d.who) || (exp && exp < now)) continue;
      const cur = out[d.who];
      if (cur && cur.updatedAt.getTime() >= upd) { cur.devices++; continue; }
      const ageMin = Math.max(0, Math.round((now - upd) / 60e3));
      out[d.who] = { lat: d.lat, lng: d.lng, acc: d.acc, label: d.label || null, updatedAt: new Date(upd), ageMin, stale: ageMin >= STALE_MIN, devices: (cur?.devices || 0) + 1 };
    }
    cb(out);
  };
  const tick = setInterval(render, 30e3);
  init().then(() => {
    if (!alive || !who) return;
    const f = fb;
    unsub = f.onSnapshot(f.collection(db, 'locations'), snap => {
      docs = snap.docs.map(d => d.data({ serverTimestamps: 'estimate' })); render();
    }, e => console.warn('[live] location listener', e.code || e));
  }).catch(() => {});
  return () => { alive = false; clearInterval(tick); unsub(); };
}

// ---------- push (FCM web push; app can be closed) ----------
export function pushSupport() {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (ios && !standalone) return { ok: false, reason: 'ios-needs-home-screen', hint: 'On iPhone: Share → Add to Home Screen, open it from there, then turn on alerts (iOS 16.4+).' };
  if (!has) return { ok: false, reason: 'unsupported', hint: 'This browser can’t receive alerts when the app is closed.' };
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied', hint: ios ? 'Alerts are blocked: iPhone Settings → Notifications → Japan 2027 → Allow Notifications.' : 'Alerts are blocked for this site in the browser’s site settings.' };
  return { ok: true, reason: null, hint: null };
}

/** Turn on closed-app nudges. MUST be called directly from a tap: the permission prompt is
 *  requested before any network work so iOS keeps the user-gesture. */
export async function enablePush({ registration, leadMin = 30 } = {}) {
  const sup = pushSupport(); if (!sup.ok) throw err(sup.reason, { hint: sup.hint });
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') throw err('denied', { hint: pushSupport().hint });
  await init();
  if (!who) throw err('not-joined');
  const m = await import(`${SDK}/firebase-messaging.js`);
  if (!(await m.isSupported())) throw err('unsupported');
  const messaging = m.getMessaging(app);
  const reg = registration || await navigator.serviceWorker.ready;
  const token = await m.getToken(messaging, { serviceWorkerRegistration: reg, ...(vapidKey ? { vapidKey } : {}) });
  if (!token) throw err('no-token');
  await writeToken(token, leadMin);
  pushOn = true; emit();
  m.onMessage(messaging, p => {   // app open: leave-by nudges still show a notification; Jarvis messages use the in-app popup
    const n = p.notification || {}, d = p.data || {};
    if (d.jp27msg) { try { window.dispatchEvent(new CustomEvent('jp27:msg', { detail: { id: d.jp27msg } })); } catch (e) {} return; }
    reg.showNotification(n.title || d.title || 'Japan 2027', { body: n.body || d.body || '', tag: d.tag, data: { jp27push: 1, url: d.url || './' }, icon: 'icons/icon-192.png' });
  });
  return token;
}
async function writeToken(token, leadMin) {
  const f = fb;
  await f.setDoc(f.doc(db, 'pushTokens', user.uid), {
    token, who, updatedAt: f.serverTimestamp(), leadMin: Math.max(5, Math.min(120, Math.round(leadMin))), enabled: true,
    platform: navigator.userAgent.slice(0, 120) });
}

/** Re-register silently on app start if alerts were on and permission is still granted
 *  (keeps the token fresh; turns a sender-disabled device back on). No prompt. */
export async function refreshPush({ registration } = {}) {
  await init();
  if (!who || !('Notification' in window) || Notification.permission !== 'granted') return null;
  const s = await pushStatus().catch(() => null);
  if (!s || s.on === false && s.reason === 'off') return null;          // user turned it off
  const m = await import(`${SDK}/firebase-messaging.js`);
  if (!(await m.isSupported())) return null;
  const reg = registration || await navigator.serviceWorker.ready;
  const token = await m.getToken(m.getMessaging(app), { serviceWorkerRegistration: reg, ...(vapidKey ? { vapidKey } : {}) });
  if (token && (token !== s.token || !s.on)) await writeToken(token, s.leadMin || 30);
  pushOn = !!token; emit();
  return token;
}

/** This device's alert status: { on, reason ('off'|'expired'|'device-removed'|null), leadMin, lastSentAt, token } */
export async function pushStatus() {
  await init(); const f = fb;
  const s = await f.getDoc(f.doc(db, 'pushTokens', user.uid));
  if (!s.exists()) { pushOn = false; emit(); return { on: false, reason: 'off' }; }
  const d = s.data();
  pushOn = d.enabled !== false; emit();
  return { on: pushOn, reason: pushOn ? null : (d.disabledReason || 'off'), leadMin: d.leadMin || 30, lastSentAt: d.lastSentAt?.toDate?.() || null, token: d.token };
}
/** Live version of pushStatus. Returns unsubscribe. */
export function watchPush(cb) {
  let unsub = () => {};
  init().then(() => {
    const f = fb;
    unsub = f.onSnapshot(f.doc(db, 'pushTokens', user.uid), s => {
      if (!s.exists()) { pushOn = false; cb({ on: false, reason: 'off' }); emit(); return; }
      const d = s.data(); pushOn = d.enabled !== false; emit();
      cb({ on: pushOn, reason: pushOn ? null : (d.disabledReason || 'off'), leadMin: d.leadMin || 30, lastSentAt: d.lastSentAt?.toDate?.() || null });
    }, () => {});
  }).catch(() => {});
  return () => unsub();
}

export async function disablePush() {
  await init();
  try { const m = await import(`${SDK}/firebase-messaging.js`); await m.deleteToken(m.getMessaging(app)); } catch (e) {}
  await fb.deleteDoc(fb.doc(db, 'pushTokens', user.uid));
  pushOn = false; emit();
}

/** Minutes before each stop (5–120). */
export async function setLeadMin(leadMin) {
  await init(); const f = fb;
  const s = await f.getDoc(f.doc(db, 'pushTokens', user.uid));
  if (!s.exists()) return;
  await writeToken(s.data().token, leadMin);
}

// ---------- sender heartbeat ----------
/** cb({ lastRunAt: Date|null, ageMin, ok, healthy, nextNudgeAt: Date|null, errors }) — for an
 *  "Alerts last checked 4 min ago" line. healthy = ran within 3 cadences and no errors.
 *  Outside the trip window the sender is off, so only show this Jan 8–21. */
export function watchSenderStatus(cb) {
  let unsub = () => {}, last = null;
  const render = () => {
    if (!last) return cb({ lastRunAt: null, ageMin: null, ok: false, healthy: false, nextNudgeAt: null, errors: [] });
    const t = last.lastRunAt?.toDate?.() || null, ageMin = t ? Math.round((Date.now() - t) / 60e3) : null;
    cb({ lastRunAt: t, ageMin, ok: !!last.ok, healthy: !!last.ok && ageMin != null && ageMin <= 3 * (last.cadenceMin || 10) + 5,
      nextNudgeAt: last.nextNudgeAt?.toDate?.() || null, errors: last.errors || [] });
  };
  const tick = setInterval(render, 60e3);
  init().then(() => {
    if (!who) return;
    const f = fb;
    unsub = f.onSnapshot(f.doc(db, 'status', 'sender'), s => { last = s.exists() ? s.data({ serverTimestamps: 'estimate' }) : null; render(); }, () => {});
  }).catch(() => {});
  return () => { clearInterval(tick); unsub(); };
}

// ---------- private itinerary (optional "app shell" mode) ----------
function parseTripDoc(s) {
  if (!s.exists()) return null;
  const d = s.data();
  return { trip: JSON.parse(d.json), overrides: d.overrides ? JSON.parse(d.overrides) : { overrides: [] },
    places: d.places ? JSON.parse(d.places) : {}, version: d.version || null, sha256: d.sha256 || null,
    publishedAt: d.publishedAt?.toDate?.() || null };
}

/** Loads the itinerary from Firestore (members only; cached on the device for offline use).
 *  Returns { trip, overrides, places, version, sha256, publishedAt } or null if not joined / not published. */
export async function loadTrip() {
  await init();
  if (!who) return null;
  const f = fb;
  let s;
  try { s = await f.getDoc(f.doc(db, 'trip', 'current')); }
  catch (e) { if (e.code === 'permission-denied') { setWho(null); revoked = true; emit(); return null; } throw e; }
  return parseTripDoc(s);
}

/** Live updates to trip/current. cb(data|null). Returns unsubscribe. */
export function watchTrip(cb) {
  let unsub = () => {}, alive = true;
  init().then(() => {
    if (!alive || !who) return;
    const f = fb;
    unsub = f.onSnapshot(f.doc(db, 'trip', 'current'), s => {
      try { cb(parseTripDoc(s)); }
      catch (e) { cb(null); }
    }, e => {
      if (e.code === 'permission-denied') { setWho(null); revoked = true; emit(); cb(null); }
    });
  }).catch(() => {});
  return () => { alive = false; unsub(); };
}

// ---------- Jarvis messages (in-app popup; same doc is also web-pushed when the app is closed) ----------
function msgView(id, d) {
  const created = d.createdAt?.toDate?.() || d.createdAt?.toMillis?.() && new Date(d.createdAt.toMillis()) || null;
  const expire = d.expireAt?.toDate?.() || d.expireAt?.toMillis?.() && new Date(d.expireAt.toMillis()) || null;
  const actions = Array.isArray(d.actions) ? d.actions.filter(a => a && a.label && a.value).map(a => ({ label: String(a.label).slice(0, 40), value: String(a.value).slice(0, 80) })) : [];
  return { id, target: d.target, title: d.title || '', body: d.body || '', from: d.from || 'Jarvis', actions, test: !!d.test,
    replies: d.replies || {}, createdAt: created, expireAt: expire };
}

/** Live list of Jarvis messages aimed at this person (or 'all'), not yet expired and not yet answered by them.
 *  Test messages (admin --test) are omitted unless includeTest is true. Returns unsubscribe. */
export function watchMessages(cb, { includeTest = false } = {}) {
  let unsub = () => {}, alive = true;
  init().then(() => {
    if (!alive || !who) return;
    const f = fb, me = who;
    const q = f.query(f.collection(db, 'messages'), f.where('target', 'in', [me, 'all']));
    unsub = f.onSnapshot(q, snap => {
      const now = Date.now();
      const list = snap.docs.map(d => msgView(d.id, d.data({ serverTimestamps: 'estimate' })))
        .filter(m => (!m.expireAt || m.expireAt.getTime() > now) && !(m.replies && m.replies[me]) && (includeTest || !m.test))
        .sort((a, b) => (a.createdAt?.getTime?.() || 0) - (b.createdAt?.getTime?.() || 0));
      cb(list);
    }, e => console.warn('[live] messages', e.code || e));
  }).catch(() => {});
  return () => { alive = false; unsub(); };
}

/** One-shot fresh read of the same list watchMessages gives (server first, cache if offline).
 *  Used when the app comes back to the foreground: iOS can freeze the snapshot socket in the background. */
export async function listMessages({ includeTest = false } = {}) {
  await init();
  if (!who) return null;
  const f = fb, me = who;
  const q = f.query(f.collection(db, 'messages'), f.where('target', 'in', [me, 'all']));
  let snap;
  try { snap = await (f.getDocsFromServer || f.getDocs)(q); } catch (e) { snap = await f.getDocs(q); }
  const now = Date.now();
  return snap.docs.map(d => msgView(d.id, d.data({ serverTimestamps: 'estimate' })))
    .filter(m => (!m.expireAt || m.expireAt.getTime() > now) && !(m.replies && m.replies[me]) && (includeTest || !m.test))
    .sort((a, b) => (a.createdAt?.getTime?.() || 0) - (b.createdAt?.getTime?.() || 0));
}

/** Button value, or 'ack' for OK / dismiss. */
export async function replyToMessage(id, value) {
  await init();
  if (!who) throw err('not-joined');
  const f = fb, v = String(value == null ? 'ack' : value).slice(0, 80);
  if (!v) throw err('empty-reply');
  await f.updateDoc(f.doc(db, 'messages', id), { [`replies.${who}`]: { value: v, at: f.serverTimestamp() } });
}

/** One message by id (for a #msg= deep link). Returns null if missing, expired, or not for this person. */
export async function getMessage(id) {
  await init();
  if (!who) return null;
  const f = fb;
  let s;
  try { s = await f.getDoc(f.doc(db, 'messages', id)); }
  catch (e) { if (e.code === 'permission-denied') return null; throw e; }
  if (!s.exists()) return null;
  const m = msgView(s.id, s.data());
  if (m.expireAt && m.expireAt.getTime() <= Date.now()) return m; // still return; UI may show "expired"
  return m;
}
