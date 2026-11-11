importScripts('backend/push-sw.js'); /* closed-app push handlers (Firebase backend) — must stay first */
/* Service worker: offline-first app shell + data. Bump VERSION on every deploy
   (tools/extract.py does not touch this; README explains). */
var VERSION = 'jp27-v129-86e34e2297-shell';
var SHELL = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/app.js', 'js/live.js',
  'backend/backend.js', 'backend/firebase-config.js', 'backend/push-sw.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
var DATA = [];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL.concat(DATA)); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // weather etc. go straight to the network
  var isData = /\/data\/[^/]+\.json$/.test(url.pathname);
  if (isData) {
    // network-first (so a new planner version shows up), but give up after 3 s and use the cache —
    // flaky subway / hotel Wi-Fi shouldn't leave the plan blank.
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req).then(function (r) { if (r.ok) c.put(req, r.clone()); return r; });
        if (!hit) return net;
        var timer = new Promise(function (res) { setTimeout(function () { res(hit); }, 3000); });
        return Promise.race([net.catch(function () { return hit; }), timer]);
      });
    }));
    return;
  }
  // shell: cache-first, refresh in background
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    var net = fetch(req).then(function (r) {
      if (r.ok) { var cp = r.clone(); caches.open(VERSION).then(function (c) { c.put(req, cp); }); }
      return r;
    }).catch(function () { return hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined); });
    return hit || net;
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(function (cs) { if (cs[0]) return cs[0].focus(); return self.clients.openWindow('./'); }));
});
