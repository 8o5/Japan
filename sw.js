importScripts('backend/push-sw.js'); /* closed-app push handlers (Firebase backend) — must stay first */
/* Service worker: offline-first app shell + data. Bump VERSION on every deploy
   (tools/extract.py does not touch this; README explains). */
var VERSION = 'jp27-v129-7bd380577f-shell';
var SHELL = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/app.js', 'js/live.js',
  'backend/backend.js', 'backend/firebase-config.js', 'backend/push-sw.js', 'manifest.webmanifest',
  'vendor/firebase/13.2.0/firebase-app.js', 'vendor/firebase/13.2.0/firebase-auth.js',
  'vendor/firebase/13.2.0/firebase-firestore.js', 'vendor/firebase/13.2.0/firebase-messaging.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
var DATA = [];

/* Updates are atomic: a new VERSION downloads every file fresh (bypassing the HTTP cache) into a new cache, and
   the shell is only ever served from the cache it was installed with — never patched file-by-file — so a phone
   can't end up with new JS on old HTML. The page reloads into the new version at a quiet moment (js/app.js). */
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(SHELL.concat(DATA).map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION && /^jp27-/.test(k); }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // weather, Firebase etc. go straight to the network
  var isData = /\/data\/[^/]+\.json$/.test(url.pathname);
  if (isData) {
    // network-first (so a new planner version shows up), but give up after 3 s and use the cache —
    // flaky subway / hotel Wi-Fi shouldn't leave the plan blank.
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req, { cache: 'no-cache' }).then(function (r) { if (r.ok) c.put(req, r.clone()); return r; });
        if (!hit) return net;
        var timer = new Promise(function (res) { setTimeout(function () { res(hit); }, 3000); });
        return Promise.race([net.catch(function () { return hit; }), timer]);
      });
    }));
    return;
  }
  // app shell: straight from this version's cache (instant, works in airplane mode); any page in scope gets index.html
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      if (req.mode === 'navigate') return c.match('index.html').then(function (ix) { return ix || fetch(req); });
      return fetch(req);
    });
  }).catch(function () { return fetch(req); }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(function (cs) { if (cs[0]) return cs[0].focus(); return self.clients.openWindow('./'); }));
});
