/* Live add-on (backend v2): links this phone to Nic or Elly, shows each other's location while the app is
   open, and runs the ONE alert system (closed-app push when available; page-open alerts as a fallback on
   computers). Loaded as a module BEFORE js/app.js so a setup link (#join=…) is taken off the URL before the
   router reads it. Never blocks first paint: the plan renders first; Firebase loads afterwards. */
const LSg = (k, d) => { try { const v = localStorage.getItem('jp27.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const LSs = (k, v) => { try { if (v === null || v === undefined) localStorage.removeItem('jp27.' + k); else localStorage.setItem('jp27.' + k, JSON.stringify(v)); } catch (e) {} };
const rawWho = () => { try { const w = (localStorage.getItem('jp27.who') || '').replace(/"/g, ''); return w === 'nic' || w === 'elly' ? w : null; } catch (e) { return null; } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NAME = { nic: 'Nic', elly: 'Elly' };
const OTHER = { nic: 'elly', elly: 'nic' };
const CFG = window.APP_CONFIG || {};
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const SHELL_MODE = CFG.dataSource === 'firestore';

/* 1. Take a setup link (and a Jarvis message deep link) off the URL immediately
      so they never reach a server or the day router. */
let pendingLink = null, pendingMsg = null;
/* A tapped setup link must survive the one-time reload when the service worker first takes over
   (and an app-switch in a Safari tab), so it is parked in sessionStorage (this tab only, cleared when
   the tab closes) until it is used or rejected. Never put back in the URL. */
const JOIN_KEY = 'jp27.pendingJoin', JOIN_TTL = 15 * 60e3;
function setPendingLink(v) {
  pendingLink = v || null;
  try { if (pendingLink) sessionStorage.setItem(JOIN_KEY, JSON.stringify({ v: pendingLink, t: Date.now() })); else sessionStorage.removeItem(JOIN_KEY); } catch (e) {}
}
function takeHash() {
  const h = location.hash;
  let found = false;
  if (/(?:^#|&)join=/i.test(h)) { setPendingLink(decodeURIComponent(h.slice(h.search(/join=/i)))); found = true; }
  const mm = h.match(/(?:^#|&)msg=([^&]+)/i);
  if (mm) { pendingMsg = decodeURIComponent(mm[1]); found = true; }
  if (found) history.replaceState(null, '', location.pathname + location.search);
  return found;
}
takeHash();
if (!pendingLink) {
  try {
    const j = JSON.parse(sessionStorage.getItem(JOIN_KEY) || 'null');
    if (j && j.v && Date.now() - j.t < JOIN_TTL) pendingLink = j.v; else sessionStorage.removeItem(JOIN_KEY);
  } catch (e) {}
}
const includeTestMsgs = /(?:^|[?&])qa(?:=|&|$)/.test(location.search);

const S = {
  live: null, loadErr: null, online: navigator.onLine,
  who: rawWho(), whoVerified: false, revoked: false,
  sharing: false, people: { nic: null, elly: null }, shareHint: '',
  push: null, alertMsg: '', sender: null, reg: null, busy: false,
};
const leadMin = () => (S.push && S.push.leadMin) || LSg('leadMin', 30);
const pushOn = () => S.push ? !!S.push.on : !!LSg('pushOn', false);   // cached for offline launches
const localOn = () => !!LSg('notify', false);
const nowMs = () => (window.JP27 && window.JP27.now ? window.JP27.now() : Date.now());
const inTrip = () => { const t = nowMs(); return t >= Date.parse('2027-01-08T00:00:00+09:00') && t <= Date.parse('2027-01-22T00:00:00+09:00'); };

function rerender() {
  if (window.JP27 && window.JP27.renderLive) window.JP27.renderLive();
  const slot = document.getElementById('shell-slot'); if (slot) slot.innerHTML = welcomeHTML();
}
function withTimeout(p, ms, code) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(code), { code })), ms))]); }

/* ---------------- start-up ---------------- */
let watching = false;
async function load() {
  if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(r => { S.reg = r || null; }).catch(() => {});
  // Offline-first: show the plan saved on this phone right away, before Firebase starts
  // (which can take up to ~15 s on weak signal). Live data still refreshes it afterwards.
  if (SHELL_MODE && tripFp === null) {
    const cached = LSg('tripCache', null);
    if (cached) { tripFp = tripFingerprint(cached); giveTrip(cached, false); }
  }
  try {
    S.live = S.live || await withTimeout(import('../backend/backend.js'), 12000, 'timeout');
    S.live.onState(st => {
      if (st.who || st.whoVerified || st.revoked) S.who = st.who;   // before init() finishes, keep the cached who (offline launch)
      S.whoVerified = !!st.whoVerified; S.revoked = !!st.revoked; S.sharing = !!st.sharing;
      if (typeof st.push === 'boolean') LSs('pushOn', st.push);
      rerender();
    });
    await withTimeout(S.live.init(), 15000, 'timeout');   // offline-safe; keeps the cached who
    S.loadErr = null;
  } catch (e) { S.loadErr = navigator.onLine ? 'unreachable' : 'offline'; if (SHELL_MODE) provideTrip(); rerender(); return; }
  if (pendingLink) handlePendingLink();
  startWatches();
  if (SHELL_MODE) provideTrip();
  rerender();
}
function startWatches() {
  if (!S.who || watching || !S.live) return;
  watching = true;
  S.live.refreshPush({ registration: S.reg || undefined }).catch(() => {});
  S.live.resumeIfOptedIn({ onError: onShareError }).catch(onShareError);
  S.live.watchPeople(p => { S.people = p; rerender(); });
  S.live.watchPush(p => { S.push = p; LSs('pushOn', !!p.on); if (p.on) LSs('notify', null); rerender(); });
  S.live.watchSenderStatus(s => { S.sender = s; rerender(); });
  S.live.watchMessages(onMessages, { includeTest: includeTestMsgs });
  if (pendingMsg) showPendingMsg();
  if (SHELL_MODE) startTripWatch();
}
window.addEventListener('online', () => { S.online = true; if (!S.live || S.loadErr) load(); else { S.live.verify().catch(() => {}); rerender(); } });
window.addEventListener('offline', () => { S.online = false; rerender(); });

/* App-shell mode: the itinerary comes from Firestore (linked phones only), cached for offline.
   Open apps listen with onSnapshot and hand a new payload to JP27.provideData (which shows
   a "Plan updated" toast). Closed apps get the fresh doc the next time they open. */
let tripUnsub = () => {}, tripFp = null;
function tripFingerprint(d) {
  if (d && d.sha256) return 's:' + d.sha256;
  try { return 'j:' + JSON.stringify(d && d.overrides) + '|' + ((d && d.trip && d.trip.meta && (d.trip.meta.sha256 || d.trip.meta.extracted)) || ''); }
  catch (e) { return ''; }
}
function giveTrip(d, updated) {
  const slim = { trip: d.trip, overrides: d.overrides, places: d.places, version: d.version, sha256: d.sha256 || null };
  if (window.JP27 && window.JP27.provideData) window.JP27.provideData(slim, { updated: !!updated });
  else setTimeout(() => giveTrip(d, updated), 200);
}
function startTripWatch() {
  if (!SHELL_MODE || !S.who || !S.live || !S.live.watchTrip) return;
  tripUnsub();
  tripUnsub = S.live.watchTrip(d => {
    if (!d) { if (!LSg('tripCache', null)) { S.alertMsg = S.revoked ? '' : 'The plan isn’t published to the server yet.'; rerender(); } return; }
    const fp = tripFingerprint(d);
    const changed = !!(tripFp && fp !== tripFp);
    LSs('tripCache', { trip: d.trip, overrides: d.overrides, places: d.places, version: d.version, sha256: d.sha256 || null });
    tripFp = fp;
    giveTrip(d, changed);
  }) || (() => {});
}
async function provideTrip() {
  const cached = LSg('tripCache', null);
  if (cached) { tripFp = tripFingerprint(cached); giveTrip(cached, false); }
  if (!S.who || !S.live) return;
  if (S.live.watchTrip) { startTripWatch(); return; }
  try {
    const d = await S.live.loadTrip();
    if (!d) { if (!cached) { S.alertMsg = S.revoked ? '' : 'The plan isn’t published to the server yet.'; rerender(); } return; }
    const fp = tripFingerprint(d);
    const changed = !!(cached && fp && fp !== tripFp);
    LSs('tripCache', { trip: d.trip, overrides: d.overrides, places: d.places, version: d.version, sha256: d.sha256 || null });
    tripFp = fp;
    giveTrip(d, changed);
  } catch (e) { if (!cached) { S.alertMsg = 'Couldn’t load the plan from the server.'; rerender(); } }
}

/* ---------------- linking ---------------- */
const JOIN_ERR = {
  'bad-code': 'That code doesn’t match — paste the whole setup link again.',
  'code-cut-off': 'The link got cut off — copy the whole thing.',
  'need-person': 'Whose code is this? Choose Nic or Elly below, then tap Link.',
  'offline': 'Linking needs internet once. Connect and try again.',
  'timeout': 'The server didn’t answer. Check the connection and try again.',
};
function tryParse(text, person) { try { return S.live ? S.live.parseCode(text, person) : null; } catch (e) { return { error: e.code || 'bad-code' }; } }
function handlePendingLink() {
  const p = tryParse(pendingLink);
  if (p && p.error) { setPendingLink(null); openSheet({ error: JOIN_ERR[p.error] || JOIN_ERR['bad-code'] }); return; }
  if (p && S.who && p.who === S.who && S.whoVerified) { setPendingLink(null); return; }   // already linked: nothing to do
  if (IOS && !STANDALONE) { openSheet({ code: pendingLink }); return; }                  // never join inside an iPhone Safari tab
  doLink(pendingLink);
}
async function doLink(text, person) {
  if (!S.live) return openSheet({ error: navigator.onLine ? 'Can’t reach the trip server right now. Try again in a minute.' : JOIN_ERR.offline, code: text });
  S.busy = true; openSheet({ code: text, note: 'Linking…' });
  try {
    await withTimeout(S.live.joinFromText(text, person), 20000, 'timeout');
    S.busy = false; setPendingLink(null); startWatches(); if (SHELL_MODE) provideTrip();
    fillSheet({ done: true });
  } catch (e) {
    S.busy = false;
    if ((e.code === 'bad-code' || e.code === 'code-cut-off') && text === pendingLink) setPendingLink(null);
    fillSheet({ code: text, error: JOIN_ERR[e.code] || JOIN_ERR['bad-code'], needPerson: e.code === 'need-person' });
  } finally { S.busy = false; rerender(); }
}
async function unlink() {
  if (!confirm('Unlink this phone? Location sharing and alerts stop on it. You can link again with your setup link.')) return;
  try { if (S.live) await S.live.leave(); } catch (e) {}
  watching = false; S.push = null; LSs('pushOn', null); LSs('tripCache', null);
  tripUnsub(); tripUnsub = () => {}; tripFp = null; rerender();
}

/* ---------------- location sharing ---------------- */
function onShareError(e) {
  if (e && e.code === 'location-denied') S.shareHint = e.hint || 'Location is off for this app.';     // backend already stopped sharing
  else if (e && e.code === 'not-joined') S.shareHint = 'This phone isn’t linked on the server any more. Paste your setup link again.';
  else S.shareHint = S.online ? 'Couldn’t get a location fix yet — it keeps trying while the app is open.' : 'Offline — sharing resumes when you’re back online.';
  rerender();
}
async function toggleShare() {
  if (!S.live) return;
  S.shareHint = '';
  if (S.sharing) { S.sharing = false; rerender(); await S.live.stopSharing().catch(() => {}); rerender(); return; }
  // optimistic: the button flips at once; the backend's onState (or an error) settles the real state
  S.sharing = true; rerender();
  try { await S.live.startSharing({ onError: onShareError }); }
  catch (e) { S.sharing = !!(S.live.state && S.live.state().sharing); onShareError(e); }
}

/* ---------------- alerts (one system) ---------------- */
function toggleAlerts() {
  S.alertMsg = '';
  if (pushOn() || localOn()) {
    LSs('notify', null);
    if (pushOn() && S.live) S.live.disablePush().catch(() => {}).then(rerender); else rerender();
    return;
  }
  const sup = S.live ? S.live.pushSupport() : { ok: false, reason: 'offline' };
  if (S.who && sup.ok) {
    // straight from the tap: backend asks permission before any network work (iOS keeps the gesture)
    S.live.enablePush({ registration: S.reg || undefined, leadMin: leadMin() })
      .then(() => { LSs('pushOn', true); LSs('notify', null); })
      .catch(e => { S.alertMsg = e.hint || e.code || 'failed'; })
      .then(rerender);
    return;
  }
  if (sup.reason === 'ios-needs-home-screen' || sup.reason === 'denied') { S.alertMsg = sup.hint || sup.reason; rerender(); return; }
  // Computer, or not linked yet: alerts while the app is open on this device
  if (!('Notification' in window)) { S.alertMsg = 'This browser can’t show notifications.'; rerender(); return; }
  Notification.requestPermission().then(p => { if (p === 'granted') LSs('notify', true); else S.alertMsg = 'Notifications are blocked for this site in the browser’s settings.'; rerender(); });
}
async function setLead(v) {
  LSs('leadMin', +v);
  if (pushOn() && S.live) await S.live.setLeadMin(+v).catch(() => {});
  rerender();
}

/* ---------------- rendering (inside the Now card; app.js calls JP27_LIVE.html()) ---------------- */
function ago(min) { return min == null ? '' : min < 1 ? 'just now' : min < 60 ? min + ' min ago' : Math.round(min / 60) + ' h ago'; }
function dist(m) { return m < 950 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(m < 9500 ? 1 : 0) + ' km'; }
function personRow(k) {
  const p = S.people[k], me = S.people[S.who];
  if (!p) return `<li class="ppl-i off"><span class="ppl-n">${NAME[k]}${k === S.who ? ' (you)' : ''}</span><span class="ppl-m">${k === S.who ? (S.sharing ? 'Waiting for a location fix…' : 'Not sharing') : 'Not sharing right now'}</span></li>`;
  const where = k !== S.who && me && S.live ? dist(S.live.distanceMeters(me, p)) + ' away · ' : '';
  const maps = `https://maps.apple.com/?ll=${p.lat},${p.lng}&q=${encodeURIComponent(NAME[k])}`;
  return `<li class="ppl-i${p.stale ? ' stale' : ''}"><span class="ppl-n">${NAME[k]}${k === S.who ? ' (you)' : ''}</span><span class="ppl-m">${where}${p.stale ? 'last seen ' : ''}${ago(p.ageMin)}${p.devices > 1 ? ' · ' + p.devices + ' devices' : ''}</span>${k !== S.who ? `<a class="ppl-map" href="${maps}" target="_blank" rel="noopener">Map</a>` : ''}</li>`;
}
function alertsHTML() {
  const on = pushOn() || localOn();
  let state = 'Off', msg = S.alertMsg ? esc(S.alertMsg) : '';
  if (pushOn()) state = `On · ${leadMin()} min before each stop, even when closed`;
  else if (localOn()) state = `On · ${leadMin()} min before · only while the app is open`;
  if (S.push && !S.push.on && (S.push.reason === 'expired' || S.push.reason === 'device-removed')) {
    state = 'Stopped on this phone';
    msg = 'Alerts stopped on this phone — tap <b>Turn on</b> to start them again.';
  }
  // Recovery: alerts on, but iOS / the browser revoked notification permission
  if (on && 'Notification' in window && Notification.permission !== 'granted')
    msg = IOS ? 'iPhone has notifications turned off for this app: Settings → Notifications → Japan 2027 → Allow Notifications. If it isn’t listed, delete the home-screen icon, add it again from Safari, open it, paste your setup link and turn alerts on.'
      : 'The browser is blocking notifications for this site — allow them in site settings.';
  let hb = '';
  if (pushOn() && inTrip() && S.sender) {
    const s = S.sender;
    hb = s.lastRunAt ? `<p class="fine${s.healthy ? '' : ' warn'}">Alerts last checked ${esc(ago(s.ageMin))}${s.healthy ? '' : ' — <b>the alert server looks quiet</b>; go by the times on this page'}.</p>`
      : '<p class="fine">The alert server hasn’t checked in yet.</p>';
  }
  const lead = `<label class="lead">Heads-up <select data-live="lead">${[15, 30, 45, 60, 90].map(v => `<option value="${v}"${v === +leadMin() ? ' selected' : ''}>${v} min</option>`).join('')}</select></label>`;
  return `<div class="lv-row"><div><p class="lv-k">Trip alerts</p><p class="lv-v">${esc(state)}</p></div><div class="lv-act">${lead}<button class="btn${on ? '' : ' btn-p'}" data-live="alerts" aria-pressed="${on}">${on ? 'Turn off' : 'Turn on'}</button></div></div>${msg ? `<p class="fine warn">${msg}</p>` : ''}${hb}`;
}
/* One-line status for the Now card (app.js shows a quiet "Link this phone" / "Trip alerts are off" row). */
export function summary() {
  let warn = '';
  if (S.who && (pushOn() || localOn()) && 'Notification' in window && Notification.permission !== 'granted') warn = 'Alerts are blocked in Settings';
  else if (S.push && !S.push.on && (S.push.reason === 'expired' || S.push.reason === 'device-removed')) warn = 'Alerts stopped on this phone';
  else if (pushOn() && inTrip() && S.sender && S.sender.lastRunAt && !S.sender.healthy) warn = 'Alert server looks quiet';
  return { who: S.who, revoked: S.revoked, alertsOn: pushOn() || localOn(), warn, shell: SHELL_MODE, offline: !S.online };
}
function welcomeHTML() {
  // First run on the public site: nothing to see until this phone is linked.
  if (S.revoked) return `<div class="wel"><p class="wel-t">This phone was unlinked or the code changed.</p><p class="fine">Paste the new setup link.</p><div class="w-act"><button class="btn btn-p btn-wide" data-live="link">Paste setup link</button></div></div>`;
  if (IOS && !STANDALONE) return `<div class="wel"><p class="wel-t">Add it to your Home Screen first</p>
    <ol class="wel-steps"><li><span class="n">1</span><span>Tap <b>Share</b> <svg class="i" viewBox="0 0 24 24" aria-label="Share icon"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10.5H6.5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H16"/></svg> below</span></li>
    <li><span class="n">2</span><span>Choose <b>Add to Home Screen</b></span></li><li><span class="n">3</span><span>Open <b>Japan 2027</b> there and paste your setup link</span></li></ol>
    <p class="fine">Alerts and the offline plan only work in the Home Screen app.</p>${pendingLink ? '<div class="w-act"><button class="btn btn-p btn-wide" data-live="copy">Copy my setup link</button></div>' : ''}<p class="fine"><button class="linkbtn" data-live="link">Link this Safari tab instead</button></p></div>`;
  if (S.who) return `<div class="wel"><p class="wel-t">Linked as ${NAME[S.who]}</p><p class="fine">${S.online ? 'Downloading the plan…' : 'Connect to the internet once to download the plan. After that it works offline.'}</p>${S.alertMsg ? `<p class="fine warn">${esc(S.alertMsg)}</p>` : ''}</div>`;
  return `<div class="wel"><p class="wel-t">Private trip planner</p><p class="fine">Paste the setup link Nic sent you to open the plan on this device.</p><div class="w-act"><button class="btn btn-p btn-wide" data-live="link">Paste setup link</button></div></div>`;
}
export function html() {
  let h = '<div class="lv">';
  if (!S.who) {
    const lead = S.revoked ? 'Unlinked or the code changed — paste the new setup link.' : SHELL_MODE ? 'Paste your setup link to open the plan.' : 'See each other on the map and get trip alerts.';
    h += `<div class="lv-row"><div><p class="lv-k">Not linked</p><p class="lv-v">${lead}</p></div><div class="lv-act"><button class="btn btn-p" data-live="link">Link this phone</button></div></div>`;
  } else {
    const other = OTHER[S.who];
    const status = !S.online || S.loadErr === 'offline' ? 'Offline · reconnects by itself' : S.loadErr ? 'Can’t reach the server' : 'Connected';
    h += `<div class="lv-row"><div><p class="lv-k">Linked as ${NAME[S.who]}</p><p class="lv-v">${esc(status)}</p></div></div>`;
    h += `<ul class="ppl">${personRow(other)}${personRow(S.who)}</ul>`;
    h += `<div class="lv-row"><div><p class="lv-k">Share location with ${NAME[other]}</p><p class="lv-v">${S.sharing ? 'On' : 'Off'}</p></div><div class="lv-act"><button class="btn${S.sharing ? '' : ' btn-p'}" data-live="share" aria-pressed="${S.sharing}"${S.live && !S.loadErr ? '' : ' disabled'}>${S.sharing ? 'Stop' : 'Share'}</button></div></div>`;
    if (S.shareHint) h += `<p class="fine warn">${esc(S.shareHint)}</p>`;
    h += '<p class="fine">Updates only while the app is open. For live tracking use Find My.</p>';
  }
  if (!SHELL_MODE || S.who) h += alertsHTML();
  if (S.who) h += '<p class="fine"><button class="linkbtn" data-live="unlink">Unlink this phone</button></p>';
  return h + '</div>';
}

/* ---------------- "Link this phone" sheet ---------------- */
function sheet() {
  let d = document.getElementById('linksheet');
  if (d) return d;
  d = document.createElement('dialog'); d.id = 'linksheet'; d.className = 'sheet'; d.setAttribute('aria-labelledby', 'link-h');
  d.innerHTML = '<div class="sheet-in"><div class="grab" aria-hidden="true"></div><div class="sheet-h"><h2 id="link-h">Link this phone</h2><button type="button" class="iconbtn x" data-close aria-label="Close"><svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></button></div><div id="link-b"></div></div>';
  document.body.appendChild(d); return d;
}
let sheetState = {};
function fillSheet(o) {
  if (o) sheetState = Object.assign({}, sheetState, { error: '', note: '' }, o);
  const b = document.getElementById('link-b'); if (!b) return;
  const st = sheetState, code = st.code || '';
  if (st.done) {
    b.innerHTML = `<p class="lk-ok">Linked as <b>${NAME[S.who] || ''}</b>.</p><p class="fine">Next: turn on <b>Trip alerts</b>, and <b>Share my location</b> if you like.</p><div class="w-act"><button class="btn btn-p" data-close>Done</button></div>`;
    return;
  }
  const safariTab = IOS && !STANDALONE;
  let steps = '';
  if (safariTab) {
    steps = `<ol class="lk-steps"><li>Tap Share <span aria-hidden="true">⬆︎</span>, then <b>Add to Home Screen</b>.</li><li>Open <b>Japan 2027</b> from your home screen.</li><li>Tap <b>Link this phone</b> there and paste your setup link.</li></ol>
      <p class="fine">Link inside the home-screen app, not this Safari tab — they keep separate settings, and only the home-screen app gets alerts.</p>`;
    if (code) steps += `<div class="lk-code"><span>Your setup link is ready to paste.</span><button class="btn btn-p" data-live="copy">Copy it</button></div>`;
  }
  const p = code ? tryParse(code) : null;
  const who = p && !p.error && p.who ? p.who : null;
  const personPick = st.needPerson ? `<div class="w-act"><button class="btn" data-live="as" data-who="nic">This is Nic’s</button><button class="btn" data-live="as" data-who="elly">This is Elly’s</button></div>` : '';
  const form = `<label class="lk-l" for="lk-in">Setup link or code</label><textarea id="lk-in" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste the whole link (…#join=elly.…)">${esc(safariTab ? '' : code)}</textarea>
    ${who ? `<p class="fine">This links the phone as <b>${NAME[who]}</b>. Only use your own link.</p>` : ''}${personPick}
    <div class="w-act"><button class="btn${safariTab ? '' : ' btn-p'}" data-live="dolink"${S.busy ? ' disabled' : ''}>${safariTab ? 'Link this Safari tab anyway' : 'Link'}</button></div>`;
  b.innerHTML = steps + (st.error ? `<p class="fine warn" role="alert">${esc(st.error)}</p>` : '') + (st.note ? `<p class="fine" role="status">${esc(st.note)}</p>` : '') + form +
    '<p class="fine">Lost the link? Nic keeps both setup links in Notes.</p>';
}
function openSheet(o) {
  const d = sheet(); sheetState = {}; fillSheet(o || {});
  const me = document.getElementById('mesheet'); if (me && me.open) me.close();   // one sheet at a time
  d.classList.remove('closing');
  if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
}

/* ---------------- Jarvis in-app popup ---------------- */
function msgEl() {
  let d = document.getElementById('msgpop');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'msgpop'; d.className = 'msg-pop'; d.setAttribute('aria-labelledby', 'msg-h'); d.setAttribute('aria-describedby', 'msg-b');
  d.innerHTML = '<div class="msg-pop-in"><p class="msg-from" id="msg-from">Jarvis</p><h2 id="msg-h"></h2><p class="msg-body" id="msg-b"></p><p class="msg-err" id="msg-err" hidden></p><div class="msg-acts" id="msg-acts"></div></div>';
  d.addEventListener('cancel', e => {
    // FYI (OK only): Escape acknowledges. A question with choices stays up until a button is tapped.
    if (currentMsg && currentMsg.actions && currentMsg.actions.length) e.preventDefault();
    else if (currentMsg) { e.preventDefault(); answer(currentMsg, 'ack'); }
  });
  document.body.appendChild(d);
  return d;
}
let currentMsg = null, queue = [], inflight = false, seen = new Set(), answered = new Set();
function onMessages(list, opt) {
  const fresh = !!(opt && opt.fresh);   // a fresh server read may re-show a seen-but-unanswered message
  for (const m of list) {
    if (answered.has(m.id) || (!fresh && seen.has(m.id)) || (currentMsg && currentMsg.id === m.id) || queue.some(x => x.id === m.id)) continue;
    if (pendingMsg && m.id === pendingMsg) queue.unshift(m); else queue.push(m);
  }
  // drop messages that disappeared (expired / already answered on another device)
  const live = new Set(list.map(m => m.id));
  queue = queue.filter(m => live.has(m.id));
  if (currentMsg && !live.has(currentMsg.id) && !inflight) hideMsg();
  showNext();
}
async function showPendingMsg() {
  if (!pendingMsg || !S.live) return;
  try {
    const m = await S.live.getMessage(pendingMsg);
    pendingMsg = null;
    if (!m || answered.has(m.id)) return;
    if (m.replies && S.who && m.replies[S.who]) return;
    if (m.test && !includeTestMsgs) return;
    if (m.expireAt && m.expireAt.getTime() <= Date.now()) return;
    if (currentMsg && currentMsg.id === m.id) { const d = document.getElementById('msgpop'); if (d && !d.open) present(m); return; }
    if (!queue.some(x => x.id === m.id)) queue.unshift(m);
    showNext();
  } catch (e) { pendingMsg = null; }
}
function showNext() {
  if (currentMsg || inflight) return;
  const m = queue.shift();
  if (!m) return;
  present(m);
}
function present(m) {
  currentMsg = m; seen.add(m.id);
  const d = msgEl();
  document.getElementById('msg-from').textContent = m.from || 'Jarvis';
  document.getElementById('msg-h').textContent = m.title || '';
  document.getElementById('msg-b').textContent = m.body || '';
  const err = document.getElementById('msg-err'); err.hidden = true; err.textContent = '';
  const acts = document.getElementById('msg-acts');
  const buttons = (m.actions && m.actions.length) ? m.actions : [{ label: 'OK', value: 'ack' }];
  acts.className = 'msg-acts' + (buttons.length > 2 ? ' stack' : '');
  acts.innerHTML = buttons.map((a, i) => `<button type="button" class="${i === buttons.length - 1 ? 'msg-primary' : ''}" data-msg-val="${esc(a.value)}">${esc(a.label)}</button>`).join('');
  acts.onclick = ev => { const b = ev.target.closest('[data-msg-val]'); if (b) answer(m, b.getAttribute('data-msg-val')); };
  if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  // Focus the dialog itself so iOS-style alerts don't start with a button highlight.
  d.tabIndex = -1; d.focus();
}
function hideMsg() {
  const d = document.getElementById('msgpop');
  if (d && d.open) d.close();
  currentMsg = null;
}
async function answer(m, value) {
  if (inflight) return;
  inflight = true;
  const err = document.getElementById('msg-err');
  try {
    if (S.live && m.id && !String(m.id).startsWith('qa-')) await S.live.replyToMessage(m.id, value);
    answered.add(m.id);
    inflight = false; hideMsg(); showNext();
  } catch (e) {
    inflight = false;
    if (err) { err.hidden = false; err.textContent = S.online ? 'Couldn’t send that reply. Try again.' : 'You’re offline — try again when you’re back on the network.'; }
  }
}
function takeMsgId(id) {
  if (!id) return;
  pendingMsg = String(id);
  showPendingMsg();
}
window.addEventListener('hashchange', () => {
  if (/(?:^#|&)join=/i.test(location.hash)) {   // setup link tapped while the app/tab is already open
    takeHash();
    if (S.live && pendingLink) handlePendingLink();
    if (pendingMsg) showPendingMsg();
    return;
  }
  const mm = location.hash.match(/(?:^#|&)msg=([^&]+)/i);
  if (!mm) return;
  const cleaned = location.hash.replace(/[?&]?msg=[^&]+/i, '').replace(/^#&/, '#').replace(/^#$/, '');
  history.replaceState(null, '', location.pathname + location.search + (cleaned && cleaned !== '#' ? cleaned : ''));
  takeMsgId(decodeURIComponent(mm[1]));
});
// Warm tap: the service worker posts the message id to the already-open app instead of navigating it.
if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'jp27:msg') { if (d.id) takeMsgId(d.id); else recheckMessages(); }
  });
}
// Push arriving while the app is on screen (FCM onMessage in backend.js).
window.addEventListener('jp27:msg', e => takeMsgId(e.detail && e.detail.id));
// Safety net: whenever the app comes back to the foreground, re-read unanswered messages from the server.
let recheckAt = 0;
async function recheckMessages() {
  if (!S.live || !S.who || !S.live.listMessages) return;
  const t = Date.now(); if (t - recheckAt < 1500) return; recheckAt = t;
  try { const list = await S.live.listMessages({ includeTest: includeTestMsgs }); if (list) onMessages(list, { fresh: true }); } catch (e) {}
  if (pendingMsg) showPendingMsg();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recheckMessages(); });
window.addEventListener('pageshow', e => { if (e.persisted) recheckMessages(); });
window.addEventListener('focus', () => recheckMessages());

/* ---------------- events ---------------- */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-live]'); if (!a) return;
  const k = a.getAttribute('data-live');
  const typed = () => { const t = document.getElementById('lk-in'); return t && t.value.trim() ? t.value : (sheetState.code || ''); };
  if (k === 'link') openSheet({ code: pendingLink || '' });
  else if (k === 'dolink') doLink(typed());
  else if (k === 'as') doLink(typed(), a.getAttribute('data-who'));
  else if (k === 'copy') { navigator.clipboard && navigator.clipboard.writeText(sheetState.code || pendingLink || '').then(() => { a.textContent = 'Copied'; }); }
  else if (k === 'share') toggleShare();
  else if (k === 'alerts') toggleAlerts();
  else if (k === 'unlink') unlink();
});
document.addEventListener('change', e => { const t = e.target; if (t.matches && t.matches('[data-live="lead"]')) setLead(t.value); });

window.JP27_LIVE = { html, summary, refresh: rerender, open: openSheet, showMessage: present, hideMessage: hideMsg };
const start = () => (window.requestIdleCallback || (f => setTimeout(f, 300)))(() => load());
if (SHELL_MODE || (window.JP27 && window.JP27.ready)) start(); else document.addEventListener('jp27:ready', start, { once: true });
