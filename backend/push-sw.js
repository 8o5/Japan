/* Push handlers for the app's service worker. In ../sw.js, add as the FIRST line:
     importScripts('backend/push-sw.js');
   Handles FCM web push payloads ({ notification, data, ... }) without loading the
   Firebase SDK in the worker. iOS requires every push to show a notification. */
self.addEventListener('push', function (e) {
  var p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) { p = { notification: { body: e.data && e.data.text() } }; }
  var n = p.notification || {}, d = p.data || {};
  var title = n.title || d.title || 'Japan 2027';
  var opts = {
    body: n.body || d.body || '',
    tag: d.tag || n.tag || undefined,
    renotify: !!(d.tag || n.tag),
    icon: n.icon || 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { jp27push: 1, url: d.url || (p.fcmOptions && p.fcmOptions.link) || './', msg: d.jp27msg || null }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('notificationclick', function (e) {
  var d = e.notification.data || {};
  if (!d.jp27push) return;               // not ours → let the app's handler run
  e.stopImmediatePropagation();
  e.notification.close();
  var url = new URL(d.url || './', self.registration.scope).href;
  var id = d.msg || ((url.match(/[#&]msg=([^&]+)/) || [])[1] ? decodeURIComponent(url.match(/[#&]msg=([^&]+)/)[1]) : null);
  // Warm path: an open (or backgrounded) app gets the message id by postMessage and is focused.
  // We do NOT navigate it: on iOS a hash-only navigate of a running PWA is ignored or rejected,
  // which is why a tapped push used to open the app with no popup. Cold path: openWindow(#msg=).
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    var mine = cs.filter(function (c) { return c.url.indexOf(self.registration.scope) === 0; });
    if (mine.length) {
      var c = mine.filter(function (x) { return x.focused; })[0] || mine.filter(function (x) { return x.visibilityState === 'visible'; })[0] || mine[0];
      mine.forEach(function (x) { try { x.postMessage({ type: 'jp27:msg', id: id }); } catch (_) {} });
      return Promise.resolve(c.focus ? c.focus() : null).catch(function () {}).then(function (fc) {
        if (fc || c.focused) return fc;
        return self.clients.openWindow(url);   // focus refused (rare): open fresh, hash fallback shows it
      });
    }
    return self.clients.openWindow(url);
  }).catch(function () { return self.clients.openWindow(url); }));
});
